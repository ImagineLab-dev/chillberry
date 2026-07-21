import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { applyDiscountToOrder } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { UpdateProgramDto } from './dto/loyalty.dto';

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    // `prisma` crudo para la acreditación, que se llama desde el cierre de
    // pedido (PaymentsService.checkAndCompleteOrder) — puede correr sin JWT.
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  // -------------------------------------------------------------- programa

  async getProgram() {
    const program = await this.tenantPrisma.client.loyaltyProgram.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
    // Si no existe, se devuelve el default apagado — así el front no distingue
    // "nunca configurado" de "configurado y apagado".
    return (
      program ?? {
        tenantId: this.tenantPrisma.tenantId,
        active: false,
        earnPer: '1000',
        pointValue: '50',
      }
    );
  }

  async updateProgram(dto: UpdateProgramDto) {
    const tenantId = this.tenantPrisma.tenantId;
    return this.tenantPrisma.client.loyaltyProgram.upsert({
      where: { tenantId },
      create: {
        tenantId,
        active: dto.active ?? false,
        earnPer: dto.earnPer ?? 1000,
        pointValue: dto.pointValue ?? 50,
      },
      update: {
        active: dto.active,
        earnPer: dto.earnPer,
        pointValue: dto.pointValue,
      },
    });
  }

  // -------------------------------------------------------------- cuentas

  getAccount(phone: string) {
    // `findFirst`, no `findUnique`: el extension de tenant-scoping inyecta
    // `tenantId` en el where, y un `findUnique` con la clave compuesta
    // `tenantId_phone` MÁS un `tenantId` suelto es un where inválido. Con
    // `findFirst` el tenantId inyectado es solo un filtro más y `phone` acota
    // al único registro (es único dentro del tenant).
    return this.tenantPrisma.client.loyaltyAccount.findFirst({ where: { phone } });
  }

  /**
   * Ajuste manual del saldo de puntos (corrección, cortesía, etc.). `delta`
   * positivo suma, negativo resta; el saldo nunca queda negativo (se clampea a
   * 0). Crea la cuenta si no existe. Deja un `LoyaltyTransaction` type ADJUST
   * con el motivo — antes `ADJUST` estaba definido pero sin uso.
   */
  async adjustPoints(phone: string, delta: number, note: string) {
    const cleanPhone = phone.trim();
    return this.tenantPrisma.client.$transaction(async (tx) => {
      const existing = await tx.loyaltyAccount.findFirst({ where: { phone: cleanPhone } });
      const current = existing?.points ?? 0;
      const newPoints = Math.max(0, current + delta);
      const applied = newPoints - current; // el delta REAL (por si se clampeó a 0)

      const account = existing
        ? await tx.loyaltyAccount.update({ where: { id: existing.id }, data: { points: newPoints } })
        : await tx.loyaltyAccount.create({
            data: { tenantId: this.tenantPrisma.tenantId, phone: cleanPhone, points: newPoints },
          });

      await tx.loyaltyTransaction.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          accountId: account.id,
          type: 'ADJUST',
          points: applied,
          note,
        },
      });
      return account;
    });
  }

  // --------------------------------------------------------- acreditación

  /**
   * Acredita puntos por un pedido recién cerrado. La llama PaymentsService al
   * completar el pedido. Best-effort: nunca tira — un problema de fidelización
   * no puede tumbar el cierre de un cobro.
   *
   * Usa `tenantId` explícito (viene del pedido) porque corre sin tenant en el
   * contexto de ALS.
   */
  async accrueForCompletedOrder(order: {
    id: string;
    tenantId: string;
    total: unknown;
    customerPhone: string | null;
    customerName: string | null;
  }): Promise<void> {
    try {
      if (!order.customerPhone) return;
      const program = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId: order.tenantId } });
      if (!program || !program.active) return;

      const earnPer = Number(program.earnPer);
      if (earnPer <= 0) return;
      const earned = Math.floor(Number(order.total) / earnPer);
      if (earned <= 0) return;

      // Idempotencia: si ya hay una acreditación EARN para este pedido, no
      // duplicar (un reintento de webhook podría re-cerrar el pedido).
      const account = await this.prisma.loyaltyAccount.upsert({
        where: { tenantId_phone: { tenantId: order.tenantId, phone: order.customerPhone } },
        create: {
          tenantId: order.tenantId,
          phone: order.customerPhone,
          name: order.customerName,
          points: 0,
        },
        update: order.customerName ? { name: order.customerName } : {},
      });

      const already = await this.prisma.loyaltyTransaction.findFirst({
        where: { accountId: account.id, orderId: order.id, type: 'EARN' },
        select: { id: true },
      });
      if (already) return;

      await this.prisma.$transaction([
        this.prisma.loyaltyAccount.update({
          where: { id: account.id },
          data: { points: { increment: earned } },
        }),
        this.prisma.loyaltyTransaction.create({
          data: {
            tenantId: order.tenantId,
            accountId: account.id,
            type: 'EARN',
            points: earned,
            orderId: order.id,
          },
        }),
      ]);
    } catch (err) {
      this.logger.error(`No se pudieron acreditar puntos del pedido ${order.id}: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- canje

  /**
   * Canjea puntos como descuento sobre un pedido abierto. Reutiliza la MISMA
   * validación de tope que el descuento del POS (`applyDiscountToOrder`), así
   * que un canje tampoco puede dejar el total negativo.
   */
  async redeem(args: { orderId: string; phone: string; points: number; userId: string }) {
    if (args.points <= 0) throw new BadRequestException('La cantidad de puntos a canjear tiene que ser mayor a 0');

    const program = await this.tenantPrisma.client.loyaltyProgram.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
    if (!program || !program.active) throw new BadRequestException('El programa de puntos no está activo');

    const account = await this.getAccount(args.phone);
    if (!account) throw new NotFoundException('No hay una cuenta de puntos para ese teléfono');
    if (account.points < args.points) {
      throw new BadRequestException(`El cliente tiene ${account.points} puntos, no alcanza para canjear ${args.points}`);
    }

    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: args.orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new ConflictException('No se puede canjear sobre un pedido cerrado');
    }

    const pointValue = Number(program.pointValue);
    const requestedAmount = Math.round(args.points * pointValue * 100) / 100;

    // El descuento no puede superar lo que queda por descontar del pedido. Si
    // el canje pedido excede eso, se canjean solo los puntos que ENTRAN —no se
    // le descuentan puntos al cliente que no se usaron.
    const applied = applyDiscountToOrder(
      Number(order.subtotal),
      Number(order.taxTotal),
      Number(order.discountTotal),
      requestedAmount,
    );

    let pointsToRedeem = args.points;
    let discountAmount = requestedAmount;
    if (!applied.ok) {
      const maxRedeemable = Math.floor(applied.discountableRemaining / pointValue);
      if (maxRedeemable <= 0) {
        throw new BadRequestException('Este pedido ya no admite más descuento');
      }
      pointsToRedeem = maxRedeemable;
      discountAmount = Math.round(maxRedeemable * pointValue * 100) / 100;
    }

    const finalApplied = applyDiscountToOrder(
      Number(order.subtotal),
      Number(order.taxTotal),
      Number(order.discountTotal),
      discountAmount,
    );
    if (!finalApplied.ok) throw new BadRequestException('No se pudo aplicar el canje');

    // Todo junto: el descuento, el saldo de puntos y el ledger tienen que
    // moverse o no moverse — nunca un descuento aplicado sin descontar puntos.
    await this.tenantPrisma.client.$transaction(async (tx) => {
      // El descuento de puntos va PRIMERO y con guarda de saldo en la MISMA
      // sentencia (`points >= pointsToRedeem`): el `decrement` suelto era
      // atómico pero no verificaba nada, así que dos canjes simultáneos del
      // mismo saldo pasaban los dos y la cuenta quedaba en negativo — el cliente
      // se llevaba dos descuentos que no tenía. Mismo patrón que `coupons.redeem`.
      const spent = await tx.loyaltyAccount.updateMany({
        where: { id: account.id, points: { gte: pointsToRedeem } },
        data: { points: { decrement: pointsToRedeem } },
      });
      if (spent.count === 0) {
        throw new ConflictException('El cliente ya no tiene esos puntos disponibles');
      }

      await tx.discount.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          orderId: order.id,
          type: 'FIXED_AMOUNT',
          value: discountAmount,
          amount: discountAmount,
          appliedById: args.userId,
          reason: `Canje de ${pointsToRedeem} puntos`,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          discountTotal: finalApplied.newDiscountTotal,
          // Sumar de vuelta el deliveryFee: el helper lo ignora y sin esto el
          // canje de puntos borraba el envío del total (undercobro).
          total: finalApplied.newTotal + Number(order.deliveryFee ?? 0),
        },
      });
      await tx.loyaltyTransaction.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          accountId: account.id,
          type: 'REDEEM',
          points: -pointsToRedeem,
          orderId: order.id,
          note: `Descuento ${discountAmount}`,
        },
      });
    });

    return {
      pointsRedeemed: pointsToRedeem,
      discountAmount,
      remainingPoints: account.points - pointsToRedeem,
      newOrderTotal: finalApplied.newTotal,
    };
  }
}
