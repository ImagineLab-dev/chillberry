import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { logger } from '../../common/logging/logger';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CountStockDto } from './dto/count-stock.dto';
import { SetRecipeComponentDto } from './dto/set-recipe-component.dto';

@Injectable()
export class InventoryService {
  constructor(
    // Crudo para la DEPLECIÓN: corre desde el cierre del pedido, que puede
    // ejecutarse sin JWT en contexto (webhook de pago) → sin tenantId en ALS.
    // Por eso la depleción scopea con el tenantId que trae el propio pedido.
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  // --------------------------------------------------------------- insumos

  listIngredients(branchId: string) {
    return this.tenantPrisma.client.ingredient.findMany({
      where: { branchId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  /** Solo los insumos con alerta configurada y por debajo (o en) el umbral. */
  async lowStock(branchId: string) {
    const all = await this.tenantPrisma.client.ingredient.findMany({
      where: { branchId, active: true, lowStockAt: { not: null } },
      orderBy: { name: 'asc' },
    });
    return all.filter((i) => Number(i.stockQty) <= Number(i.lowStockAt));
  }

  async createIngredient(dto: CreateIngredientDto) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    try {
      return await this.tenantPrisma.client.ingredient.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          branchId: dto.branchId,
          name: dto.name.trim(),
          unit: dto.unit.trim(),
          stockQty: dto.stockQty ?? 0,
          lowStockAt: dto.lowStockAt ?? null,
          costPerUnit: dto.costPerUnit ?? null,
        },
      });
    } catch (err) {
      throw this.mapDuplicateName(err);
    }
  }

  async updateIngredient(id: string, dto: UpdateIngredientDto) {
    await this.getIngredientOrThrow(id);
    try {
      return await this.tenantPrisma.client.ingredient.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name.trim() } : {}),
          ...(dto.unit != null ? { unit: dto.unit.trim() } : {}),
          // lowStockAt/costPerUnit aceptan null explícito para "quitar".
          ...(dto.lowStockAt !== undefined ? { lowStockAt: dto.lowStockAt } : {}),
          ...(dto.costPerUnit !== undefined ? { costPerUnit: dto.costPerUnit } : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
      });
    } catch (err) {
      throw this.mapDuplicateName(err);
    }
  }

  /** P2002 = violación de `@@unique([branchId,name])` → 409 amable, no 500. */
  private mapDuplicateName(err: unknown): unknown {
    if ((err as { code?: string }).code === 'P2002') {
      return new ConflictException('Ya existe un insumo con ese nombre en esta sucursal');
    }
    return err;
  }

  /** Suma (o resta, si `delta` es negativo) al stock — para reponer, corregir o
   *  cargar merma. Deja una fila en el libro mayor (`StockMovement`). */
  async adjustStock(id: string, dto: AdjustStockDto, userId: string) {
    await this.getIngredientOrThrow(id);
    const [updated] = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.ingredient.update({
        where: { id },
        data: { stockQty: { increment: dto.delta } },
      }),
      this.tenantPrisma.client.stockMovement.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          ingredientId: id,
          type: dto.type ?? 'ADJUST',
          quantityDelta: dto.delta,
          reason: dto.reason?.trim() || null,
          userId,
        },
      }),
    ]);
    return updated;
  }

  /** Conteo físico: setea el stock al valor contado y registra el delta como
   *  un movimiento COUNT (auditoría del arqueo de inventario). */
  async countStock(id: string, dto: CountStockDto, userId: string) {
    const ing = await this.getIngredientOrThrow(id);
    const delta = dto.countedQty - Number(ing.stockQty);
    const [updated] = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.ingredient.update({
        where: { id },
        data: { stockQty: dto.countedQty },
      }),
      this.tenantPrisma.client.stockMovement.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          ingredientId: id,
          type: 'COUNT',
          quantityDelta: delta,
          reason: dto.reason?.trim() || 'Conteo físico',
          userId,
        },
      }),
    ]);
    return updated;
  }

  /** Historial de movimientos de un insumo (más recientes primero). */
  async listMovements(ingredientId: string) {
    await this.getIngredientOrThrow(ingredientId);
    return this.tenantPrisma.client.stockMovement.findMany({
      where: { ingredientId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Borra el insumo si no participa en ninguna receta; si participa, 409. */
  async removeIngredient(id: string) {
    await this.getIngredientOrThrow(id);
    const uses = await this.tenantPrisma.client.recipeComponent.count({ where: { ingredientId: id } });
    if (uses > 0) {
      throw new ConflictException(
        'Este insumo está usado en recetas y no se puede eliminar. Desactivalo o sacalo de las recetas primero.',
      );
    }
    await this.tenantPrisma.client.ingredient.deleteMany({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- recetas

  async getRecipe(menuItemId: string) {
    await this.getMenuItemOrThrow(menuItemId);
    return this.tenantPrisma.client.recipeComponent.findMany({
      where: { menuItemId },
      include: { ingredient: { select: { id: true, name: true, unit: true, stockQty: true, active: true } } },
      orderBy: { ingredient: { name: 'asc' } },
    });
  }

  /** Alta o edición de un renglón de receta (upsert por producto+insumo). */
  async setRecipeComponent(menuItemId: string, dto: SetRecipeComponentDto) {
    await this.getMenuItemOrThrow(menuItemId);
    const ingredient = await this.tenantPrisma.client.ingredient.findFirst({ where: { id: dto.ingredientId } });
    if (!ingredient) throw new NotFoundException('Insumo no encontrado');

    const existing = await this.tenantPrisma.client.recipeComponent.findFirst({
      where: { menuItemId, ingredientId: dto.ingredientId },
    });
    if (existing) {
      return this.tenantPrisma.client.recipeComponent.update({
        where: { id: existing.id },
        data: { quantity: dto.quantity },
      });
    }
    return this.tenantPrisma.client.recipeComponent.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        menuItemId,
        ingredientId: dto.ingredientId,
        quantity: dto.quantity,
      },
    });
  }

  async removeRecipeComponent(menuItemId: string, ingredientId: string) {
    const result = await this.tenantPrisma.client.recipeComponent.deleteMany({
      where: { menuItemId, ingredientId },
    });
    if (result.count === 0) throw new NotFoundException('Renglón de receta no encontrado');
    return { ok: true };
  }

  // -------------------------------------------------------------- depleción

  /**
   * Descuenta del stock los insumos consumidos por un pedido ya vendido. Se
   * llama al COMPLETAR el pedido (solo lo vendido consume stock; un pedido
   * cancelado no descuenta). Best-effort: nunca rompe el cierre del pedido.
   * Usa el cliente crudo y scopea con el tenantId del pedido (puede correr sin
   * tenant en ALS, ver constructor).
   */
  async depleteForOrder(orderId: string): Promise<void> {
    try {
      const calc = await this.computeConsumption(orderId);
      if (!calc) return;
      await this.applyConsumption(
        calc.tenantId,
        calc.consumed,
        'SALE',
        `Venta pedido ${orderId.slice(0, 8)}`,
      );
    } catch (err) {
      logger.error({ err, orderId }, 'Fallo al descontar inventario del pedido (no bloqueante)');
    }
  }

  /**
   * Cuánto insumo consume un pedido, según la receta de cada producto. Un COMBO
   * se pide como un solo OrderItem pero no tiene receta propia: su consumo es el
   * de sus componentes, por eso se expanden.
   *
   * Lo comparten la depleción por venta y el registro de merma por anulación:
   * son la misma cuenta con distinto motivo.
   */
  private async computeConsumption(
    orderId: string,
  ): Promise<{ tenantId: string; consumed: Map<string, number> } | null> {
    {
      const items = await this.prisma.orderItem.findMany({
        where: { orderId },
        select: { menuItemId: true, quantity: true, tenantId: true },
      });
      if (items.length === 0) return null;
      const tenantId = items[0]!.tenantId;
      const orderedIds = [...new Set(items.map((i) => i.menuItemId))];

      // Un COMBO se pide como un solo OrderItem pero no tiene receta propia: su
      // consumo es el de sus componentes. Detectamos cuáles de los ids pedidos
      // son combos y traemos sus componentes para expandir el consumo real.
      const menuItems = await this.prisma.menuItem.findMany({
        where: { id: { in: orderedIds }, tenantId },
        select: { id: true, isCombo: true },
      });
      const comboIds = menuItems.filter((m) => m.isCombo).map((m) => m.id);
      const comboComponents = comboIds.length
        ? await this.prisma.comboComponent.findMany({
            where: { comboMenuItemId: { in: comboIds }, tenantId },
            select: { comboMenuItemId: true, componentMenuItemId: true, quantity: true },
          })
        : [];
      const componentsByCombo = new Map<string, { componentMenuItemId: string; quantity: number }[]>();
      for (const cc of comboComponents) {
        const list = componentsByCombo.get(cc.comboMenuItemId) ?? [];
        list.push({ componentMenuItemId: cc.componentMenuItemId, quantity: cc.quantity });
        componentsByCombo.set(cc.comboMenuItemId, list);
      }

      // El set de ids con receta = productos simples pedidos + componentes de combos.
      const recipeItemIds = [
        ...new Set([
          ...orderedIds.filter((id) => !comboIds.includes(id)),
          ...comboComponents.map((cc) => cc.componentMenuItemId),
        ]),
      ];
      if (recipeItemIds.length === 0) return null;

      const recipes = await this.prisma.recipeComponent.findMany({
        where: { menuItemId: { in: recipeItemIds }, tenantId },
        select: { menuItemId: true, ingredientId: true, quantity: true },
      });
      if (recipes.length === 0) return null;

      const recipeByItem = new Map<string, { ingredientId: string; quantity: number }[]>();
      for (const r of recipes) {
        const list = recipeByItem.get(r.menuItemId) ?? [];
        list.push({ ingredientId: r.ingredientId, quantity: Number(r.quantity) });
        recipeByItem.set(r.menuItemId, list);
      }

      // Suma el consumo total por insumo antes de tocar la DB. Para un combo,
      // recorre cada componente (cantidad del componente × unidades vendidas).
      const consumedByIngredient = new Map<string, number>();
      const consume = (menuItemId: string, units: number) => {
        for (const rc of recipeByItem.get(menuItemId) ?? []) {
          const prev = consumedByIngredient.get(rc.ingredientId) ?? 0;
          consumedByIngredient.set(rc.ingredientId, prev + rc.quantity * units);
        }
      };
      for (const item of items) {
        const combo = componentsByCombo.get(item.menuItemId);
        if (combo) {
          for (const comp of combo) consume(comp.componentMenuItemId, comp.quantity * item.quantity);
        } else {
          consume(item.menuItemId, item.quantity);
        }
      }

      return { tenantId, consumed: consumedByIngredient };
    }
  }

  /**
   * Registra como MERMA los insumos de un pedido que se anuló DESPUÉS de
   * haberse preparado.
   *
   * Antes esto no existía y dejaba un agujero en el inventario: la depleción
   * corre al COMPLETAR, así que un pedido anulado nunca descontaba nada — pero
   * la comida ya estaba cocinada y se tiró. Cada anulación tardía inflaba el
   * stock teórico, y el encargado tenía que acordarse de cargar la merma a mano.
   *
   * Va como `WASTE` y no como `SALE` a propósito: no es una venta, y en los
   * reportes de costo tiene que poder distinguirse cuánto se perdió tirando
   * comida. Best-effort, igual que la depleción: nunca bloquea la anulación.
   */
  async registerWasteForOrder(orderId: string, motivo: string): Promise<void> {
    try {
      const calc = await this.computeConsumption(orderId);
      if (!calc) return;
      await this.applyConsumption(
        calc.tenantId,
        calc.consumed,
        'WASTE',
        `Anulación pedido ${orderId.slice(0, 8)} — ${motivo}`,
      );
    } catch (err) {
      logger.error({ err, orderId }, 'Fallo al registrar la merma del pedido anulado (no bloqueante)');
    }
  }

  /** Baja de stock + fila en el libro mayor, compartida por venta y merma. */
  private async applyConsumption(
    tenantId: string,
    consumedByIngredient: Map<string, number>,
    type: 'SALE' | 'WASTE',
    reason: string,
  ): Promise<void> {
    for (const [ingredientId, consumed] of consumedByIngredient) {
      await this.prisma.ingredient.updateMany({
        where: { id: ingredientId, tenantId },
        data: { stockQty: { decrement: consumed } },
      });
      // `userId` null: lo dispara el sistema (el cobro o la anulación), no una
      // persona cargando el movimiento a mano.
      await this.prisma.stockMovement.create({
        data: { tenantId, ingredientId, type, quantityDelta: -consumed, reason, userId: null },
      });
    }
  }

  // ----------------------------------------------------------------- helpers

  private async getIngredientOrThrow(id: string) {
    const ing = await this.tenantPrisma.client.ingredient.findFirst({ where: { id } });
    if (!ing) throw new NotFoundException('Insumo no encontrado');
    return ing;
  }

  private async getMenuItemOrThrow(id: string) {
    const item = await this.tenantPrisma.client.menuItem.findFirst({ where: { id } });
    if (!item) throw new NotFoundException('Producto no encontrado');
    return item;
  }
}
