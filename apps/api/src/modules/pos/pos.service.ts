import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DISCOUNT_TYPE, PAYMENT_METHOD, applyDiscountToOrder } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CouponsService } from '../coupons/coupons.service';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CreateCashMovementDto } from './dto/cash-movement.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { assertPuedeUsarSucursal } from '../../common/security/branch-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ChargeOrderDto } from './dto/charge-order.dto';
import { RefundOrderDto } from './dto/refund-order.dto';

const CHARGE_TOLERANCE = 0.01;
const PENDING_ORDER_STATUSES = ['WAITING', 'ACCEPTED', 'PREPARING', 'READY'] as const;

/**
 * Tope del descuento porcentual. Se permite llegar al 100% (una cortesía por
 * un plato mal hecho es un caso real del rubro), pero el acumulado nunca puede
 * pasar del total — ver `applyDiscount`.
 *
 * Pendiente: tope por rol (un CASHIER no debería poder comper una cuenta
 * entera sin autorización). Hoy lo cubre parcialmente `@Roles` en el
 * controller + el motivo obligatorio, que deja rastro de quién fue.
 */
const MAX_DISCOUNT_PERCENT = 100;

@Injectable()
export class PosService {
  constructor(
    // Crudo: sólo para la transacción de `applyDiscount`, donde hace falta un
    // `Prisma.TransactionClient` real para poder compartirlo con CouponsService.
    // Todas sus queries filtran por `tenantId` explícito.
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly payments: PaymentsService,
    private readonly coupons: CouponsService,
  ) {}

  listPendingOrders(branchId: string) {
    return this.tenantPrisma.client.order.findMany({
      where: { branchId, status: { in: [...PENDING_ORDER_STATUSES] } },
      include: { items: { include: { menuItem: true } }, table: true, billSplits: true },
      orderBy: [{ billRequestedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Propinas por mozo en un rango, para liquidar el turno. Atribuye cada
   * `Payment.tipAmount` al `Order.waiterId` de su pedido — el mozo que atendió.
   * Los pedidos sin mozo (pedido self-service por QR) caen en "Sin asignar".
   */
  async tipsReport(branchId: string, from?: string, to?: string) {
    const paidAt: { gte?: Date; lte?: Date } = {};
    if (from) paidAt.gte = new Date(from);
    if (to) paidAt.lte = new Date(to);

    const payments = await this.tenantPrisma.client.payment.findMany({
      where: {
        status: 'APPROVED',
        tipAmount: { gt: 0 },
        order: { branchId },
        ...(from || to ? { paidAt } : {}),
      },
      select: { tipAmount: true, order: { select: { waiterId: true } } },
    });

    const waiterIds = [...new Set(payments.map((p) => p.order.waiterId).filter((id): id is string => !!id))];
    const waiters = await this.tenantPrisma.client.user.findMany({
      where: { id: { in: waiterIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(waiters.map((w) => [w.id, w.name]));

    const byWaiter = new Map<string, { waiterId: string | null; waiterName: string; total: number; count: number }>();
    for (const p of payments) {
      const key = p.order.waiterId ?? 'unassigned';
      const row = byWaiter.get(key) ?? {
        waiterId: p.order.waiterId,
        waiterName: p.order.waiterId ? (nameById.get(p.order.waiterId) ?? 'Desconocido') : 'Sin asignar',
        total: 0,
        count: 0,
      };
      row.total = Math.round((row.total + Number(p.tipAmount)) * 100) / 100;
      row.count += 1;
      byWaiter.set(key, row);
    }

    const rows = [...byWaiter.values()].sort((a, b) => b.total - a.total);
    return { total: Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100, byWaiter: rows };
  }

  // ------------------------------------------------------------- sesiones

  async openSession(dto: OpenCashSessionDto, cashierId: string, user: AuthenticatedUser) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    // `dto.branchId` lo elige el cliente: sin esto, un cajero abre caja en
    // cualquier local del restaurante.
    assertPuedeUsarSucursal(user, branch.id);

    const existing = await this.getOpenSession(dto.branchId);
    if (existing) throw new ConflictException('Ya hay una caja abierta para esta sucursal');

    try {
      return await this.tenantPrisma.client.cashRegisterSession.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          branchId: dto.branchId,
          cashierId,
          openingAmount: dto.openingAmount,
        },
      });
    } catch (err) {
      // El chequeo de arriba lee y esto escribe: entre las dos cosas otro cajero
      // puede haber abierto. El índice único parcial de la base (una sola fila
      // OPEN por sucursal) es la garantía real; acá sólo lo traducimos al mismo
      // mensaje, para que el segundo cajero lea "ya hay una caja abierta" y no
      // un error de base de datos.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ya hay una caja abierta para esta sucursal');
      }
      throw err;
    }
  }

  getOpenSession(branchId: string) {
    return this.tenantPrisma.client.cashRegisterSession.findFirst({
      where: { branchId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
  }

  /**
   * Historial de arqueos: sesiones CERRADAS de una sucursal en un rango, con
   * quién la abrió, el esperado/contado/diferencia y las propinas en efectivo.
   * Lo que el owner necesita para auditar cierres cortos/largos en el tiempo.
   */
  async listSessions(branchId: string, from?: string, to?: string) {
    const closedAt: { gte?: Date; lte?: Date } = {};
    if (from) closedAt.gte = new Date(from);
    if (to) closedAt.lte = new Date(to);

    const sessions = await this.tenantPrisma.client.cashRegisterSession.findMany({
      where: {
        branchId,
        status: 'CLOSED',
        ...(from || to ? { closedAt } : {}),
      },
      orderBy: { closedAt: 'desc' },
      take: 200,
      include: { movements: { where: { type: 'TIP' }, select: { amount: true } } },
    });

    // El nombre del cajero: `cashierId` es un User pero no hay relación directa
    // en el modelo, así que se resuelve con un solo query extra por lote.
    const cashierIds = [...new Set(sessions.map((s) => s.cashierId))];
    const cashiers = await this.tenantPrisma.client.user.findMany({
      where: { id: { in: cashierIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(cashiers.map((c) => [c.id, c.name]));

    return sessions.map((s) => ({
      id: s.id,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      cashierName: nameById.get(s.cashierId) ?? null,
      openingAmount: s.openingAmount,
      expectedCash: s.expectedCash,
      countedCash: s.countedCash,
      difference: s.difference,
      cashTips: s.movements.reduce((sum, m) => sum + Number(m.amount), 0),
    }));
  }

  async closeSession(sessionId: string, dto: CloseCashSessionDto, user: AuthenticatedUser) {
    const session = await this.tenantPrisma.client.cashRegisterSession.findUnique({
      where: { id: sessionId },
      include: { movements: true },
    });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    // Cerrar una caja ajena falsea el arqueo de ese local Y lo deja cerrado
    // para siempre: por API no hay forma de reabrirlo.
    assertPuedeUsarSucursal(user, session.branchId);
    if (session.status === 'CLOSED') throw new ConflictException('Esta caja ya está cerrada');

    // Solo movimientos en EFECTIVO afectan lo que debería haber físicamente
    // en el cajón — DISCOUNT queda en el log de auditoría de la sesión pero
    // no mueve billetes.
    const cashMovements = session.movements.filter((m) => m.paymentMethod === 'CASH' || m.type === 'PAY_IN' || m.type === 'PAY_OUT');
    const delta = cashMovements.reduce((sum, m) => {
      // TIP suma igual que SALE: la propina en efectivo está físicamente en el
      // cajón. Se reporta aparte (`cashTips`) para que no se confunda con la
      // venta y para poder liquidarla al mozo.
      if (m.type === 'SALE' || m.type === 'PAY_IN' || m.type === 'TIP') return sum + Number(m.amount);
      if (m.type === 'REFUND' || m.type === 'PAY_OUT') return sum - Number(m.amount);
      return sum;
    }, 0);

    const cashTips = session.movements
      .filter((m) => m.type === 'TIP')
      .reduce((sum, m) => sum + Number(m.amount), 0);

    const expectedCash = Number(session.openingAmount) + delta;
    const difference = dto.countedCash - expectedCash;

    const closed = await this.tenantPrisma.client.cashRegisterSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        expectedCash,
        countedCash: dto.countedCash,
        difference,
      },
    });
    // `cashTips` no es una columna de la sesión (no quiero migrar por esto):
    // se devuelve en la respuesta del cierre para que la caja lo muestre.
    return { ...closed, cashTips };
  }

  async createMovement(sessionId: string, dto: CreateCashMovementDto, userId: string, user: AuthenticatedUser) {
    const session = await this.tenantPrisma.client.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    // Un PAY_OUT contra la caja de otro local es sacar plata de un cajón ajeno.
    assertPuedeUsarSucursal(user, session.branchId);
    if (session.status !== 'OPEN') throw new ConflictException('Esta caja ya está cerrada');

    // Sacar plata del cajón (PAY_OUT) exige motivo: un retiro sin explicación
    // es indistinguible de un robo al cerrar el arqueo.
    if (dto.type === 'PAY_OUT' && (!dto.note || dto.note.trim().length < 3)) {
      throw new BadRequestException('Un retiro de caja (PAY_OUT) tiene que llevar un motivo');
    }

    return this.tenantPrisma.client.cashMovement.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        sessionId,
        type: dto.type,
        amount: dto.amount,
        note: dto.note,
        createdById: userId,
      },
    });
  }

  // ------------------------------------------------------------ descuentos

  async applyDiscount(dto: ApplyDiscountDto, userId: string) {
    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new ConflictException('No se puede aplicar un descuento a un pedido cerrado');
    }

    const subtotal = Number(order.subtotal);

    // El porcentaje se topea acá y no en el DTO porque solo aplica a
    // PERCENTAGE — en FIXED_AMOUNT/COUPON `value` es un monto, no un %.
    if (dto.type === DISCOUNT_TYPE.Percentage && dto.value > MAX_DISCOUNT_PERCENT) {
      throw new BadRequestException(`El descuento no puede superar el ${MAX_DISCOUNT_PERCENT}%`);
    }

    // Cupón con código: NO se confía en el `value` que manda el cliente — se
    // valida el código real (vigencia, tope de usos, compra mínima) y el monto
    // sale del cupón. Acá sólo se VALIDA; el canje se registra más abajo, recién
    // cuando el descuento pasó el tope del pedido (si no, un descuento rechazado
    // quemaba un uso del cupón).
    let validatedCoupon: { couponId: string; code: string; amount: number } | null = null;
    if (dto.type === DISCOUNT_TYPE.Coupon && dto.couponCode) {
      validatedCoupon = await this.coupons.validate(this.tenantPrisma.tenantId, dto.couponCode, subtotal);
    }

    const amount =
      validatedCoupon !== null
        ? validatedCoupon.amount
        : dto.type === DISCOUNT_TYPE.Percentage
          ? Math.round(((subtotal * dto.value) / 100) * 100) / 100
          : dto.value;

    // Validación de tope compartida con el canje de puntos (helper puro en
    // domain): valida el ACUMULADO, no el descuento suelto. La versión anterior
    // comparaba solo `amount > subtotal`, así que dos descuentos del 100%
    // pasaban de a uno y dejaban el total negativo e incobrable.
    const discountedSoFar = Number(order.discountTotal);
    const applied = applyDiscountToOrder(subtotal, Number(order.taxTotal), discountedSoFar, amount);
    if (!applied.ok) {
      throw new BadRequestException(
        discountedSoFar > 0
          ? `Este pedido ya tiene ${discountedSoFar.toFixed(2)} de descuento: como máximo podés descontar ${applied.discountableRemaining.toFixed(2)} más.`
          : 'El descuento no puede superar el total del pedido',
      );
    }

    // Las tres escrituras van en UNA transacción, y en este orden:
    //
    //  1. Mover el total del pedido con un compare-and-set: el `where` exige que
    //     `discountTotal` siga siendo el que leímos al validar el tope. Si otro
    //     descuento entró en el medio (cajero + mozo canjeando puntos a la vez),
    //     no matchea y abortamos — antes los dos escribían el absoluto y uno
    //     pisaba al otro: quedaba UN descuento en el total y DOS filas Discount,
    //     con el cupón quemado o los puntos ya descontados.
    //  2. Canjear el cupón. Si está agotado, tira y revierte el paso 1.
    //  3. Registrar el Discount.
    //
    // Antes esto eran tres escrituras sueltas: si fallaba la del total, el cupón
    // quedaba consumido y el cliente pagaba completo igual.
    const deltas = { discountTotal: { increment: amount }, total: { decrement: amount } };
    const tenantId = this.tenantPrisma.tenantId;
    const discount = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: order.id, tenantId, discountTotal: order.discountTotal },
        data: deltas,
      });
      if (moved.count === 0) {
        throw new ConflictException(
          'Se aplicó otro descuento a este pedido al mismo tiempo — revisá el total y volvé a intentar.',
        );
      }

      if (validatedCoupon) {
        await this.coupons.redeem(
          {
            tenantId: this.tenantPrisma.tenantId,
            couponId: validatedCoupon.couponId,
            orderId: order.id,
            amount: validatedCoupon.amount,
            customerPhone: order.customerPhone,
          },
          tx,
        );
      }

      return tx.discount.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          orderId: order.id,
          type: dto.type,
          value: dto.value,
          amount,
          // Si fue un cupón real, se guarda su código normalizado (MAYÚSCULAS).
          couponCode: validatedCoupon?.code ?? dto.couponCode,
          appliedById: userId,
          reason: dto.reason,
        },
      });
    });

    const openSession = await this.getOpenSession(order.branchId);
    if (openSession) {
      await this.tenantPrisma.client.cashMovement.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          sessionId: openSession.id,
          type: 'DISCOUNT',
          amount,
          orderId: order.id,
          note: dto.reason,
        },
      });
    }

    return discount;
  }

  /**
   * Panel de control anti-robo: descuentos, anulaciones y movimientos de caja
   * de un rango, cada uno con QUIÉN, CUÁNTO y POR QUÉ. Responde la pregunta del
   * dueño —"¿cómo sé que no me roban?"— con la evidencia que el sistema ya
   * venía guardando (appliedById, cancelledById, createdById) y que hasta ahora
   * ninguna pantalla mostraba.
   */
  async controlReport(branchId: string, from?: string, to?: string) {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = new Date(from);
    if (to) createdAt.lte = new Date(to);
    const dateFilter = from || to ? { createdAt } : {};

    const [discounts, cancellations, movements] = await Promise.all([
      this.tenantPrisma.client.discount.findMany({
        where: { order: { branchId }, ...dateFilter },
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { id: true, table: { select: { code: true } } } } },
      }),
      this.tenantPrisma.client.order.findMany({
        where: {
          branchId,
          status: 'CANCELLED',
          ...(from || to ? { cancelledAt: { gte: createdAt.gte, lte: createdAt.lte } } : {}),
        },
        orderBy: { cancelledAt: 'desc' },
        select: {
          id: true,
          total: true,
          cancelReason: true,
          cancelledById: true,
          cancelledAt: true,
          table: { select: { code: true } },
        },
      }),
      this.tenantPrisma.client.cashMovement.findMany({
        where: { type: { in: ['PAY_IN', 'PAY_OUT'] }, session: { branchId }, ...dateFilter },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Resolver los nombres de los responsables en un solo query.
    const userIds = [
      ...discounts.map((d) => d.appliedById),
      ...cancellations.map((c) => c.cancelledById),
      ...movements.map((m) => m.createdById),
    ].filter((id): id is string => !!id);
    const users = await this.tenantPrisma.client.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const who = (id: string | null) => (id ? (nameById.get(id) ?? 'Desconocido') : 'Sistema');

    return {
      discounts: discounts.map((d) => ({
        id: d.id,
        amount: d.amount,
        type: d.type,
        reason: d.reason,
        by: who(d.appliedById),
        table: d.order.table?.code ?? null,
        at: d.createdAt,
      })),
      cancellations: cancellations.map((c) => ({
        id: c.id,
        total: c.total,
        reason: c.cancelReason,
        by: who(c.cancelledById),
        table: c.table?.code ?? null,
        at: c.cancelledAt,
      })),
      cashMovements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        amount: m.amount,
        note: m.note,
        by: who(m.createdById),
        at: m.createdAt,
      })),
    };
  }

  // --------------------------------------------------------------- cobro

  async charge(orderId: string, dto: ChargeOrderDto, user: AuthenticatedUser) {
    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    // El cobro escribe el SALE contra la caja de `order.branchId`: cobrar un
    // pedido ajeno mete plata en el cajón de otro local.
    assertPuedeUsarSucursal(user, order.branchId);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new ConflictException('Este pedido ya está cerrado');
    }

    const { amount: target, billSplit } = await this.payments.resolveTarget(
      orderId,
      Number(order.total),
      dto.billSplitId,
    );

    const sum = dto.payments.reduce((acc, p) => acc + p.amount, 0);
    if (Math.abs(sum - target) > CHARGE_TOLERANCE) {
      throw new BadRequestException(
        `La suma de los pagos (${sum.toFixed(2)}) no coincide con lo que corresponde cobrar (${target.toFixed(2)})`,
      );
    }

    const needsCashSession = dto.payments.some((p) => p.method === PAYMENT_METHOD.Cash);
    let openSession: { id: string } | null = null;
    if (needsCashSession) {
      openSession = await this.getOpenSession(order.branchId);
      if (!openSession) {
        throw new ConflictException('No hay una caja abierta en esta sucursal — abrí la caja antes de cobrar en efectivo');
      }
    }

    // Una clave determinística por línea, derivada de la del intento: un cobro
    // mixto son N Payments y cada uno necesita su propia clave (el schema la
    // tiene @unique). Reintentar el mismo cobro regenera exactamente las mismas
    // N claves, así que las N líneas hacen replay en vez de duplicarse.
    const lineArgs = dto.payments.map((line, i) => ({
      orderId,
      amount: line.amount,
      tip: line.tip,
      method: line.method,
      provider: line.provider,
      billSplitId: billSplit?.id,
      cashSessionId: line.method === PAYMENT_METHOD.Cash ? openSession?.id : undefined,
      idempotencyKey: `${dto.idempotencyKey}:${i}`,
    }));

    // Cobro TODO en efectivo: va en una transacción Serializable que revalida el
    // saldo ADENTRO. Sin esto, dos terminales cobrando el mismo pedido en el
    // mismo instante leían las dos "pagado 0" y registraban dos pagos completos
    // — el cliente pagaba una vez y la caja quedaba con el doble anotado. La
    // clave de idempotencia sólo cubre el doble click de UNA terminal, porque
    // dos dispositivos generan claves distintas.
    //
    // Sólo el efectivo: los pagos electrónicos nacen PENDING (no suman al
    // saldo hasta que el proveedor confirma) y su creación llama a un servicio
    // externo, que no puede vivir dentro de una transacción.
    const allCash = dto.payments.every((p) => p.method === PAYMENT_METHOD.Cash);
    let createdPayments;

    if (allCash) {
      try {
        createdPayments = await this.prisma.$transaction(
          async (tx) => {
            const prev = await tx.payment.aggregate({
              _sum: { amount: true },
              where: { orderId, tenantId: this.tenantPrisma.tenantId, status: 'APPROVED' },
            });
            const yaPagado = Number(prev._sum.amount ?? 0);
            if (yaPagado + sum > Number(order.total) + CHARGE_TOLERANCE) {
              throw new ConflictException(
                'Este pedido ya fue cobrado desde otra terminal — actualizá la lista antes de volver a cobrar.',
              );
            }
            const out = [];
            for (const args of lineArgs) {
              out.push(await this.payments.createPaymentLine(args, tx));
            }
            return out;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (err) {
        // Perdimos la carrera. Antes de devolver un error, hay que distinguir
        // dos situaciones que se ven igual desde acá:
        //
        //  a) MISMA terminal, doble click: el que ganó escribió pagos con NUESTRA
        //     misma clave de idempotencia. No es un error — es el mismo cobro.
        //     Se devuelven esos pagos, que es lo que el cajero espera ver.
        //  b) OTRA terminal: escribió pagos con otra clave. Ahí sí es un
        //     conflicto real y hay que frenarlo.
        const mismoCobro = await this.tenantPrisma.client.payment.findMany({
          where: { orderId, idempotencyKey: { startsWith: `${dto.idempotencyKey}:` } },
        });
        if (mismoCobro.length > 0) {
          const refreshed = await this.tenantPrisma.client.order.findUnique({ where: { id: orderId } });
          return { payments: mismoCobro, order: refreshed };
        }
        // P2034 = conflicto de serialización de Postgres.
        if ((err as { code?: string }).code === 'P2034') {
          throw new ConflictException('Otra terminal está cobrando este pedido — reintentá.');
        }
        throw err;
      }
      // Fuera de la transacción: emite factura, descuenta stock y acredita
      // puntos. Tiene su propia guarda para no correr dos veces.
      await this.payments.checkAndCompleteOrder(orderId);
    } else {
      createdPayments = [];
      for (const args of lineArgs) {
        createdPayments.push(await this.payments.createPaymentLine(args));
      }
    }

    const refreshedOrder = await this.tenantPrisma.client.order.findUnique({ where: { id: orderId } });
    return { payments: createdPayments, order: refreshedOrder };
  }

  /**
   * Reembolso total o parcial de un pedido ya cobrado. Registra la salida de
   * plata del cajón (CashMovement REFUND, que el arqueo resta del efectivo
   * esperado) y, si el acumulado devuelto cubre el total, marca los pagos como
   * REFUNDED. No se puede devolver más de lo cobrado (descontando devoluciones
   * previas). Requiere caja abierta.
   */
  async refundOrder(orderId: string, dto: RefundOrderDto, userId: string, user: AuthenticatedUser) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    // El REFUND sale del cajón de `order.branchId`: sin esto, un cajero
    // reembolsa contra la caja de otro local.
    assertPuedeUsarSucursal(user, order.branchId);
    if (order.status !== 'COMPLETED') {
      throw new ConflictException('Solo se puede reembolsar un pedido ya cobrado');
    }

    const paid = order.payments
      .filter((p) => p.status === 'APPROVED')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    if (paid <= 0) throw new ConflictException('Este pedido no tiene pagos aprobados para reembolsar');

    const session = await this.getOpenSession(order.branchId);
    if (!session) {
      throw new ConflictException(
        'No hay una caja abierta en esta sucursal — abrí la caja para registrar el reembolso',
      );
    }

    // Transacción Serializable: recalcular el acumulado devuelto y escribir el
    // movimiento van JUNTOS y aislados. Dos reembolsos concurrentes (doble
    // click, reintento, dos terminales) no pueden ambos leer alreadyRefunded=0 y
    // pasar el tope — uno aborta por conflicto de serialización. Evita el
    // doble-reembolso (mismo espíritu que la idempotencia del charge).
    try {
      return await this.tenantPrisma.client.$transaction(
        async (tx) => {
          const prev = await tx.cashMovement.aggregate({
            _sum: { amount: true },
            where: { orderId, type: 'REFUND' },
          });
          const alreadyRefunded = Number(prev._sum.amount ?? 0);
          const maxRefundable = paid - alreadyRefunded;
          if (dto.amount > maxRefundable + CHARGE_TOLERANCE) {
            throw new BadRequestException(
              `No podés reembolsar ${dto.amount.toFixed(2)}: el máximo disponible es ${maxRefundable.toFixed(2)}`,
            );
          }

          const movement = await tx.cashMovement.create({
            data: {
              tenantId: this.tenantPrisma.tenantId,
              sessionId: session.id,
              type: 'REFUND',
              amount: dto.amount,
              // Sale del cajón como efectivo: el arqueo lo descuenta (getSessionBalance).
              paymentMethod: PAYMENT_METHOD.Cash,
              orderId,
              note: dto.reason,
              createdById: userId,
            },
          });

          const totalRefunded = alreadyRefunded + dto.amount;
          const fullyRefunded = totalRefunded >= paid - CHARGE_TOLERANCE;
          if (fullyRefunded) {
            await tx.payment.updateMany({
              where: { orderId, status: 'APPROVED' },
              data: { status: 'REFUNDED' },
            });
          }

          return { ok: true, refunded: dto.amount, totalRefunded, orderTotal: paid, fullyRefunded, movementId: movement.id };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // P2034 = conflicto de escritura/serialización: otro reembolso del mismo
      // pedido ganó la carrera. Se lo devolvemos como 409 reintenteable.
      if ((err as { code?: string }).code === 'P2034') {
        throw new ConflictException('Otro reembolso de este pedido se está procesando — reintentá.');
      }
      throw err;
    }
  }
}
