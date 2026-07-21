import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  canTransitionDelivery,
  computeDriverPerformanceScore,
  DELIVERY_TRACKABLE_STATUSES,
  haversineKm,
  rankDriverCandidates,
  USER_ROLE,
  type DeliveryStatus,
} from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { NotificationsService } from '../integrations/notifications.service';
import { BillingService } from '../billing/billing.service';
import { DriversService } from './drivers.service';
import { DeliveryGateway } from './delivery.gateway';
import { RequestDeliveryDto } from './dto/request-delivery.dto';
import { DeliverDto } from './dto/deliver.dto';
import { CancelDeliveryDto } from './dto/cancel-delivery.dto';
import { LocationPingDto } from './dto/location-ping.dto';
import { ReportIncidentDto } from './dto/report-incident.dto';

const ACTIVE_DELIVERY_STATUSES = ['DRIVER_ASSIGNED', 'ACCEPTED', 'PICKED_UP'] as const;
const HISTORY_STATUSES = ['DELIVERED', 'DRIVER_CANCELLED', 'CUSTOMER_CANCELLED', 'RESTAURANT_CANCELLED', 'FAILED'] as const;

/** Piso para el estimado cuando el local no tiene ninguna zona de envío cargada. */
const DEFAULT_DELIVERY_MINUTES = 45;

/**
 * El `confirmationCode` es un secreto DEL CLIENTE: se lo dicta al repartidor al
 * recibir el pedido y el server lo compara en `deliver()`. Si viaja en una
 * respuesta que el repartidor puede leer, el mecanismo queda anulado — puede
 * marcar entregas sin haber pasado nunca por la casa del cliente.
 *
 * Que la UI no lo pinte NO alcanza: está en el JSON, a un F12 de distancia. Por
 * eso toda respuesta de un endpoint que lea un repartidor pasa por acá.
 */
export function stripConfirmationCode<T extends object>(delivery: T): Omit<T, 'confirmationCode'> {
  const safe = { ...delivery } as Record<string, unknown>;
  delete safe.confirmationCode;
  return safe as Omit<T, 'confirmationCode'>;
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly drivers: DriversService,
    private readonly gateway: DeliveryGateway,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService,
  ) {}

  async requestDelivery(orderId: string, dto: RequestDeliveryDto) {
    // Paywall real: si el plan no incluye delivery, no se puede pedir uno.
    await this.billing.assertFeature('delivery');

    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: orderId }, include: { branch: true } });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const existing = await this.tenantPrisma.client.delivery.findUnique({ where: { orderId } });
    if (existing) throw new ConflictException('Este pedido ya tiene un delivery asociado');

    const zone = await this.tenantPrisma.client.deliveryZone.findUnique({ where: { id: dto.zoneId } });
    if (!zone) throw new NotFoundException('Zona de delivery no encontrada');
    if (zone.branchId !== order.branchId) {
      throw new BadRequestException('Esa zona no pertenece a la sucursal del pedido');
    }
    if (!zone.active) throw new BadRequestException('Esa zona no está activa');
    if (zone.minOrderAmount && Number(order.total) < Number(zone.minOrderAmount)) {
      throw new BadRequestException(`El pedido mínimo para esta zona es ${zone.minOrderAmount}`);
    }

    let fee = Number(zone.baseFee);
    let distanceKm: number | null = null;
    if (zone.feeType === 'BY_DISTANCE' && dto.lat != null && dto.lng != null && order.branch.lat != null && order.branch.lng != null) {
      distanceKm = haversineKm(Number(order.branch.lat), Number(order.branch.lng), dto.lat, dto.lng);
      const freeKm = zone.freeKmThreshold ? Number(zone.freeKmThreshold) : 0;
      const extraKm = Math.max(0, distanceKm - freeKm);
      fee = Number(zone.baseFee) + extraKm * Number(zone.perKmFee ?? 0);
      fee = Math.round(fee * 100) / 100;
    }

    const confirmationCode = String(Math.floor(1000 + Math.random() * 9000));

    const delivery = await this.tenantPrisma.client.delivery.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        orderId,
        zoneId: zone.id,
        addressLine: dto.addressLine,
        lat: dto.lat,
        lng: dto.lng,
        deliveryFee: fee,
        estimatedMinutes: zone.estimatedMinutes,
        confirmationCode,
      },
    });

    if (distanceKm !== null) {
      await this.tenantPrisma.client.deliveryRoute.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          deliveryId: delivery.id,
          distanceKm,
          provider: 'internal-haversine',
        },
      });
    }

    await this.tenantPrisma.client.order.update({
      where: { id: orderId },
      data: { type: 'DELIVERY', deliveryFee: fee, total: Number(order.total) + fee },
    });

    await this.logEvent(delivery.id, 'DELIVERY_CREATED', { fee, distanceKm });

    // Intento de asignación inmediata (sincrónico — ver nota de simplificación
    // en assignDriver sobre por qué no hay cola/reintento con BullMQ todavía).
    await this.assignDriver(delivery.id);
    await this.notifyDispatchNewDelivery(delivery.id);

    return this.getOrThrow(delivery.id);
  }

  /**
   * Aviso EN VIVO al despachador de la sucursal: entró un delivery nuevo. Se
   * llama DESPUÉS de intentar la auto-asignación, así el flag `unassigned`
   * refleja si quedó sin repartidor (PENDING) — que es justo cuando el
   * despachador tiene que actuar a mano. Best-effort: nunca rompe la creación.
   */
  private async notifyDispatchNewDelivery(deliveryId: string) {
    const d = await this.tenantPrisma.client.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, addressLine: true, order: { select: { branchId: true } } },
    });
    if (!d) return;
    this.gateway.emitToDispatch(d.order.branchId, 'delivery:new', {
      deliveryId: d.id,
      status: d.status,
      addressLine: d.addressLine,
      unassigned: d.status === 'PENDING',
    });
  }

  /**
   * Crea el Delivery de un pedido hecho por el cliente desde el link público
   * de la sucursal (`/r/:slug`), donde NO hay una zona elegida: el cliente
   * escribe su dirección a mano, no la matchea contra `DeliveryZone`. Por eso
   * la tarifa es la plana de la sucursal (`Branch.deliveryFee`) y `zoneId`
   * queda null — el staff puede reajustar la zona/tarifa desde el board si
   * hace falta.
   *
   * El `order.total` YA lo dejó `PublicMenuService.createPublicOrder`
   * incluyendo el envío (a diferencia de `requestDelivery`, que se llama sobre
   * un pedido ya cobrado y por eso él mismo suma el fee al total). Acá solo se
   * crea el Delivery y se dispara la MISMA auto-asignación que un delivery de
   * staff, así que el pedido entra al flujo real: aparece en `orders/available`
   * del repartidor y el cliente lo sigue en `/track/:deliveryId`.
   *
   * La asignación es best-effort: si falla (sin repartidores, error de red en
   * la notificación, etc.) el pedido NO se cae — el Delivery queda PENDING para
   * asignación manual. El pago es al recibir, así que no hay cobro que revertir.
   */
  async createForPublicOrder(
    orderId: string,
    params: { addressLine: string; fee: number; lat?: number | null; lng?: number | null },
  ) {
    const confirmationCode = String(Math.floor(1000 + Math.random() * 9000));
    const order = await this.tenantPrisma.client.order.findFirst({
      where: { id: orderId },
      select: { branchId: true },
    });
    const delivery = await this.tenantPrisma.client.delivery.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        orderId,
        addressLine: params.addressLine,
        lat: params.lat ?? undefined,
        lng: params.lng ?? undefined,
        deliveryFee: params.fee,
        estimatedMinutes: await this.estimatedMinutesForBranch(order?.branchId),
        confirmationCode,
      },
    });
    await this.logEvent(delivery.id, 'DELIVERY_CREATED', { fee: params.fee, source: 'public_link' });

    try {
      await this.assignDriver(delivery.id);
    } catch (err) {
      // No romper el pedido del cliente por un problema de asignación: queda
      // PENDING y el staff lo toma desde el board.
      this.logger.error(`Auto-asignación falló para delivery ${delivery.id}: ${(err as Error).message}`);
    }
    await this.notifyDispatchNewDelivery(delivery.id);

    return this.getOrThrow(delivery.id);
  }

  /**
   * Algoritmo de asignación — prioridad: (1) disponible, (2) más cercano,
   * (3) menor carga activa, (4) mejor rendimiento. Corre SINCRÓNICAMENTE
   * dentro de la request que crea el delivery (no hay cola/BullMQ todavía
   * en este proyecto) — si no hay repartidores online, el delivery queda
   * PENDING para asignación manual del admin. El reintento automático a
   * los 45s si el repartidor no acepta (mencionado en el diseño original)
   * queda pendiente para cuando haya infraestructura de jobs con retraso.
   */
  async assignDriver(deliveryId: string, excludeDriverIds: string[] = []) {
    const delivery = await this.tenantPrisma.client.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: { include: { branch: true } } },
    });
    if (!delivery || delivery.status !== 'PENDING') return null;

    const candidates = await this.tenantPrisma.client.driver.findMany({
      where: { availability: 'ONLINE', id: { notIn: excludeDriverIds } },
    });
    if (candidates.length === 0) {
      await this.logEvent(deliveryId, 'DRIVER_ASSIGNMENT_FAILED', { reason: 'no_drivers_online' });
      return null;
    }

    const branch = delivery.order.branch;
    const scored = await Promise.all(
      candidates.map(async (d) => {
        const location = await this.tenantPrisma.client.driverLocation.findFirst({
          where: { driverId: d.id },
          orderBy: { recordedAt: 'desc' },
        });
        const distanceKm =
          location && branch.lat != null && branch.lng != null
            ? haversineKm(Number(location.lat), Number(location.lng), Number(branch.lat), Number(branch.lng))
            : Number.POSITIVE_INFINITY;
        const performanceScore = computeDriverPerformanceScore(
          d.ratingAvg ? Number(d.ratingAvg) : null,
          d.totalDeliveries,
          d.totalCancellations,
        );
        return { driver: d, distanceKm, activeDeliveriesCount: d.activeDeliveriesCount, performanceScore };
      }),
    );

    const chosen = rankDriverCandidates(scored)[0]!.driver;

    const [updated] = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.delivery.update({
        where: { id: deliveryId },
        data: { driverId: chosen.id, status: 'DRIVER_ASSIGNED', assignedAt: new Date() },
      }),
      this.tenantPrisma.client.driver.update({
        where: { id: chosen.id },
        data: { activeDeliveriesCount: { increment: 1 } },
      }),
    ]);

    await this.logEvent(deliveryId, 'DRIVER_ASSIGNED', { driverId: chosen.id });
    this.gateway.emitToDriver(chosen.id, 'delivery:assigned', { deliveryId });
    this.gateway.emitToTracking(deliveryId, 'delivery:updated', { status: 'DRIVER_ASSIGNED' });
    // Fase 7 — best-effort: nunca bloquea la asignación si falla.
    await this.notifications.notifyDeliveryAssigned(delivery.order.customerPhone, delivery.estimatedMinutes);

    return updated;
  }

  /**
   * Reasignación automática de un delivery que quedó DRIVER_ASSIGNED sin que el
   * repartidor lo acepte a tiempo (lo dispara el cron `DeliveryReassignService`).
   * Lo libera (vuelve a PENDING, baja el contador del que no aceptó) y reintenta
   * la asignación excluyéndolo. Corre dentro del contexto de tenant que abre el
   * cron, así que puede usar el cliente tenant-scoped.
   */
  async reassignStale(deliveryId: string): Promise<boolean> {
    const delivery = await this.tenantPrisma.client.delivery.findFirst({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== 'DRIVER_ASSIGNED') return false;
    const oldDriverId = delivery.driverId;

    await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.delivery.update({
        where: { id: deliveryId },
        data: { status: 'PENDING', driverId: null, assignedAt: null },
      }),
      ...(oldDriverId
        ? [
            this.tenantPrisma.client.driver.updateMany({
              where: { id: oldDriverId },
              data: { activeDeliveriesCount: { decrement: 1 } },
            }),
          ]
        : []),
    ]);
    await this.logEvent(deliveryId, 'REASSIGNED', { from: oldDriverId });

    // Reintenta excluyendo al que no aceptó. Si no hay otro online, queda PENDING
    // para asignación manual del despachador.
    const result = await this.assignDriver(deliveryId, oldDriverId ? [oldDriverId] : []);
    return result != null;
  }

  async manualAssign(deliveryId: string, driverId: string) {
    const delivery = await this.getOrThrow(deliveryId);
    if (delivery.status !== 'PENDING' && delivery.status !== 'DRIVER_ASSIGNED') {
      throw new ConflictException('Este delivery ya no admite reasignación manual');
    }
    const driver = await this.tenantPrisma.client.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Repartidor no encontrado');

    if (delivery.driverId && delivery.driverId !== driverId) {
      await this.tenantPrisma.client.driver.update({
        where: { id: delivery.driverId },
        data: { activeDeliveriesCount: { decrement: 1 } },
      });
    }
    const updated = await this.tenantPrisma.client.delivery.update({
      where: { id: deliveryId },
      data: { driverId, status: 'DRIVER_ASSIGNED', assignedAt: new Date() },
    });
    await this.tenantPrisma.client.driver.update({
      where: { id: driverId },
      data: { activeDeliveriesCount: { increment: 1 } },
    });
    await this.logEvent(deliveryId, 'DRIVER_ASSIGNED', { driverId, manual: true });
    this.gateway.emitToDriver(driverId, 'delivery:assigned', { deliveryId });
    this.gateway.emitToTracking(deliveryId, 'delivery:updated', { status: 'DRIVER_ASSIGNED' });
    await this.notifications.notifyDeliveryAssigned(delivery.order.customerPhone, delivery.estimatedMinutes);
    return updated;
  }

  async listAvailableForDriver(userId: string) {
    const driver = await this.drivers.getByUserId(userId);
    const deliveries = await this.tenantPrisma.client.delivery.findMany({
      where: { driverId: driver.id, status: { in: [...ACTIVE_DELIVERY_STATUSES] } },
      include: {
        order: { include: { branch: true, items: { include: { menuItem: true } } } },
        zone: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return deliveries.map(stripConfirmationCode);
  }

  async accept(deliveryId: string, userId: string) {
    return this.transitionAsDriver(deliveryId, userId, 'ACCEPTED', { acceptedAt: new Date() });
  }

  async pickUp(deliveryId: string, userId: string) {
    return this.transitionAsDriver(deliveryId, userId, 'PICKED_UP', { pickedUpAt: new Date() });
  }

  async deliver(deliveryId: string, userId: string, dto: DeliverDto) {
    const driver = await this.drivers.getByUserId(userId);
    const delivery = await this.getOrThrow(deliveryId);
    if (delivery.driverId !== driver.id) throw new ForbiddenException('Este pedido no te fue asignado a vos');
    if (!canTransitionDelivery(delivery.status as DeliveryStatus, 'DELIVERED')) {
      throw new ConflictException(`No se puede pasar de ${delivery.status} a DELIVERED`);
    }
    if (delivery.confirmationCode !== dto.confirmationCode) {
      throw new BadRequestException('Código de confirmación incorrecto');
    }

    const updated = await this.tenantPrisma.client.delivery.update({
      where: { id: deliveryId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        proofPhotoUrl: dto.proofPhotoUrl,
        proofSignatureUrl: dto.proofSignatureUrl,
      },
    });
    await this.tenantPrisma.client.driver.update({
      where: { id: driver.id },
      data: { activeDeliveriesCount: { decrement: 1 }, totalDeliveries: { increment: 1 } },
    });
    await this.logEvent(deliveryId, 'DELIVERY_COMPLETED', {});
    this.gateway.emitToTracking(deliveryId, 'delivery:updated', { status: 'DELIVERED' });
    await this.notifications.notifyDeliveryCompleted(delivery.order.customerPhone);
    return stripConfirmationCode(updated);
  }

  /**
   * Tres rutas las comparten el staff y el repartidor (`GET :id`, cancelar y
   * reportar incidente). El staff puede operar sobre cualquier entrega de su
   * restaurante; el repartidor SÓLO sobre las suyas.
   *
   * Sin esto, un repartidor podía leer nombre, teléfono y dirección de todos los
   * clientes del local — y peor, CANCELAR la entrega de un compañero, que además
   * le sumaba la cancelación al historial del otro (`totalCancellations`).
   *
   * `accept`/`pick-up`/`deliver` ya validaban pertenencia por su cuenta; estas
   * tres se habían quedado afuera.
   */
  async assertCanActOnDelivery(deliveryId: string, user: { id: string; role: string }) {
    if (user.role !== USER_ROLE.Driver) return;
    const driver = await this.drivers.getByUserId(user.id);
    const delivery = await this.getOrThrow(deliveryId);
    if (delivery.driverId !== driver.id) {
      throw new ForbiddenException('Este pedido no te fue asignado a vos');
    }
  }

  async cancel(deliveryId: string, dto: CancelDeliveryDto, cancelledBy: string) {
    const delivery = await this.getOrThrow(deliveryId);
    if (!canTransitionDelivery(delivery.status as DeliveryStatus, dto.status)) {
      throw new ConflictException(`No se puede pasar de ${delivery.status} a ${dto.status}`);
    }

    const updated = await this.tenantPrisma.client.delivery.update({
      where: { id: deliveryId },
      data: { status: dto.status, cancelledAt: new Date(), cancelReason: dto.reason, cancelledBy },
    });

    if (delivery.driverId) {
      await this.tenantPrisma.client.driver.update({
        where: { id: delivery.driverId },
        data: {
          activeDeliveriesCount: { decrement: 1 },
          ...(dto.status === 'DRIVER_CANCELLED' ? { totalCancellations: { increment: 1 } } : {}),
        },
      });
    }

    await this.logEvent(deliveryId, dto.status, { reason: dto.reason, cancelledBy });
    this.gateway.emitToTracking(deliveryId, 'delivery:updated', { status: dto.status });
    return updated;
  }

  async recordLocation(userId: string, dto: LocationPingDto) {
    const driver = await this.drivers.getByUserId(userId);
    const location = await this.tenantPrisma.client.driverLocation.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        driverId: driver.id,
        lat: dto.lat,
        lng: dto.lng,
        speed: dto.speed,
        accuracy: dto.accuracy,
        recordedAt: new Date(),
      },
    });

    const activeDeliveries = await this.tenantPrisma.client.delivery.findMany({
      where: { driverId: driver.id, status: { in: ['ACCEPTED', 'PICKED_UP'] } },
    });
    for (const delivery of activeDeliveries) {
      this.gateway.emitToTracking(delivery.id, 'driver:location', { lat: dto.lat, lng: dto.lng });
    }

    return location;
  }

  history(userId: string) {
    return this.drivers.getByUserId(userId).then((driver) =>
      this.tenantPrisma.client.delivery
        .findMany({
          where: { driverId: driver.id, status: { in: [...HISTORY_STATUSES] } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
        .then((rows) => rows.map(stripConfirmationCode)),
    );
  }

  async reportIncident(deliveryId: string, dto: ReportIncidentDto, reportedById: string) {
    await this.getOrThrow(deliveryId);
    return this.tenantPrisma.client.deliveryIncident.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        deliveryId,
        type: dto.type,
        description: dto.description,
        reportedById,
      },
    });
  }

  async getOrThrow(id: string) {
    const delivery = await this.tenantPrisma.client.delivery.findUnique({
      where: { id },
      include: { zone: true, route: true, order: { include: { table: true } } },
    });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');
    return delivery;
  }

  /**
   * Lista de deliveries de una sucursal para la consola de despacho del owner
   * (no existía: sólo había detalle por id). Trae el pedido, el repartidor
   * asignado y la zona, ordenados por más reciente. `status` filtra opcional.
   */
  listForBranch(branchId: string, status?: string) {
    return this.tenantPrisma.client.delivery.findMany({
      where: {
        order: { is: { branchId } },
        ...(status ? { status: status as DeliveryStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: {
          select: {
            id: true,
            customerName: true,
            customerPhone: true,
            total: true,
            type: true,
            status: true,
            createdAt: true,
          },
        },
        driver: {
          select: { id: true, phone: true, availability: true, user: { select: { name: true } } },
        },
        zone: { select: { name: true } },
      },
    });
  }

  /**
   * Tracking público (`GET /track/:id`) — SIN auth, usa `PrismaService`
   * crudo. Nunca expone teléfono del repartidor, y solo expone ubicación si
   * el estado es rastreable Y el repartidor sigue ONLINE.
   */
  async getPublicTracking(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { driver: { include: { user: { select: { name: true } } } } },
    });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');

    const trackable = DELIVERY_TRACKABLE_STATUSES.includes(delivery.status as DeliveryStatus);
    const driverOnline = delivery.driver?.availability === 'ONLINE';

    let liveLocation: { lat: number; lng: number } | null = null;
    if (trackable && driverOnline && delivery.driverId) {
      const location = await this.prisma.driverLocation.findFirst({
        where: { driverId: delivery.driverId },
        orderBy: { recordedAt: 'desc' },
      });
      if (location) liveLocation = { lat: Number(location.lat), lng: Number(location.lng) };
    }

    return {
      status: delivery.status,
      estimatedMinutes: delivery.estimatedMinutes,
      driverName: trackable ? (delivery.driver?.user.name ?? null) : null,
      location: trackable ? liveLocation : null,
      // El cliente puede calificar una vez entregado y si todavía no lo hizo.
      canRate: delivery.status === 'DELIVERED' && delivery.rating == null,
      rated: delivery.rating != null,
    };
  }

  /**
   * Calificación del cliente al repartidor desde el link público de tracking
   * (sin auth, mismo modelo que ver el estado). Sólo sobre una entrega ya
   * completada y una única vez. Recalcula el `ratingAvg` del repartidor como
   * promedio de todas sus entregas calificadas.
   */
  async ratePublicDelivery(deliveryId: string, rating: number, comment?: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');
    if (delivery.status !== 'DELIVERED') {
      throw new BadRequestException('Sólo se puede calificar una entrega ya completada');
    }
    if (delivery.rating != null) {
      throw new ConflictException('Esta entrega ya fue calificada — ¡gracias!');
    }

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { rating, ratingComment: comment?.trim() || null },
    });

    // Recalcular el promedio del repartidor sobre TODAS sus entregas calificadas.
    if (delivery.driverId) {
      const agg = await this.prisma.delivery.aggregate({
        where: { driverId: delivery.driverId, rating: { not: null } },
        _avg: { rating: true },
      });
      await this.prisma.driver.update({
        where: { id: delivery.driverId },
        data: { ratingAvg: agg._avg.rating != null ? Math.round(agg._avg.rating * 100) / 100 : null },
      });
    }
    return { ok: true };
  }

  /**
   * Liquidación por repartidor: para las entregas COMPLETADAS en el rango, cuánto
   * generó cada uno (Σ tarifa de envío), cuántas hizo, su calificación promedio y
   * sus cancelaciones. Es lo que el dueño mira para pagar/evaluar repartidores.
   */
  async driverEarnings(from?: string, to?: string) {
    const deliveredAt: { gte?: Date; lte?: Date } = {};
    if (from) deliveredAt.gte = new Date(from);
    if (to) deliveredAt.lte = new Date(to);

    const delivered = await this.tenantPrisma.client.delivery.findMany({
      where: { status: 'DELIVERED', driverId: { not: null }, ...(from || to ? { deliveredAt } : {}) },
      select: { driverId: true, deliveryFee: true, rating: true },
    });

    const byDriver = new Map<string, { deliveries: number; fees: number; ratingSum: number; ratingCount: number }>();
    for (const d of delivered) {
      const key = d.driverId!;
      const row = byDriver.get(key) ?? { deliveries: 0, fees: 0, ratingSum: 0, ratingCount: 0 };
      row.deliveries += 1;
      row.fees += Number(d.deliveryFee);
      if (d.rating != null) {
        row.ratingSum += d.rating;
        row.ratingCount += 1;
      }
      byDriver.set(key, row);
    }

    const driverIds = [...byDriver.keys()];
    const drivers =
      driverIds.length > 0
        ? await this.tenantPrisma.client.driver.findMany({
            where: { id: { in: driverIds } },
            select: { id: true, totalCancellations: true, user: { select: { name: true } } },
          })
        : [];
    const infoById = new Map(drivers.map((d) => [d.id, d]));

    return [...byDriver.entries()]
      .map(([driverId, v]) => ({
        driverId,
        driverName: infoById.get(driverId)?.user.name ?? 'Repartidor',
        deliveries: v.deliveries,
        fees: Math.round(v.fees * 100) / 100,
        avgRating: v.ratingCount > 0 ? Math.round((v.ratingSum / v.ratingCount) * 100) / 100 : null,
        cancellations: infoById.get(driverId)?.totalCancellations ?? 0,
      }))
      .sort((a, b) => b.fees - a.fees);
  }

  /**
   * Estimado para un delivery del link público, donde no hay zona elegida.
   * Dejarlo en `null` hacía que el repartidor y el cliente vieran literalmente
   * "~null min". Se toma el MAYOR estimado entre las zonas activas de la
   * sucursal (conservador a propósito: es peor prometer 15 y llegar a 40 que al
   * revés) y, si el local todavía no cargó zonas, un piso razonable.
   */
  private async estimatedMinutesForBranch(branchId?: string) {
    if (!branchId) return DEFAULT_DELIVERY_MINUTES;
    const zone = await this.tenantPrisma.client.deliveryZone.findFirst({
      where: { branchId, active: true },
      orderBy: { estimatedMinutes: 'desc' },
      select: { estimatedMinutes: true },
    });
    return zone?.estimatedMinutes ?? DEFAULT_DELIVERY_MINUTES;
  }

  private async transitionAsDriver(
    deliveryId: string,
    userId: string,
    nextStatus: DeliveryStatus,
    extraData: Record<string, unknown>,
  ) {
    const driver = await this.drivers.getByUserId(userId);
    const delivery = await this.getOrThrow(deliveryId);
    if (delivery.driverId !== driver.id) throw new ForbiddenException('Este pedido no te fue asignado a vos');
    if (!canTransitionDelivery(delivery.status as DeliveryStatus, nextStatus)) {
      throw new ConflictException(`No se puede pasar de ${delivery.status} a ${nextStatus}`);
    }

    const updated = await this.tenantPrisma.client.delivery.update({
      where: { id: deliveryId },
      data: { status: nextStatus, ...extraData },
    });
    await this.logEvent(deliveryId, `DRIVER_${nextStatus}`, {});
    this.gateway.emitToTracking(deliveryId, 'delivery:updated', { status: nextStatus });
    // Quien llama a esto SIEMPRE es el repartidor (accept / pick-up).
    return stripConfirmationCode(updated);
  }

  private async logEvent(deliveryId: string, type: string, payload: Record<string, unknown>) {
    await this.tenantPrisma.client.deliveryEvent.create({
      data: { tenantId: this.tenantPrisma.tenantId, deliveryId, type, payload },
    });
  }
}
