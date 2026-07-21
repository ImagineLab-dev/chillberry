import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

/** Lo que devuelve una validación exitosa: el cupón y cuánto descuenta. */
export type ValidatedCoupon = { couponId: string; code: string; amount: number };

/**
 * Cupones de descuento con código REAL (a diferencia de `Discount.couponCode`,
 * que es una etiqueta libre). Dos superficies:
 *  - ADMIN (con tenant en el ALS): alta/edición/listado → cliente scopeado.
 *  - CANJE: puede correr SIN tenant en el contexto (checkout público de la
 *    carta), por eso `validate`/`redeem` reciben el `tenantId` explícito y usan
 *    el cliente CRUDO — mismo criterio que Loyalty/Inventario.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  // --------------------------------------------------------------- admin

  list() {
    return this.tenantPrisma.client.coupon.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(dto: CreateCouponDto, userId: string) {
    this.assertValueInRange(dto.discountType, dto.value);
    try {
      return await this.tenantPrisma.client.coupon.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          code: normalizeCode(dto.code),
          description: dto.description?.trim() || null,
          discountType: dto.discountType,
          value: dto.value,
          minOrderAmount: dto.minOrderAmount ?? null,
          maxUses: dto.maxUses ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          createdById: userId,
        },
      });
    } catch (err) {
      throw this.mapDuplicateCode(err);
    }
  }

  async update(id: string, dto: UpdateCouponDto) {
    const coupon = await this.getOrThrow(id);
    if (dto.value != null) this.assertValueInRange(dto.discountType ?? coupon.discountType, dto.value);
    try {
      return await this.tenantPrisma.client.coupon.update({
        where: { id },
        data: {
          ...(dto.code != null ? { code: normalizeCode(dto.code) } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.discountType != null ? { discountType: dto.discountType } : {}),
          ...(dto.value != null ? { value: dto.value } : {}),
          ...(dto.minOrderAmount !== undefined ? { minOrderAmount: dto.minOrderAmount } : {}),
          ...(dto.maxUses !== undefined ? { maxUses: dto.maxUses } : {}),
          ...(dto.expiresAt !== undefined
            ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }
            : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
      });
    } catch (err) {
      throw this.mapDuplicateCode(err);
    }
  }

  /** Baja lógica: un cupón ya canjeado no se borra (rompería la auditoría). */
  async deactivate(id: string) {
    await this.getOrThrow(id);
    return this.tenantPrisma.client.coupon.update({ where: { id }, data: { active: false } });
  }

  /** Canjes de un cupón (auditoría). */
  async redemptions(id: string) {
    await this.getOrThrow(id);
    return this.tenantPrisma.client.couponRedemption.findMany({
      where: { couponId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ------------------------------------------------------- validar/canjear

  /**
   * ¿Este código sirve para una compra de `subtotal`? Devuelve cuánto descuenta.
   * Los mensajes son para mostrarle al cliente final, por eso son explícitos
   * sobre el motivo (venció / sin usos / compra mínima).
   */
  async validate(tenantId: string, rawCode: string, subtotal: number): Promise<ValidatedCoupon> {
    const code = normalizeCode(rawCode);
    const coupon = await this.prisma.coupon.findFirst({ where: { tenantId, code } });
    if (!coupon) throw new BadRequestException('Ese código no existe');
    if (!coupon.active) throw new BadRequestException('Ese cupón ya no está disponible');
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Ese cupón venció');
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('Ese cupón ya alcanzó su límite de usos');
    }
    const min = coupon.minOrderAmount != null ? Number(coupon.minOrderAmount) : null;
    if (min !== null && subtotal < min) {
      throw new BadRequestException(`Este cupón aplica a partir de ${min}`);
    }

    return { couponId: coupon.id, code: coupon.code, amount: computeAmount(coupon, subtotal) };
  }

  /**
   * Registra el canje. El incremento de `usedCount` va con guarda de tope EN LA
   * MISMA sentencia (`usedCount < maxUses`), así dos canjes simultáneos del
   * último uso no lo pasan: el segundo no matchea y devuelve 409.
   */
  async redeem(
    args: {
      tenantId: string;
      couponId: string;
      orderId: string;
      amount: number;
      customerPhone?: string | null;
    },
    /** Cliente de transacción: permite canjear dentro del mismo commit que crea
     *  el pedido (checkout público), así un cupón agotado en carrera revierte
     *  todo en vez de dejar un pedido con descuento indebido. */
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const coupon = await db.coupon.findFirst({
      where: { id: args.couponId, tenantId: args.tenantId },
      select: { id: true, maxUses: true },
    });
    if (!coupon) throw new NotFoundException('Cupón no encontrado');

    const updated = await db.coupon.updateMany({
      where: {
        id: coupon.id,
        tenantId: args.tenantId,
        // Con tope: sólo incrementa si todavía queda lugar (atómico en la DB).
        ...(coupon.maxUses !== null ? { usedCount: { lt: coupon.maxUses } } : {}),
      },
      data: { usedCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConflictException('Ese cupón ya alcanzó su límite de usos');
    }

    await db.couponRedemption.create({
      data: {
        tenantId: args.tenantId,
        couponId: coupon.id,
        orderId: args.orderId,
        amount: args.amount,
        customerPhone: args.customerPhone ?? null,
      },
    });
  }

  // -------------------------------------------------------------- helpers

  private async getOrThrow(id: string) {
    const coupon = await this.tenantPrisma.client.coupon.findFirst({ where: { id } });
    if (!coupon) throw new NotFoundException('Cupón no encontrado');
    return coupon;
  }

  private assertValueInRange(type: 'PERCENTAGE' | 'FIXED_AMOUNT', value: number) {
    if (type === 'PERCENTAGE' && (value <= 0 || value > 100)) {
      throw new BadRequestException('Un cupón por porcentaje tiene que estar entre 1 y 100');
    }
    if (type === 'FIXED_AMOUNT' && value <= 0) {
      throw new BadRequestException('El monto del cupón tiene que ser mayor a 0');
    }
  }

  private mapDuplicateCode(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('Ya existe un cupón con ese código');
    }
    return err;
  }
}

/** Los códigos se comparan en mayúsculas y sin espacios ("vuelve15" = "VUELVE15"). */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Cuánto descuenta sobre `subtotal`. Nunca más que el subtotal (total negativo). */
function computeAmount(
  coupon: { discountType: string; value: Prisma.Decimal },
  subtotal: number,
): number {
  const value = Number(coupon.value);
  const raw = coupon.discountType === 'PERCENTAGE' ? (subtotal * value) / 100 : value;
  return Math.min(Math.round(raw * 100) / 100, subtotal);
}
