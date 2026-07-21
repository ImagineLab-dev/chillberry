import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  type PaymentMethod,
  type PaymentProvider,
} from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { NotificationsService } from '../integrations/notifications.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { MockPaymentAdapter } from './adapters/mock-payment.adapter';

const APPROVAL_TOLERANCE = 0.01;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    // Crudo (sin tenant scope) — lo necesitan checkAndCompleteOrder y
    // processWebhook, que corren (o pueden correr) sin JWT y por lo tanto
    // sin tenantId en el contexto de ALS.
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly mockAdapter: MockPaymentAdapter,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly loyalty: LoyaltyService,
    private readonly inventory: InventoryService,
  ) {}

  private resolveAdapter(provider: PaymentProvider) {
    if (provider === PAYMENT_PROVIDER.Mock) return this.mockAdapter;
    // Fase 8+ / según se contrate: BancardAdapter, MercadoPagoAdapter, DlocalAdapter, StripeAdapter.
    throw new BadRequestException(`Proveedor "${provider}" todavía no está implementado`);
  }

  async createIntent(dto: CreatePaymentIntentDto) {
    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const { amount, billSplit } = await this.resolveTarget(order.id, Number(order.total), dto.billSplitId);

    return this.createPaymentLine({
      orderId: order.id,
      amount,
      method: dto.method,
      provider: dto.provider,
      billSplitId: billSplit?.id,
    });
  }

  /**
   * Crea UNA línea de pago para un pedido (o una parte de su cuenta
   * dividida). La usan tanto `/payments/intents` (Fase 3, un pago suelto)
   * como `/pos/orders/:id/charge` (Fase 4, N líneas en un cobro mixto) —
   * evita reimplementar la lógica de efectivo-instantáneo vs
   * proveedor-electrónico en dos lugares.
   */
  async createPaymentLine(args: {
    orderId: string;
    amount: number;
    /** Propina, aparte del `amount`. Se guarda en `Payment.tipAmount`. */
    tip?: number;
    method: PaymentMethod;
    provider?: PaymentProvider;
    billSplitId?: string;
    cashSessionId?: string;
    /**
     * Clave de idempotencia. Si viene del cliente y ya existe un Payment con
     * ella, se devuelve ese pago en vez de crear otro — así un doble click o
     * un reintento por timeout no cobran dos veces.
     *
     * Si no viene, se genera server-side: eso NO da idempotencia real (cada
     * llamada produce una clave distinta), solo satisface el `@unique` del
     * schema. Es el fallback para los callers que todavía no la mandan.
     */
    idempotencyKey?: string;
  },
  /**
   * Transacción del caller. `PosService.charge` cobra en efectivo dentro de una
   * transacción Serializable para que dos terminales cobrando el mismo pedido a
   * la vez no pasen las dos: el pago tiene que escribirse DENTRO de esa
   * transacción, si no la segunda vuelve a leer saldo cero.
   *
   * Cuando viene `tx`, este método NO cierra el pedido: `checkAndCompleteOrder`
   * emite factura y descuenta stock, y eso no puede correr dentro de una
   * transacción Serializable. Lo llama el caller después del commit.
   */
  tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.tenantPrisma.client;
    const idempotencyKey = args.idempotencyKey ?? randomBytes(16).toString('hex');

    if (args.idempotencyKey) {
      const existing = await db.payment.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        // Replay: el cliente reintentó el mismo cobro. Devolver el original es
        // lo correcto — el pago ya está hecho y sus efectos (marcar el split
        // pagado, el movimiento de caja, completar el pedido) ya corrieron.
        this.logger.warn(
          `Cobro repetido con la misma clave de idempotencia (${idempotencyKey}) — se devuelve el pago original ${existing.id} sin cobrar de nuevo.`,
        );
        return existing;
      }
    }

    const tip = args.tip ?? 0;

    if (args.method === PAYMENT_METHOD.Cash) {
      let payment;
      try {
        payment = await db.payment.create({
          data: {
            tenantId: this.tenantPrisma.tenantId,
            orderId: args.orderId,
            method: args.method,
            provider: PAYMENT_PROVIDER.CashManual,
            status: 'APPROVED',
            amount: args.amount,
            tipAmount: tip,
            idempotencyKey,
            paidAt: new Date(),
          },
        });
      } catch (err) {
        // El chequeo de replay de arriba lee ANTES de insertar, así que dos
        // clicks simultáneos pasan los dos y el `@unique` de la clave rechaza al
        // segundo. Sin esto el cajero veía un 500 y no sabía si había cobrado.
        // El pago ya existe y sus efectos los corrió el que ganó: se devuelve
        // ese, igual que en el camino de replay.
        const replay = await this.replayIfDuplicate(err, idempotencyKey);
        if (replay) return replay;
        throw err;
      }
      if (args.billSplitId) await this.linkAndMarkSplitPaid(args.billSplitId, payment.id, tx);
      if (args.cashSessionId) {
        await db.cashMovement.create({
          data: {
            tenantId: this.tenantPrisma.tenantId,
            sessionId: args.cashSessionId,
            type: 'SALE',
            amount: args.amount,
            paymentMethod: 'CASH',
            orderId: args.orderId,
          },
        });
        // La propina en efectivo también entra al cajón, pero como movimiento
        // TIP aparte: al cierre suma al efectivo esperado sin aparecer como un
        // sobrante inexplicado, y queda separada para liquidarla al mozo.
        if (tip > 0) {
          await db.cashMovement.create({
            data: {
              tenantId: this.tenantPrisma.tenantId,
              sessionId: args.cashSessionId,
              type: 'TIP',
              amount: tip,
              paymentMethod: 'CASH',
              orderId: args.orderId,
            },
          });
        }
      }
      // Con `tx`, el cierre lo dispara el caller después del commit (ver arriba).
      if (!tx) await this.checkAndCompleteOrder(args.orderId);
      return payment;
    }

    const provider = args.provider ?? PAYMENT_PROVIDER.Mock;
    const adapter = this.resolveAdapter(provider);

    const payment = await this.tenantPrisma.client.payment.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        orderId: args.orderId,
        method: args.method,
        provider,
        status: 'PENDING',
        amount: args.amount,
        tipAmount: tip,
        idempotencyKey,
      },
    });

    if (args.billSplitId) {
      await this.tenantPrisma.client.billSplit.update({
        where: { id: args.billSplitId },
        data: { paymentId: payment.id },
      });
    }

    const intent = await adapter.createIntent({
      paymentId: payment.id,
      orderId: args.orderId,
      amount: args.amount,
      currency: payment.currency,
    });

    const updated = await this.tenantPrisma.client.payment.update({
      where: { id: payment.id },
      data: { providerPaymentId: intent.providerPaymentId, status: 'PROCESSING' },
    });

    return { ...updated, redirectUrl: intent.redirectUrl };
  }

  /**
   * Cuánto hay que cobrar. Con `billSplitId` es esa parte; sin él, es el SALDO
   * del pedido — no el total.
   *
   * Antes devolvía el total pelado, así que en una cuenta dividida donde alguien
   * ya había pagado su parte (desde el QR o con `billSplitId`), el pedido seguía
   * sin completarse y el cajero que tocaba "Cobrar" sin elegir parte cobraba la
   * cuenta ENTERA otra vez. `getTableAccount` ya calculaba bien el saldo
   * (`total - pagado`), así que el sistema mostraba dos deudas distintas según
   * la pantalla.
   */
  async resolveTarget(orderId: string, orderTotal: number, billSplitId?: string) {
    if (!billSplitId) {
      // Se descuenta lo YA PAGADO mirando los Payment APROBADOS, no los splits:
      // cuando alguien paga su parte, el split queda ligado a su Payment, así
      // que los pagos cubren los dos casos (con y sin cuenta dividida) sin
      // contar dos veces lo mismo.
      const prev = await this.tenantPrisma.client.payment.aggregate({
        _sum: { amount: true },
        where: { orderId, status: 'APPROVED' },
      });
      const paid = Number(prev._sum.amount ?? 0);
      const owed = Math.max(0, round2(orderTotal - paid));
      if (paid > 0 && owed === 0) {
        throw new ConflictException('Esta cuenta ya fue pagada por completo');
      }
      return { amount: owed, billSplit: null };
    }

    const split = await this.tenantPrisma.client.billSplit.findUnique({ where: { id: billSplitId } });
    if (!split) throw new NotFoundException('División de cuenta no encontrada');
    if (split.orderId !== orderId) throw new BadRequestException('Esa división no pertenece a este pedido');
    if (split.paid) throw new ConflictException('Esa parte de la cuenta ya fue pagada');
    return { amount: Number(split.amount), billSplit: split };
  }

  listByOrder(orderId: string) {
    return this.tenantPrisma.client.payment.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Procesa un webhook de pago. Corre SIN contexto de tenant (request
   * pública, sin JWT) — todo acá usa `PrismaService` crudo, nunca
   * `TenantPrismaService`. El tenant se deriva del Payment encontrado por
   * `providerPaymentId`, no de la request.
   */
  async processWebhook(
    provider: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
    body: { eventId: string; eventType: string; providerPaymentId: string },
  ) {
    const adapter = provider === 'mock' ? this.mockAdapter : null;
    if (!adapter) throw new BadRequestException(`Proveedor "${provider}" no soportado`);

    const signatureValid = adapter.verifyWebhookSignature(rawBody, signatureHeader);

    // Idempotencia: (provider, eventId) es único. Si ya existe y ya se
    // procesó, no se reprocesa — mismo efecto, sin duplicar side-effects.
    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: body.eventId } },
    });
    if (existing?.processedAt) {
      return { ok: true, duplicate: true };
    }

    if (!signatureValid) {
      // Igual se deja registro del intento (con signatureValid=false) para
      // auditoría, pero nunca se actualiza un Payment con una firma inválida.
      await this.prisma.paymentWebhookEvent.upsert({
        where: { provider_eventId: { provider, eventId: body.eventId } },
        update: { payload: body, signatureValid: false },
        create: { provider, eventId: body.eventId, eventType: body.eventType, payload: body, signatureValid: false },
      });
      throw new BadRequestException('Firma de webhook inválida');
    }

    const event = await this.prisma.paymentWebhookEvent.upsert({
      where: { provider_eventId: { provider, eventId: body.eventId } },
      update: { payload: body, signatureValid: true },
      create: { provider, eventId: body.eventId, eventType: body.eventType, payload: body, signatureValid: true },
    });

    const payment = await this.prisma.payment.findFirst({
      where: { providerPaymentId: body.providerPaymentId },
    });
    if (!payment) {
      throw new NotFoundException(`No se encontró un Payment con providerPaymentId ${body.providerPaymentId}`);
    }

    if (body.eventType === 'PAYMENT_APPROVED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'APPROVED', paidAt: new Date() },
      });
      await this.prisma.billSplit.updateMany({ where: { paymentId: payment.id }, data: { paid: true } });
      await this.checkAndCompleteOrder(payment.orderId);
    } else if (body.eventType === 'PAYMENT_FAILED') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    } else if (body.eventType === 'PAYMENT_REFUNDED') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
    }

    await this.prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), tenantId: payment.tenantId },
    });

    return { ok: true, duplicate: false };
  }

  /**
   * Corre después de CUALQUIER aprobación de pago (efectivo instantáneo o
   * webhook electrónico) — decide si el pedido ya está completamente
   * pagado y, si es así, lo cierra: status COMPLETED, libera la mesa, emite
   * el comprobante. Usa `PrismaService` crudo porque también se invoca
   * desde el camino de webhook (sin tenant en ALS) — el tenantId sale del
   * propio `order`, no de la request.
   */
  async checkAndCompleteOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { billSplits: true, payments: true },
    });
    if (!order || order.status === 'COMPLETED' || order.status === 'CANCELLED') return;

    const hasSplits = order.billSplits.length > 0;
    const fullyPaid = hasSplits
      ? order.billSplits.every((s) => s.paid)
      : order.payments
          .filter((p) => p.status === 'APPROVED')
          .reduce((sum, p) => sum + Number(p.amount), 0) >= Number(order.total) - APPROVAL_TOLERANCE;

    if (!fullyPaid) return;

    // COMPLETED representa "pagado y cerrado" — un evento distinto del
    // flujo de cocina (WAITING->...->READY). Por eso no pasa por
    // `canTransitionOrder`: un takeaway puede pagarse por adelantado
    // mientras todavía está PREPARING, y eso es válido.
    //
    // El cambio de estado es la GUARDA de todo lo que viene abajo: se escribe
    // con `updateMany` condicionado a que el pedido siga sin cerrar, y sólo
    // sigue el que gana. Antes era un read-check-write: dos pagos que llegaban
    // a la vez (uno por webhook, otro por caja) pasaban los dos y ejecutaban el
    // cierre por duplicado — stock descontado dos veces, puntos acreditados dos
    // veces, y la segunda factura reventaba DESPUÉS de haber consumido un número
    // fiscal, dejando un hueco en la numeración.
    const closed = await this.prisma.order.updateMany({
      where: { id: orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (closed.count === 0) return;

    if (order.tableId) {
      await this.prisma.table.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } });
    }

    await this.invoices.issueForOrder(order);

    // Descuenta del inventario los insumos consumidos (según la receta de cada
    // producto). Solo lo vendido consume stock; best-effort, nunca bloquea.
    await this.inventory.depleteForOrder(order.id);

    // Acredita puntos de fidelización si el tenant tiene el programa activo y
    // el pedido trae teléfono. Best-effort: `accrueForCompletedOrder` no tira.
    await this.loyalty.accrueForCompletedOrder(order);

    // Fase 7 — best-effort: nunca bloquea el cierre del pedido si falla.
    await this.notifications.notifyOrderCompleted(order.customerPhone, Number(order.total).toFixed(2));
  }

  /**
   * ¿El error es "otro insert ganó con la misma clave de idempotencia"? Entonces
   * devolvemos el pago del ganador. Es el mismo resultado que el replay, pero
   * resuelto en la carrera en vez de antes de ella.
   */
  private async replayIfDuplicate(err: unknown, idempotencyKey: string) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
    this.logger.warn(
      `Cobro simultáneo con la misma clave (${idempotencyKey}) — se devuelve el pago que ganó la carrera.`,
    );
    return this.tenantPrisma.client.payment.findUnique({ where: { idempotencyKey } });
  }

  private async linkAndMarkSplitPaid(billSplitId: string, paymentId: string, tx?: Prisma.TransactionClient) {
    await (tx ?? this.tenantPrisma.client).billSplit.update({
      where: { id: billSplitId },
      data: { paymentId, paid: true },
    });
  }
}

/** Redondeo a centavos, para que restar partes pagadas no deje colas binarias. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
