import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { findDlocalCountry, isReservedSubdomain } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { isValidTimeZone } from '../../common/util/timezone';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

const TENANT_SETTINGS_SELECT = {
  id: true,
  name: true,
  countryCode: true,
  currency: true,
  timezone: true,
  brandColor: true,
  publicSubdomain: true,
} as const;

@Injectable()
export class TenantSettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    // Raw (no scoped): para chequear colisión del subdominio contra el `slug`
    // de OTROS tenants, que el client scopeado no vería.
    private readonly prisma: PrismaService,
  ) {}

  getSettings() {
    return this.tenantPrisma.client.tenant.findUniqueOrThrow({
      where: { id: this.tenantPrisma.tenantId },
      select: TENANT_SETTINGS_SELECT,
    });
  }

  async updateSettings(dto: UpdateTenantSettingsDto) {
    // Un solo campo para elegir país — la moneda se deriva del mismo,
    // nunca se acepta suelta desde el cliente (evita un tenant en
    // Paraguay quedando facturado/mostrado en Reales por error de tipeo).
    const currency = dto.countryCode ? findDlocalCountry(dto.countryCode)?.currency : undefined;

    // El timezone define el "hoy" del dashboard y el bucketing de reportes —
    // un IANA inválido corrompería silenciosamente esas curvas. Validar acá.
    if (typeof dto.timezone === 'string' && !isValidTimeZone(dto.timezone)) {
      throw new BadRequestException('Zona horaria inválida — usá un identificador IANA como America/Asuncion');
    }

    if (typeof dto.publicSubdomain === 'string') {
      if (isReservedSubdomain(dto.publicSubdomain)) {
        throw new BadRequestException('Ese subdominio está reservado — elegí otro');
      }
      // El subdominio y el `slug` viven en el mismo espacio de nombres al
      // resolver (`getStoreBySubdomain`), pero son índices únicos SEPARADOS —
      // sin esto, un tenant podría reclamar como subdominio el slug de otro y
      // pisarle el storefront. Rechazar la colisión contra slugs ajenos.
      const slugOwner = await this.prisma.tenant.findFirst({
        where: { slug: dto.publicSubdomain, id: { not: this.tenantPrisma.tenantId } },
        select: { id: true },
      });
      if (slugOwner) {
        throw new ConflictException('Ese subdominio ya está en uso — probá con otro');
      }
    }

    try {
      return await this.tenantPrisma.client.tenant.update({
        where: { id: this.tenantPrisma.tenantId },
        data: {
          name: dto.name,
          countryCode: dto.countryCode,
          currency,
          timezone: dto.timezone,
          brandColor: dto.brandColor,
          publicSubdomain: dto.publicSubdomain,
        },
        select: TENANT_SETTINGS_SELECT,
      });
    } catch (err) {
      // publicSubdomain es único global entre tenants.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ese subdominio ya está en uso — probá con otro');
      }
      throw err;
    }
  }
}
