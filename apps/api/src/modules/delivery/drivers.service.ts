import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { USER_ROLE } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { BillingService } from '../billing/billing.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';

@Injectable()
export class DriversService {
  constructor(
    // Crudo para el chequeo de unicidad de email — es global, no por tenant
    // (mismo motivo que en UsersService).
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly billing: BillingService,
  ) {}

  async register(dto: RegisterDriverDto) {
    // Un repartidor ES un User, así que consume cupo del plan igual que
    // cualquier otro. Este camino crea el User con `prisma.user.create` crudo
    // en vez de pasar por UsersService, así que sin este chequeo el límite se
    // podía saltear entero dando de alta a la gente como repartidores.
    await this.billing.assertCanCreateUser();

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    const passwordHash = await argon2.hash(dto.password);
    const tenantId = this.tenantPrisma.tenantId;

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: USER_ROLE.Driver,
        phone: dto.phone,
      },
    });

    return this.tenantPrisma.client.driver.create({
      data: {
        tenantId,
        userId: user.id,
        phone: dto.phone,
        vehicleType: dto.vehicleType,
        licensePlate: dto.licensePlate,
      },
    });
  }

  list() {
    return this.tenantPrisma.client.driver.findMany({
      include: { user: { select: { name: true, email: true, active: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Baja/reactivación de un repartidor desde el admin. Un repartidor ES un
   * User, así que la baja se hace sobre la cuenta (`user.active`) — eso le
   * corta el login Y, borrando sus refresh tokens, también la sesión que ya
   * tenga abierta en el teléfono (antes sólo cortaba el login: con la app
   * abierta seguía trabajando y cobrando envíos). Además lo forzamos OFFLINE
   * para sacarlo del mapa y de la asignación automática. No se borra en duro:
   * sus entregas históricas referencian al driver.
   */
  async setActive(driverId: string, active: boolean) {
    const driver = await this.tenantPrisma.client.driver.findFirst({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Repartidor no encontrado');
    await this.tenantPrisma.client.user.updateMany({ where: { id: driver.userId }, data: { active } });
    if (!active) {
      await this.tenantPrisma.client.driver.updateMany({ where: { id: driverId }, data: { availability: 'OFFLINE' } });
      await this.prisma.refreshToken.deleteMany({ where: { userId: driver.userId } });
    }
    return { ok: true, active };
  }

  async getByUserId(userId: string) {
    const driver = await this.tenantPrisma.client.driver.findFirst({ where: { userId } });
    if (!driver) throw new NotFoundException('No hay perfil de repartidor para este usuario');
    return driver;
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    const driver = await this.getByUserId(userId);
    return this.tenantPrisma.client.driver.update({
      where: { id: driver.id },
      data: { availability: dto.availability },
    });
  }

  /** Posiciones más recientes de cada repartidor — mapa para admin. */
  async liveMap() {
    const drivers = await this.tenantPrisma.client.driver.findMany({
      where: { availability: { in: ['ONLINE', 'BUSY'] } },
      include: {
        user: { select: { name: true } },
        locations: { orderBy: { recordedAt: 'desc' }, take: 1 },
      },
    });
    return drivers.map((d) => ({
      id: d.id,
      name: d.user.name,
      availability: d.availability,
      vehicleType: d.vehicleType,
      activeDeliveriesCount: d.activeDeliveriesCount,
      location: d.locations[0] ?? null,
    }));
  }
}
