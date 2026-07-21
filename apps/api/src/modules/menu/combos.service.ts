import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { ComboComponentInput, CreateComboDto, UpdateComboDto } from './dto/combo.dto';

/**
 * Combos = MenuItem con `isCombo=true` + una lista de componentes. Se pide y
 * cobra como cualquier producto (el precio del combo es el `price` del MenuItem),
 * así el camino de pedido/POS/totales no cambia. Este service sólo maneja el
 * ABM del combo y sus componentes.
 */
@Injectable()
export class CombosService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private readonly componentInclude = {
    comboComponents: {
      include: { component: { select: { id: true, name: true, price: true } } },
      orderBy: { quantity: 'desc' as const },
    },
  };

  private async validateComponents(branchId: string, components: ComboComponentInput[]) {
    const ids = [...new Set(components.map((c) => c.menuItemId))];
    const items = await this.tenantPrisma.client.menuItem.findMany({
      where: { id: { in: ids }, branchId },
      select: { id: true, isCombo: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of ids) {
      const it = byId.get(id);
      // El client ya está scopeado por tenant y filtramos por branchId, así que
      // esto también evita meter en el combo un producto de otra sucursal/tenant.
      if (!it) throw new BadRequestException('Algún producto del combo no existe en esta sucursal');
      if (it.isCombo) throw new BadRequestException('Un combo no puede contener otro combo');
    }
  }

  private async assertRefs(branchId: string, categoryId?: string, stationId?: string) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    // Categoría/estación DEBEN ser de esta MISMA sucursal (no solo del tenant):
    // si no, el combo saldría en la carta pública de otra sucursal (la carta se
    // arma expandiendo `category.items`, que sigue el categoryId).
    if (categoryId) {
      const cat = await this.tenantPrisma.client.menuCategory.findFirst({ where: { id: categoryId, branchId } });
      if (!cat) throw new NotFoundException('Categoría no encontrada en esta sucursal');
    }
    if (stationId) {
      const st = await this.tenantPrisma.client.kitchenStation.findFirst({ where: { id: stationId, branchId } });
      if (!st) throw new NotFoundException('Estación de cocina no encontrada en esta sucursal');
    }
  }

  async create(dto: CreateComboDto) {
    await this.assertRefs(dto.branchId, dto.categoryId, dto.stationId);
    await this.validateComponents(dto.branchId, dto.components);

    return this.tenantPrisma.client.menuItem.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        categoryId: dto.categoryId,
        stationId: dto.stationId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        imageUrl: dto.imageUrl,
        isCombo: true,
        comboComponents: {
          create: dto.components.map((c) => ({
            tenantId: this.tenantPrisma.tenantId,
            componentMenuItemId: c.menuItemId,
            quantity: c.quantity,
          })),
        },
      },
      include: this.componentInclude,
    });
  }

  list(branchId: string, includeInactive = false) {
    return this.tenantPrisma.client.menuItem.findMany({
      where: { branchId, isCombo: true, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
      include: this.componentInclude,
    });
  }

  private async getComboOrThrow(id: string) {
    const combo = await this.tenantPrisma.client.menuItem.findUnique({ where: { id } });
    if (!combo || !combo.isCombo) throw new NotFoundException('Combo no encontrado');
    return combo;
  }

  async update(id: string, dto: UpdateComboDto) {
    const combo = await this.getComboOrThrow(id);
    await this.assertRefs(combo.branchId, dto.categoryId, dto.stationId);
    if (dto.components) await this.validateComponents(combo.branchId, dto.components);

    // Si vienen componentes, se reemplaza la lista entera (borrar + recrear).
    // Todo en una transacción con el update de los campos base.
    await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.menuItem.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          stationId: dto.stationId,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          imageUrl: dto.imageUrl,
          active: dto.active,
        },
      }),
      ...(dto.components
        ? [
            this.tenantPrisma.client.comboComponent.deleteMany({ where: { comboMenuItemId: id } }),
            this.tenantPrisma.client.comboComponent.createMany({
              data: dto.components.map((c) => ({
                tenantId: this.tenantPrisma.tenantId,
                comboMenuItemId: id,
                componentMenuItemId: c.menuItemId,
                quantity: c.quantity,
              })),
            }),
          ]
        : []),
    ]);
    return this.tenantPrisma.client.menuItem.findUnique({ where: { id }, include: this.componentInclude });
  }

  /** Baja lógica (misma convención que el resto del menú). */
  async deactivate(id: string) {
    await this.getComboOrThrow(id);
    return this.tenantPrisma.client.menuItem.update({ where: { id }, data: { active: false } });
  }
}
