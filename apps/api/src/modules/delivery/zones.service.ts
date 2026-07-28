import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { assertPuedeUsarSucursal } from '../../common/security/branch-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(dto: CreateZoneDto, actor: AuthenticatedUser) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    // Las zonas (y sus tarifas: baseFee/perKmFee/minOrderAmount) son de una
    // sucursal: un ADMIN atado a un local no puede crear/tocar las de otro. El
    // controller no chequeaba sucursal — era el mismo gap que ya cerró tables.
    assertPuedeUsarSucursal(actor, branch.id);

    return this.tenantPrisma.client.deliveryZone.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId },
    });
  }

  list(branchId: string) {
    return this.tenantPrisma.client.deliveryZone.findMany({
      where: { branchId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, dto: UpdateZoneDto, actor: AuthenticatedUser) {
    const zone = await this.getOrThrow(id);
    assertPuedeUsarSucursal(actor, zone.branchId);
    return this.tenantPrisma.client.deliveryZone.update({ where: { id }, data: dto });
  }

  /**
   * "Quitar" una zona = soft-delete (`active:false`). No se borra en duro
   * porque los pedidos guardan su `zoneId` y perderíamos la trazabilidad del
   * envío. Al quedar inactiva desaparece de `list()` (que filtra active:true)
   * y ya no se puede elegir en un pedido nuevo.
   */
  async remove(id: string, actor: AuthenticatedUser) {
    const zone = await this.getOrThrow(id);
    assertPuedeUsarSucursal(actor, zone.branchId);
    await this.tenantPrisma.client.deliveryZone.updateMany({ where: { id }, data: { active: false } });
    return { ok: true };
  }

  async getOrThrow(id: string) {
    const zone = await this.tenantPrisma.client.deliveryZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException('Zona de delivery no encontrada');
    return zone;
  }
}
