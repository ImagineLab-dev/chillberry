import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateMenuCategoryDto } from './dto/create-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuCategoryDto } from './dto/update-category.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

@Injectable()
export class MenuService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private async assertBranchExists(branchId: string) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
  }

  async createCategory(dto: CreateMenuCategoryDto) {
    await this.assertBranchExists(dto.branchId);
    return this.tenantPrisma.client.menuCategory.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId },
    });
  }

  listCategories(branchId: string) {
    return this.tenantPrisma.client.menuCategory.findMany({
      where: { branchId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getCategoryOrThrow(id: string) {
    const category = await this.tenantPrisma.client.menuCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }

  async updateCategory(id: string, dto: UpdateMenuCategoryDto) {
    await this.getCategoryOrThrow(id);
    return this.tenantPrisma.client.menuCategory.update({ where: { id }, data: dto });
  }

  /**
   * "Borrar" una categoría es desactivarla (`active: false`), no un DELETE
   * físico — los MenuItem que la referencian (`categoryId`) seguirían
   * existiendo y el FK no lo permitiría de todos modos si hubiera pedidos
   * históricos vía sus items. Mismo criterio que `deleteItem` más abajo.
   */
  async deactivateCategory(id: string) {
    await this.getCategoryOrThrow(id);
    return this.tenantPrisma.client.menuCategory.update({ where: { id }, data: { active: false } });
  }

  async createItem(dto: CreateMenuItemDto) {
    await this.assertBranchExists(dto.branchId);
    if (dto.categoryId) {
      const category = await this.tenantPrisma.client.menuCategory.findFirst({
        where: { id: dto.categoryId, branchId: dto.branchId },
      });
      if (!category) throw new NotFoundException('Categoría no encontrada en esta sucursal');
    }
    if (dto.stationId) {
      const station = await this.tenantPrisma.client.kitchenStation.findFirst({
        where: { id: dto.stationId, branchId: dto.branchId },
      });
      if (!station) throw new NotFoundException('Estación de cocina no encontrada en esta sucursal');
    }
    return this.tenantPrisma.client.menuItem.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId },
    });
  }

  /**
   * `includeInactive` lo usa la pantalla de administración de menú (para
   * poder reactivar productos dados de baja) — los pickers de mesero/POS/
   * pedidos NUNCA deben mandar este flag, así jamás ofrecen un producto
   * desactivado para un pedido nuevo.
   */
  /**
   * Reordena los productos de una sucursal: cada id recibe como `sortOrder` su
   * posición en el array. El front manda la lista completa de una categoría ya
   * ordenada. Valida que todos los ítems sean de la sucursal antes de tocar nada.
   */
  async reorderItems(branchId: string, orderedIds: string[]) {
    await this.assertBranchExists(branchId);
    const found = await this.tenantPrisma.client.menuItem.findMany({
      where: { id: { in: orderedIds }, branchId },
      select: { id: true },
    });
    if (found.length !== orderedIds.length) {
      throw new BadRequestException('Algún producto no pertenece a esta sucursal');
    }
    await this.tenantPrisma.client.$transaction(
      orderedIds.map((id, index) =>
        this.tenantPrisma.client.menuItem.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return { ok: true };
  }

  listItems(branchId: string, includeInactive = false) {
    return this.tenantPrisma.client.menuItem.findMany({
      where: { branchId, ...(includeInactive ? {} : { active: true }) },
      // Orden de la carta: por `sortOrder` (reordenable), y nombre como desempate.
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      // Trae los extras activos de cada producto para que el mesero y
      // /admin/orders puedan ofrecerlos igual que la carta del comensal — antes
      // esta lista venía plana y por eso el staff no podía cargar extras.
      include: {
        modifierGroups: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          include: { options: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
        },
        // Componentes del combo (si `isCombo`), para mostrar "Incluye: ..." en
        // los pickers de pedido sin un fetch aparte.
        comboComponents: {
          include: { component: { select: { id: true, name: true } } },
          orderBy: { quantity: 'desc' },
        },
      },
    });
  }

  /**
   * Reconvierte por un tipo de cambio TODOS los montos del tenant que siguen a
   * la moneda: precio/costo de cada producto, `priceDelta` de cada extra, la
   * tarifa de envío de cada sucursal, las tarifas/mínimos de las zonas de
   * delivery, y la config de puntos (earnPer/pointValue). Es lo que corre al
   * cambiar de moneda para que los MONTOS —no sólo el símbolo— queden bien.
   * Todo en una transacción: o se convierte todo o nada. Si algún resultado se
   * sale del rango de la columna (`Decimal(10,2)`), devuelve 400 en vez de que
   * Postgres tire un overflow 500 y quede a medias.
   */
  async convertPrices(rate: number) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const DECIMAL_MAX = 99_999_999.99;
    const conv = (val: number) => {
      const r = round2(val * rate);
      if (Math.abs(r) > DECIMAL_MAX) {
        throw new BadRequestException(
          'Con ese tipo de cambio algún precio se pasa del máximo (99.999.999,99) — usá un valor más chico o revisá los precios.',
        );
      }
      return r;
    };

    const [items, options, branches, zones, coupons, ingredients, loyalty] = await Promise.all([
      this.tenantPrisma.client.menuItem.findMany({ select: { id: true, price: true, cost: true } }),
      this.tenantPrisma.client.modifierOption.findMany({ select: { id: true, priceDelta: true } }),
      this.tenantPrisma.client.branch.findMany({ select: { id: true, deliveryFee: true } }),
      this.tenantPrisma.client.deliveryZone.findMany({
        select: { id: true, baseFee: true, perKmFee: true, minOrderAmount: true },
      }),
      // Los cupones también llevan montos en la moneda del tenant. Omitirlos era
      // peligroso: un cupón fijo de ₲50.000, al pasar a USD sin convertir,
      // quedaba valiendo USD 50.000 → `computeAmount` lo capa al subtotal → 100%
      // de descuento en cada canje hasta agotar los usos. OJO: sólo se convierte
      // el `value` de los FIXED_AMOUNT — en los PERCENTAGE `value` es un % y
      // convertirlo lo rompería.
      this.tenantPrisma.client.coupon.findMany({
        select: { id: true, discountType: true, value: true, minOrderAmount: true },
      }),
      // Costo de insumos: sin esto, los márgenes de los reportes quedan en la
      // moneda vieja mientras el precio de venta ya está convertido.
      this.tenantPrisma.client.ingredient.findMany({ select: { id: true, costPerUnit: true } }),
      // LoyaltyProgram NO es tenant-scoped por el extension (ver
      // tenant-scoped-models.ts) — filtrar por tenantId explícito.
      this.tenantPrisma.client.loyaltyProgram.findFirst({
        where: { tenantId: this.tenantPrisma.tenantId },
        select: { id: true, earnPer: true, pointValue: true },
      }),
    ]);

    // `conv` puede tirar 400 acá, ANTES de abrir la transacción — nada se
    // escribe si algún valor se pasa de rango.
    const ops = [
      ...items.map((it) =>
        this.tenantPrisma.client.menuItem.update({
          where: { id: it.id },
          data: {
            price: conv(Number(it.price)),
            ...(it.cost != null ? { cost: conv(Number(it.cost)) } : {}),
          },
        }),
      ),
      ...options.map((o) =>
        this.tenantPrisma.client.modifierOption.update({
          where: { id: o.id },
          data: { priceDelta: conv(Number(o.priceDelta)) },
        }),
      ),
      ...branches.map((b) =>
        this.tenantPrisma.client.branch.update({
          where: { id: b.id },
          data: { deliveryFee: conv(Number(b.deliveryFee)) },
        }),
      ),
      ...zones.map((z) =>
        this.tenantPrisma.client.deliveryZone.update({
          where: { id: z.id },
          data: {
            baseFee: conv(Number(z.baseFee)),
            ...(z.perKmFee != null ? { perKmFee: conv(Number(z.perKmFee)) } : {}),
            ...(z.minOrderAmount != null ? { minOrderAmount: conv(Number(z.minOrderAmount)) } : {}),
          },
        }),
      ),
      ...(loyalty
        ? [
            this.tenantPrisma.client.loyaltyProgram.update({
              where: { id: loyalty.id },
              data: { earnPer: conv(Number(loyalty.earnPer)), pointValue: conv(Number(loyalty.pointValue)) },
            }),
          ]
        : []),
      ...coupons.map((c) =>
        this.tenantPrisma.client.coupon.update({
          where: { id: c.id },
          data: {
            // El % no se toca; sólo el monto fijo.
            ...(c.discountType === 'FIXED_AMOUNT' ? { value: conv(Number(c.value)) } : {}),
            ...(c.minOrderAmount != null ? { minOrderAmount: conv(Number(c.minOrderAmount)) } : {}),
          },
        }),
      ),
      ...ingredients.map((ing) =>
        ing.costPerUnit != null
          ? this.tenantPrisma.client.ingredient.update({
              where: { id: ing.id },
              data: { costPerUnit: conv(Number(ing.costPerUnit)) },
            })
          : null,
      ).filter((op): op is NonNullable<typeof op> => op !== null),
    ];
    await this.tenantPrisma.client.$transaction(ops);
    return {
      itemsUpdated: items.length,
      optionsUpdated: options.length,
      branchesUpdated: branches.length,
      zonesUpdated: zones.length,
      loyaltyUpdated: loyalty ? 1 : 0,
    };
  }

  async getItemOrThrow(id: string) {
    const item = await this.tenantPrisma.client.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Producto no encontrado');
    return item;
  }

  async updateItem(id: string, dto: UpdateMenuItemDto) {
    const item = await this.getItemOrThrow(id);
    // Categoría/estación deben ser de la MISMA sucursal del producto — si no, el
    // producto saldría en la carta pública de otra sucursal (la carta expande
    // `category.items` por categoryId).
    if (dto.categoryId) {
      const category = await this.tenantPrisma.client.menuCategory.findFirst({
        where: { id: dto.categoryId, branchId: item.branchId },
      });
      if (!category) throw new NotFoundException('Categoría no encontrada en esta sucursal');
    }
    if (dto.stationId) {
      const station = await this.tenantPrisma.client.kitchenStation.findFirst({
        where: { id: dto.stationId, branchId: item.branchId },
      });
      if (!station) throw new NotFoundException('Estación de cocina no encontrada en esta sucursal');
    }
    return this.tenantPrisma.client.menuItem.update({ where: { id }, data: dto });
  }

  /** Soft-delete: ver comentario de `deactivateCategory`. */
  async deactivateItem(id: string) {
    await this.getItemOrThrow(id);
    return this.tenantPrisma.client.menuItem.update({ where: { id }, data: { active: false } });
  }
}
