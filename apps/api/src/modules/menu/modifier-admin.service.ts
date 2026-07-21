import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import {
  CreateModifierGroupDto,
  CreateModifierOptionDto,
  UpdateModifierGroupDto,
  UpdateModifierOptionDto,
} from './dto/modifier.dto';

/**
 * ABM de modificadores para el admin. Separado de `ModifiersService` (que
 * resuelve precios al crear un pedido) porque son dos responsabilidades y dos
 * niveles de acceso distintos: esto es OWNER/ADMIN vía JWT, aquello corre
 * también en el camino público del QR.
 *
 * Baja lógica (`active: false`) en vez de borrado físico — convención del
 * proyecto: los pedidos históricos guardan un snapshot del modificador, así que
 * borrar la fila no los rompe, pero desactivar mantiene el ABM reversible.
 */
@Injectable()
export class ModifierAdminService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async listGroups(menuItemId: string, includeInactive = false) {
    await this.assertMenuItem(menuItemId);
    return this.tenantPrisma.client.modifierGroup.findMany({
      where: { menuItemId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { sortOrder: 'asc' },
      include: {
        options: {
          where: includeInactive ? {} : { active: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async createGroup(menuItemId: string, dto: CreateModifierGroupDto) {
    await this.assertMenuItem(menuItemId);
    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? 1;
    this.assertSelectRange(minSelect, maxSelect);

    return this.tenantPrisma.client.modifierGroup.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        menuItemId,
        name: dto.name,
        minSelect,
        maxSelect,
        required: dto.required ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { options: true },
    });
  }

  async updateGroup(groupId: string, dto: UpdateModifierGroupDto) {
    const group = await this.tenantPrisma.client.modifierGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Grupo de opciones no encontrado');

    // Se valida contra el estado resultante, no contra el del DTO: un update
    // parcial que sube minSelect sin tocar maxSelect también puede invertirlos.
    this.assertSelectRange(dto.minSelect ?? group.minSelect, dto.maxSelect ?? group.maxSelect);

    return this.tenantPrisma.client.modifierGroup.update({
      where: { id: groupId },
      data: dto,
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async deactivateGroup(groupId: string) {
    const group = await this.tenantPrisma.client.modifierGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Grupo de opciones no encontrado');
    return this.tenantPrisma.client.modifierGroup.update({
      where: { id: groupId },
      data: { active: false },
    });
  }

  async createOption(groupId: string, dto: CreateModifierOptionDto) {
    const group = await this.tenantPrisma.client.modifierGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Grupo de opciones no encontrado');

    return this.tenantPrisma.client.modifierOption.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        groupId,
        name: dto.name,
        priceDelta: dto.priceDelta ?? 0,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateOption(optionId: string, dto: UpdateModifierOptionDto) {
    const option = await this.tenantPrisma.client.modifierOption.findUnique({ where: { id: optionId } });
    if (!option) throw new NotFoundException('Opción no encontrada');
    return this.tenantPrisma.client.modifierOption.update({ where: { id: optionId }, data: dto });
  }

  async deactivateOption(optionId: string) {
    const option = await this.tenantPrisma.client.modifierOption.findUnique({ where: { id: optionId } });
    if (!option) throw new NotFoundException('Opción no encontrada');
    return this.tenantPrisma.client.modifierOption.update({
      where: { id: optionId },
      data: { active: false },
    });
  }

  // ----------------------------------------------------------------- helpers

  private async assertMenuItem(menuItemId: string) {
    const item = await this.tenantPrisma.client.menuItem.findUnique({ where: { id: menuItemId } });
    if (!item) throw new NotFoundException('Producto no encontrado');
  }

  private assertSelectRange(minSelect: number, maxSelect: number) {
    if (minSelect > maxSelect) {
      throw new BadRequestException('El mínimo de opciones no puede ser mayor que el máximo');
    }
  }
}
