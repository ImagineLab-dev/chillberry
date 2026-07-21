import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(dto: CreateZoneDto) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');

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

  async update(id: string, dto: UpdateZoneDto) {
    await this.getOrThrow(id);
    return this.tenantPrisma.client.deliveryZone.update({ where: { id }, data: dto });
  }

  /**
   * "Quitar" una zona = soft-delete (`active:false`). No se borra en duro
   * porque los pedidos guardan su `zoneId` y perderíamos la trazabilidad del
   * envío. Al quedar inactiva desaparece de `list()` (que filtra active:true)
   * y ya no se puede elegir en un pedido nuevo.
   */
  async remove(id: string) {
    await this.getOrThrow(id);
    await this.tenantPrisma.client.deliveryZone.updateMany({ where: { id }, data: { active: false } });
    return { ok: true };
  }

  async getOrThrow(id: string) {
    const zone = await this.tenantPrisma.client.deliveryZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException('Zona de delivery no encontrada');
    return zone;
  }
}
