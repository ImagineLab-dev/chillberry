import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async create(dto: CreateReservationDto, userId: string) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');

    const when = new Date(dto.reservedFor);

    if (dto.tableId) {
      const table = await this.tenantPrisma.client.table.findUnique({ where: { id: dto.tableId } });
      if (!table) throw new NotFoundException('Mesa no encontrada');
      if (table.branchId !== dto.branchId) {
        throw new BadRequestException('La mesa no pertenece a esa sucursal');
      }

      // Anti-doble-reserva: la misma mesa no puede tener otra reserva activa
      // dentro de ±90 min (turno típico). Antes solo se chequeaba al SENTAR, así
      // que se podían cargar dos reservas para la misma mesa y horario.
      const windowMs = 90 * 60 * 1000;
      const clash = await this.tenantPrisma.client.reservation.findFirst({
        where: {
          tableId: dto.tableId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          reservedFor: { gte: new Date(when.getTime() - windowMs), lte: new Date(when.getTime() + windowMs) },
        },
      });
      if (clash) {
        throw new ConflictException('Esa mesa ya tiene una reserva en ese horario');
      }
    }

    // No se puede reservar para el pasado — casi siempre es un error de tipeo
    // en la fecha, y llenar la agenda de reservas vencidas no sirve a nadie.
    if (when.getTime() < Date.now()) {
      throw new BadRequestException('La reserva no puede ser para una fecha pasada');
    }

    return this.tenantPrisma.client.reservation.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        tableId: dto.tableId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        partySize: dto.partySize,
        reservedFor: new Date(dto.reservedFor),
        notes: dto.notes,
        createdById: userId,
      },
      include: { table: { select: { code: true } } },
    });
  }

  /**
   * Reservas de una sucursal. `from`/`to` acotan por `reservedFor` (por defecto
   * la agenda futura, las últimas primero por proximidad). `status` filtra.
   */
  list(branchId: string, opts: { from?: string; to?: string; status?: string } = {}) {
    const reservedFor: { gte?: Date; lte?: Date } = {};
    if (opts.from) reservedFor.gte = new Date(opts.from);
    if (opts.to) reservedFor.lte = new Date(opts.to);

    return this.tenantPrisma.client.reservation.findMany({
      where: {
        branchId,
        ...(opts.from || opts.to ? { reservedFor } : {}),
        ...(opts.status ? { status: opts.status as never } : {}),
      },
      orderBy: { reservedFor: 'asc' },
      include: { table: { select: { code: true } } },
    });
  }

  async update(id: string, dto: UpdateReservationDto) {
    const reservation = await this.tenantPrisma.client.reservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    if (dto.tableId) {
      const table = await this.tenantPrisma.client.table.findUnique({ where: { id: dto.tableId } });
      if (!table) throw new NotFoundException('Mesa no encontrada');
      if (table.branchId !== reservation.branchId) {
        throw new BadRequestException('La mesa no pertenece a la sucursal de la reserva');
      }
    }

    // Sentar la reserva ocupa la mesa (si hay una asignada), igual que abrir
    // una mesa desde el mapa del mesero. Se hace en transacción con el cambio
    // de estado para que no quede una reserva SEATED con la mesa libre.
    const seating = dto.status === 'SEATED';
    const tableToOccupy = dto.tableId ?? reservation.tableId;
    if (seating && tableToOccupy) {
      const table = await this.tenantPrisma.client.table.findUnique({ where: { id: tableToOccupy } });
      if (table && table.status === 'OCCUPIED') {
        throw new ConflictException('La mesa asignada ya está ocupada');
      }
    }

    const [updated] = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.reservation.update({
        where: { id },
        data: {
          status: dto.status,
          tableId: dto.tableId,
          reservedFor: dto.reservedFor ? new Date(dto.reservedFor) : undefined,
          partySize: dto.partySize,
          notes: dto.notes,
        },
        include: { table: { select: { code: true } } },
      }),
      ...(seating && tableToOccupy
        ? [this.tenantPrisma.client.table.update({ where: { id: tableToOccupy }, data: { status: 'OCCUPIED' } })]
        : []),
    ]);

    return updated;
  }
}
