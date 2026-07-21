import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { KitchenService } from '../kitchen/kitchen.service';
import { BillingService } from '../billing/billing.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { SetBranchHoursDto } from './dto/set-branch-hours.dto';
import { CreateClosureDto } from './dto/create-closure.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kitchen: KitchenService,
    private readonly billing: BillingService,
  ) {}

  async create(dto: CreateBranchDto) {
    // El client ya viene scopeado por tenantId, así que si restaurantId
    // pertenece a OTRO tenant, este findUnique no lo encuentra -> 404.
    // Sin esto, el FK de Branch.restaurantId permitiría igual el insert
    // (Postgres no valida tenant, solo integridad referencial) y quedaría
    // una branch del tenant A colgando de un restaurant del tenant B.
    const restaurant = await this.tenantPrisma.client.restaurant.findUnique({
      where: { id: dto.restaurantId },
    });
    if (!restaurant) throw new NotFoundException('Restaurante no encontrado');

    // Fase 6: 409 PLAN_LIMIT_EXCEEDED si el tenant ya está en el tope de
    // sucursales de su plan, en vez de un 500 genérico o dejar pasar sin
    // control (ver checklist de verificación de la Fase 6 del plan original).
    await this.billing.assertCanCreateBranch();

    const branch = await this.tenantPrisma.client.branch.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId },
    });
    await this.kitchen.ensureDefaultStations(branch.id);
    return branch;
  }

  list(restaurantId?: string) {
    return this.tenantPrisma.client.branch.findMany({
      where: restaurantId ? { restaurantId } : undefined,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getOrThrow(id: string) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.getOrThrow(id);
    // `cartaTheme` es un campo JSON: `null` en Prisma no borra la columna, hay
    // que usar `Prisma.DbNull`. `undefined` (no vino) no se toca.
    const { cartaTheme, ...rest } = dto;
    const data: Prisma.BranchUpdateInput = { ...rest };
    if (cartaTheme !== undefined) {
      data.cartaTheme = cartaTheme === null ? Prisma.DbNull : (cartaTheme as Prisma.InputJsonValue);
    }
    try {
      return await this.tenantPrisma.client.branch.update({ where: { id }, data });
    } catch (err) {
      // El slug público es único GLOBAL (entre todos los tenants), así que la
      // colisión se detecta acá y no en un findFirst previo — evita la carrera
      // entre "chequear" y "escribir".
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ese enlace ya está en uso — probá con otro');
      }
      throw err;
    }
  }

  // --- Horario de atención para el pedido online (`/r/:slug`) ---

  /** Horario semanal + días cerrados, para la pantalla de configuración. */
  async getSchedule(id: string) {
    await this.getOrThrow(id);
    const [hours, closures] = await Promise.all([
      this.tenantPrisma.client.branchHours.findMany({
        where: { branchId: id },
        orderBy: [{ weekday: 'asc' }, { openMinute: 'asc' }],
      }),
      this.tenantPrisma.client.branchClosure.findMany({
        where: { branchId: id },
        orderBy: { date: 'asc' },
      }),
    ]);
    return { hours, closures };
  }

  /** Reemplaza el horario semanal completo (borra + recrea en una transacción). */
  async setHours(id: string, dto: SetBranchHoursDto) {
    await this.getOrThrow(id);

    for (const h of dto.hours) {
      if (h.closeMinute <= h.openMinute) {
        throw new BadRequestException(
          'El horario de cierre tiene que ser posterior al de apertura (no se admiten turnos que cruzan la medianoche)',
        );
      }
    }

    await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.branchHours.deleteMany({ where: { branchId: id } }),
      ...(dto.hours.length > 0
        ? [
            this.tenantPrisma.client.branchHours.createMany({
              data: dto.hours.map((h) => ({
                tenantId: this.tenantPrisma.tenantId,
                branchId: id,
                weekday: h.weekday,
                openMinute: h.openMinute,
                closeMinute: h.closeMinute,
              })),
            }),
          ]
        : []),
    ]);

    return this.getSchedule(id);
  }

  async addClosure(id: string, dto: CreateClosureDto) {
    await this.getOrThrow(id);
    // 'YYYY-MM-DD' → medianoche UTC, consistente con cómo `computeOpenState`
    // relee el `@db.Date` (toma los componentes UTC).
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    // El regex del DTO valida el FORMATO pero no el calendario: '2026-02-30' o
    // '2026-13-01' pasan el regex y dan Invalid Date, que sin este chequeo
    // reventaría como 500 al insertar (solo se atrapa P2002). El round-trip
    // confirma que la fecha existe de verdad.
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dto.date) {
      throw new BadRequestException('Esa fecha no existe en el calendario');
    }
    try {
      return await this.tenantPrisma.client.branchClosure.create({
        data: { tenantId: this.tenantPrisma.tenantId, branchId: id, date, reason: dto.reason },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Esa fecha ya está marcada como cerrada');
      }
      throw err;
    }
  }

  async removeClosure(id: string, closureId: string) {
    await this.getOrThrow(id);
    // El client ya está scopeado por tenant; `deleteMany` con branchId evita
    // borrar un cierre de otra sucursal aunque el id exista.
    const result = await this.tenantPrisma.client.branchClosure.deleteMany({
      where: { id: closureId, branchId: id },
    });
    if (result.count === 0) throw new NotFoundException('Fecha de cierre no encontrada');
    return { ok: true };
  }
}
