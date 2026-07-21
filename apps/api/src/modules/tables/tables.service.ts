import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(dto: CreateTableDto) {
    const branch = await this.tenantPrisma.client.branch.findUnique({
      where: { id: dto.branchId },
    });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');

    return this.tenantPrisma.client.table.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId, qrToken: this.generateQrToken() },
    });
  }

  list(branchId?: string) {
    return this.tenantPrisma.client.table.findMany({
      where: branchId ? { branchId } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async getOrThrow(id: string) {
    const table = await this.tenantPrisma.client.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException('Mesa no encontrada');
    return table;
  }

  /**
   * Ojo con la respuesta: esta ruta la puede llamar un MOZO (para abrir/cerrar
   * mesa desde el salón), así que no puede devolver el `qrToken` — es la
   * credencial con la que se pide sin autenticarse. Quien lo necesita de verdad
   * (admin/tables, para imprimir el QR) lo saca de `GET /tables`, que es
   * dueño/admin. El front recarga la lista después de editar, así que nadie
   * depende de que venga en esta respuesta.
   */
  async update(id: string, dto: UpdateTableDto) {
    await this.getOrThrow(id);
    return this.tenantPrisma.client.table.update({
      where: { id },
      data: dto,
      select: { id: true, branchId: true, code: true, status: true, capacity: true, active: true },
    });
  }

  /**
   * Borrado DURO — solo si la mesa nunca tuvo pedidos ni reservas (si no,
   * orfanaríamos ese historial: `Order.tableId`/`Reservation.tableId` son FK
   * sin cascade). Si tiene historial, 409 → hay que desactivarla. `deleteMany`
   * en vez de `delete` por el scope de tenant (mismo patrón que closures).
   */
  async remove(id: string) {
    await this.getOrThrow(id);
    const [orders, reservations] = await Promise.all([
      this.tenantPrisma.client.order.count({ where: { tableId: id } }),
      this.tenantPrisma.client.reservation.count({ where: { tableId: id } }),
    ]);
    if (orders + reservations > 0) {
      throw new ConflictException(
        'Esta mesa tiene pedidos o reservas en su historial y no se puede eliminar. Desactivala en su lugar.',
      );
    }
    const result = await this.tenantPrisma.client.table.deleteMany({ where: { id } });
    if (result.count === 0) throw new NotFoundException('Mesa no encontrada');
    return { ok: true };
  }

  /** Rotable sin cambiar el id de la mesa — el QR físico se reimprime con el nuevo token. */
  async rotateQr(id: string) {
    await this.getOrThrow(id);
    return this.tenantPrisma.client.table.update({
      where: { id },
      data: { qrToken: this.generateQrToken() },
    });
  }

  private generateQrToken(): string {
    return randomBytes(16).toString('base64url');
  }
}
