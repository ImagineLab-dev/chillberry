import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isBranchOpen,
  isReservedSubdomain,
  isWithinDeliveryWindow,
  localMomentInZone,
  type OpenState,
  type WeeklyHours,
} from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { tenantContext } from '../../common/tenant-context/tenant-context';
import { TurnstileService } from '../../common/turnstile/turnstile.service';
import { KitchenService } from '../kitchen/kitchen.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CouponsService } from '../coupons/coupons.service';
import { ModifiersService } from './modifiers.service';
import { CreateGuestOrderDto } from './dto/create-guest-order.dto';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';

/**
 * Todo lo que ve/hace un cliente anónimo que escaneó el QR de una mesa —
 * SIN auth, como `DeliveryService.getPublicTracking` (Fase 5). Usa
 * `PrismaService` crudo en vez de `TenantPrismaService`: no hay tenant en
 * el contexto de una request anónima hasta que este mismo service lo
 * deriva del `qrToken` y lo setea a mano (ver `createGuestOrder`).
 */
@Injectable()
export class PublicMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenService,
    private readonly turnstile: TurnstileService,
    private readonly modifiers: ModifiersService,
    private readonly delivery: DeliveryService,
    private readonly coupons: CouponsService,
  ) {}

  async getByQrToken(qrToken: string) {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
      include: {
        branch: {
          include: {
            restaurant: { include: { tenant: true } },
            menuCategories: {
              where: { active: true },
              orderBy: { sortOrder: 'asc' },
              include: {
                items: {
                  where: { active: true },
                  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                  include: {
                    modifierGroups: {
                      where: { active: true },
                      orderBy: { sortOrder: 'asc' },
                      include: {
                        options: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
                      },
                    },
                    comboComponents: {
                      include: { component: { select: { id: true, name: true } } },
                      orderBy: { quantity: 'desc' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!table) throw new NotFoundException('Código QR no válido');

    return {
      restaurantName: table.branch.restaurant.name,
      restaurantLogoUrl: table.branch.restaurant.logoUrl,
      branchCoverImageUrl: table.branch.coverImageUrl,
      branchName: table.branch.name,
      tableCode: table.code,
      canOrder: table.branch.active,
      currency: table.branch.restaurant.tenant.currency,
      countryCode: table.branch.restaurant.tenant.countryCode,
      /** Hex del color de marca, o null si usa el de Chillberry. El front lo
       *  convierte en tokens con `brandTokens()` — el color del texto encima se
       *  deriva ahí, así que el tenant no puede elegir algo ilegible. */
      brandColor: table.branch.restaurant.tenant.brandColor,
      /** Diseño de la carta de esta sucursal (colores/font/layout/portada). */
      cartaTheme: table.branch.cartaTheme,
      categories: this.mapCategories(table.branch.menuCategories),
    };
  }

  /**
   * Carta pública COMPARTIBLE de una sucursal (`/r/:slug`), no atada a una
   * mesa: la que va en la bio de Instagram o se manda por WhatsApp. Sirve el
   * mismo menú que el QR, más la config de pedido online (delivery/retiro,
   * tarifa de envío, si está habilitado) para que el front sepa qué ofrecer.
   */
  async getByBranchSlug(slug: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { publicSlug: slug },
      include: {
        restaurant: { include: { tenant: true } },
        hours: true,
        closures: true,
        menuCategories: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            items: {
              where: { active: true },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: {
                modifierGroups: {
                  where: { active: true },
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    options: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
                  },
                },
                comboComponents: {
                  include: { component: { select: { id: true, name: true } } },
                  orderBy: { quantity: 'desc' },
                },
              },
            },
          },
        },
      },
    });
    if (!branch) throw new NotFoundException('Carta no encontrada');

    const openState = this.computeOpenState(
      branch.hours,
      branch.closures,
      branch.restaurant.tenant.timezone,
    );

    return {
      restaurantName: branch.restaurant.name,
      restaurantLogoUrl: branch.restaurant.logoUrl,
      branchCoverImageUrl: branch.coverImageUrl,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      currency: branch.restaurant.tenant.currency,
      countryCode: branch.restaurant.tenant.countryCode,
      brandColor: branch.restaurant.tenant.brandColor,
      /** Diseño de la carta de esta sucursal (colores/font/layout/portada). */
      cartaTheme: branch.cartaTheme,
      /** Config de pedido online — el front decide qué botones mostrar. Si la
       *  sucursal está inactiva o el pedido online apagado, `canOrder` es false
       *  y la carta se ve pero no se puede pedir. */
      canOrder: branch.active && branch.publicOrderingEnabled,
      acceptsDelivery: branch.acceptsDelivery,
      acceptsPickup: branch.acceptsPickup,
      deliveryFee: branch.deliveryFee,
      /** Ventana horaria del delivery (minutos desde medianoche) — el front la
       *  muestra ("envíos de 18:00 a 22:00") y decide si ofrecer delivery. */
      deliveryStartMinute: branch.deliveryStartMinute,
      deliveryEndMinute: branch.deliveryEndMinute,
      /** `true` si la sucursal toma DELIVERY ahora: abierta Y dentro de la
       *  ventana de envíos. Cuando es false pero `isOpenNow` es true, sigue
       *  disponible el retiro. */
      deliveryOpenNow:
        openState.open &&
        isWithinDeliveryWindow(
          branch.deliveryStartMinute,
          branch.deliveryEndMinute,
          localMomentInZone(new Date(), branch.restaurant.tenant.timezone).minutes,
        ),
      /** `true` si la sucursal acepta pedidos AHORA según su horario (en la
       *  zona horaria del tenant). El front muestra "Cerrado ahora" sin tener
       *  que recomputar la lógica de zona horaria. */
      isOpenNow: openState.open,
      closedReason: openState.open ? null : openState.reason,
      hours: branch.hours
        .map((h) => ({ weekday: h.weekday, openMinute: h.openMinute, closeMinute: h.closeMinute }))
        .sort((a, b) => a.weekday - b.weekday || a.openMinute - b.openMinute),
      categories: this.mapCategories(branch.menuCategories),
    };
  }

  /**
   * "Storefront" de un tenant por su SUBDOMINIO: `<sub>.chillberry.io`. Resuelve
   * el tenant por `publicSubdomain` (o por `slug` como fallback cómodo) y lista
   * sus sucursales publicadas (con `publicSlug`). El front del subdominio decide:
   * si hay una sola sucursal va directo a su carta `/r/:branchSlug`; si hay
   * varias, muestra un selector.
   */
  async getStoreBySubdomain(subdomain: string) {
    // Un subdominio reservado nunca resuelve a un tenant, aunque algún `slug`
    // autogenerado coincida (ej. un tenant llamado "Admin").
    if (isReservedSubdomain(subdomain)) throw new NotFoundException('No encontramos este restaurante');

    const include = {
      restaurants: { select: { name: true, logoUrl: true }, orderBy: { createdAt: 'asc' as const }, take: 1 },
    };
    // `publicSubdomain` GANA sobre `slug` (resolución determinista): son índices
    // únicos separados que comparten espacio de nombres acá. Con un OR + findFirst
    // sin orden, si el valor coincidía con el slug de otro tenant el resultado era
    // no determinista. Buscando primero por subdominio elegido, el dueño siempre
    // resuelve a lo suyo.
    const tenant =
      (await this.prisma.tenant.findFirst({ where: { publicSubdomain: subdomain, active: true }, include })) ??
      (await this.prisma.tenant.findFirst({ where: { slug: subdomain, active: true }, include }));
    if (!tenant) throw new NotFoundException('No encontramos este restaurante');

    const branches = await this.prisma.branch.findMany({
      where: { tenantId: tenant.id, active: true, publicSlug: { not: null } },
      include: { hours: true, closures: true },
      orderBy: { createdAt: 'asc' },
    });

    const firstRestaurant = tenant.restaurants[0];
    return {
      tenantName: tenant.name,
      logoUrl: firstRestaurant?.logoUrl ?? null,
      brandColor: tenant.brandColor,
      branches: branches.map((b) => {
        const openState = this.computeOpenState(b.hours, b.closures, tenant.timezone);
        return {
          slug: b.publicSlug,
          name: b.name,
          address: b.address,
          coverImageUrl: b.coverImageUrl,
          canOrder: b.active && b.publicOrderingEnabled,
          isOpenNow: openState.open,
        };
      }),
    };
  }

  /**
   * Pedido self-service: el cliente escanea el QR, arma su carrito y
   * confirma sin que un mesero tenga que cargarlo — mismo camino a cocina
   * que un pedido de mesero (genera KitchenTask por estación vía
   * `KitchenService`, así que aparece en el KDS igual que cualquier otro).
   */
  async createGuestOrder(qrToken: string, dto: CreateGuestOrderDto, remoteIp?: string | null) {
    await this.turnstile.verify(dto.turnstileToken, remoteIp);

    const table = await this.prisma.table.findUnique({
      where: { qrToken },
      include: { branch: true },
    });
    if (!table) throw new NotFoundException('Código QR no válido');
    if (!table.active) {
      // Mesa retirada (soft-delete): su QR viejo ya no debe tomar pedidos.
      throw new BadRequestException('Esta mesa ya no está disponible');
    }
    if (!table.branch.active) {
      throw new BadRequestException('Esta sucursal no está aceptando pedidos en este momento');
    }

    const menuItemIds = [...new Set(dto.items.map((i) => i.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId: table.branchId, active: true },
    });
    const menuItemById = new Map(menuItems.map((item) => [item.id, item]));

    const missing = menuItemIds.filter((id) => !menuItemById.has(id));
    if (missing.length > 0) {
      throw new BadRequestException('Algunos productos del carrito ya no están disponibles — actualizá el menú e intentá de nuevo');
    }

    // "86": no se puede pedir un producto agotado por hoy.
    const soldOut = menuItems.filter((m) => m.soldOut).map((m) => m.name);
    if (soldOut.length > 0) {
      throw new BadRequestException(`Sin stock por hoy: ${soldOut.join(', ')}`);
    }

    // El precio SIEMPRE sale del servidor, nunca de lo que mande el cliente —
    // mismo criterio y MISMO service que OrdersService.create. Este es el
    // camino anónimo: acá el input viene de cualquiera con el link del QR, así
    // que la validación de `resolveLines` (que la opción pertenezca al producto
    // de esa línea) es lo que impide pagar de menos con el id de otro producto.
    // El QR de mesa es siempre salón (DINE_IN) → precio base.
    const resolved = await this.modifiers.resolveLines(dto.items, menuItemById);

    let subtotal = 0;
    const itemsData = dto.items.map((line, i) => {
      const { unitPrice, modifiers } = resolved[i]!;
      subtotal += Number(unitPrice) * line.quantity;
      return {
        tenantId: table.tenantId,
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        unitPrice,
        notes: line.notes,
        modifiers: modifiers ?? undefined,
      };
    });

    const order = await this.prisma.order.create({
      data: {
        tenantId: table.tenantId,
        branchId: table.branchId,
        tableId: table.id,
        type: 'DINE_IN',
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        notes: dto.notes,
        subtotal,
        total: subtotal,
        items: { create: itemsData },
      },
      include: { items: { include: { menuItem: true } } },
    });

    // KitchenService lee `TenantPrismaService`, que resuelve el tenant desde
    // el AsyncLocalStorage abierto por `tenantContextMiddleware` en TODA
    // request (incluida esta, pública) — solo que nunca nadie lo pobló
    // porque no hay JWT. Se establece acá a mano con el tenant derivado del
    // qrToken; el resto de esta misma request queda con el tenant correcto.
    tenantContext.setTenantId(table.tenantId);
    await this.kitchen.generateTasksForOrder(order.id, order.branchId, order.items);

    // Mismo efecto que "abrir mesa" del mesero — un pedido de cliente
    // también ocupa la mesa.
    await this.prisma.table.update({ where: { id: table.id }, data: { status: 'OCCUPIED' } });

    return { orderId: order.id, status: order.status, total: order.total };
  }

  /**
   * "Mi cuenta de la mesa": lo que el comensal puede consultar desde el QR sin
   * hacer un pedido nuevo — el acumulado EN VIVO de todos los pedidos abiertos
   * de la mesa (no pagados). Un mismo QR puede tener varios pedidos (el propio
   * más los del mozo); se suman todos. Estados activos = los mismos que ve el
   * mozo (WAITING/ACCEPTED/PREPARING/READY), no cuenta lo COMPLETED/CANCELLED.
   */
  async getTableAccount(qrToken: string) {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
      include: {
        branch: { include: { restaurant: { include: { tenant: true } } } },
        orders: {
          where: { status: { in: ['WAITING', 'ACCEPTED', 'PREPARING', 'READY'] } },
          orderBy: { createdAt: 'asc' },
          include: {
            items: { include: { menuItem: true } },
            // Para no sobrestimar: si la cuenta se dividió y una parte ya se
            // pagó, el pedido sigue abierto (recién pasa a COMPLETED cuando
            // TODOS los splits están pagos) pero lo pagado ya no se debe.
            billSplits: { select: { amount: true, paid: true } },
          },
        },
      },
    });
    if (!table) throw new NotFoundException('Código QR no válido');

    const orders = table.orders.map((o) => {
      const paid = o.billSplits.filter((s) => s.paid).reduce((s, x) => s + Number(x.amount), 0);
      const owed = Math.max(0, Number(o.total) - paid);
      return {
        id: o.id,
        status: o.status,
        total: o.total,
        // Lo ya pagado de este pedido (por splits) y lo que resta.
        paid,
        owed,
        createdAt: o.createdAt,
        items: o.items.map((i) => ({
          quantity: i.quantity,
          name: i.menuItem.name,
          unitPrice: i.unitPrice,
          notes: i.notes,
          modifiers: i.modifiers,
        })),
      };
    });

    return {
      tableCode: table.code,
      currency: table.branch.restaurant.tenant.currency,
      countryCode: table.branch.restaurant.tenant.countryCode,
      // El "total" de la cuenta es lo que se DEBE (total - ya pagado), no la
      // suma bruta — así el comensal no ve de más si alguien ya pagó su parte.
      total: orders.reduce((sum, o) => sum + o.owed, 0),
      orders,
    };
  }

  async getOrderStatus(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuItem: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    return {
      id: order.id,
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
      notes: order.notes,
      items: order.items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        name: i.menuItem.name,
        unitPrice: i.unitPrice,
        // El comensal tiene que poder confirmar que su "sin cebolla" quedó
        // registrado — este map los descartaba.
        notes: i.notes,
        modifiers: i.modifiers,
      })),
    };
  }

  /**
   * Pedido self-service desde el link COMPARTIBLE de la sucursal (`/r/:slug`).
   * A diferencia del QR de mesa (siempre DINE_IN), acá el cliente elige
   * delivery o retiro y paga al recibir — no hay pasarela. Mismo camino a
   * cocina; si es delivery, además crea el Delivery y dispara la auto-asignación
   * real (reusa `DeliveryService`), así el pedido entra al flujo de repartidores
   * existente y el cliente lo sigue en `/track/:trackingToken`.
   */
  async createPublicOrder(slug: string, dto: CreatePublicOrderDto, remoteIp?: string | null) {
    await this.turnstile.verify(dto.turnstileToken, remoteIp);

    const branch = await this.prisma.branch.findUnique({
      where: { publicSlug: slug },
      include: {
        restaurant: { include: { tenant: true } },
        hours: true,
        closures: true,
      },
    });
    if (!branch) throw new NotFoundException('Carta no encontrada');
    if (!branch.active || !branch.publicOrderingEnabled) {
      throw new BadRequestException('Esta sucursal no está tomando pedidos online en este momento');
    }

    // El tipo elegido tiene que estar habilitado por la sucursal — sin esto,
    // un cliente podría forzar un delivery contra un local que sólo hace retiro
    // mandando el body directo.
    if (dto.fulfillment === 'DELIVERY' && !branch.acceptsDelivery) {
      throw new BadRequestException('Esta sucursal no está haciendo envíos');
    }
    if (dto.fulfillment === 'PICKUP' && !branch.acceptsPickup) {
      throw new BadRequestException('Esta sucursal no está tomando pedidos para retirar');
    }

    // Horario: rechaza el pedido si está fuera de horario o en un día cerrado.
    // La verificación server-side es la que manda — el `isOpenNow` del GET es
    // sólo para pintar la UI; alguien podría pedir igual con el link directo.
    const openState = this.computeOpenState(branch.hours, branch.closures, branch.restaurant.tenant.timezone);
    if (!openState.open) {
      const message =
        openState.reason === 'closed_date'
          ? 'Hoy la sucursal está cerrada — probá otro día'
          : 'La sucursal está cerrada en este momento — fijate el horario de atención';
      throw new BadRequestException(message);
    }

    // Corte específico de delivery: la sucursal puede estar abierta (retiro
    // sigue OK) pero ya no tomar envíos. Sólo aplica al fulfillment DELIVERY.
    if (dto.fulfillment === 'DELIVERY') {
      const nowMinutes = localMomentInZone(new Date(), branch.restaurant.tenant.timezone).minutes;
      if (!isWithinDeliveryWindow(branch.deliveryStartMinute, branch.deliveryEndMinute, nowMinutes)) {
        const window = formatDeliveryWindow(branch.deliveryStartMinute, branch.deliveryEndMinute);
        throw new BadRequestException(
          `El horario de delivery ya cerró por hoy${window ? ` (envíos ${window})` : ''} — probá con retiro`,
        );
      }
    }

    const menuItemIds = [...new Set(dto.items.map((i) => i.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId: branch.id, active: true },
    });
    const missing = menuItemIds.filter((id) => !menuItems.some((m) => m.id === id));
    if (missing.length > 0) {
      throw new BadRequestException('Algunos productos del carrito ya no están disponibles — actualizá el menú e intentá de nuevo');
    }

    // "86": no se puede pedir un producto agotado por hoy.
    const soldOutNames = menuItems.filter((m) => m.soldOut).map((m) => m.name);
    if (soldOutNames.length > 0) {
      throw new BadRequestException(`Sin stock por hoy: ${soldOutNames.join(', ')}`);
    }

    // Precio por canal: si es DELIVERY y el producto tiene `deliveryPrice`, ese
    // gana; sino, el precio base. Se resuelve poniendo el precio efectivo en el
    // map que consume `resolveLines`. Precio SIEMPRE server-side.
    const isDeliveryChannel = dto.fulfillment === 'DELIVERY';
    const menuItemById = new Map(
      menuItems.map((item) => [
        item.id,
        { ...item, price: isDeliveryChannel && item.deliveryPrice != null ? item.deliveryPrice : item.price },
      ]),
    );
    const resolved = await this.modifiers.resolveLines(dto.items, menuItemById);

    let subtotal = 0;
    const itemsData = dto.items.map((line, i) => {
      const { unitPrice, modifiers } = resolved[i]!;
      subtotal += Number(unitPrice) * line.quantity;
      return {
        tenantId: branch.tenantId,
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        unitPrice,
        notes: line.notes,
        modifiers: modifiers ?? undefined,
      };
    });

    const isDelivery = dto.fulfillment === 'DELIVERY';
    const fee = isDelivery ? Number(branch.deliveryFee) : 0;

    // Cupón (opcional): se valida contra el SUBTOTAL antes de crear nada, así
    // un código vencido/agotado corta el pedido con un motivo claro. El envío
    // no se descuenta: el cupón aplica sobre los productos.
    const coupon = dto.couponCode
      ? await this.coupons.validate(branch.tenantId, dto.couponCode, subtotal)
      : null;
    const discountTotal = coupon?.amount ?? 0;
    const total = subtotal + fee - discountTotal;

    // El pedido y el canje van en la MISMA transacción: si el cupón se agota en
    // una carrera entre la validación y el canje, revierte todo (el cliente ve
    // el error) en vez de dejar un pedido con un descuento que ya no correspondía.
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId: branch.tenantId,
          branchId: branch.id,
          type: isDelivery ? 'DELIVERY' : 'TAKEAWAY',
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          notes: dto.notes,
          subtotal,
          discountTotal,
          deliveryFee: isDelivery ? fee : undefined,
          total,
          items: { create: itemsData },
        },
        include: { items: { include: { menuItem: true } } },
      });
      if (coupon) {
        await this.coupons.redeem(
          {
            tenantId: branch.tenantId,
            couponId: coupon.couponId,
            orderId: created.id,
            amount: coupon.amount,
            customerPhone: dto.customerPhone,
          },
          tx,
        );
      }
      return created;
    });

    // Igual que en createGuestOrder: la request pública no tiene tenant en el
    // ALS (no hay JWT). Se setea a mano con el tenant derivado del slug para que
    // KitchenService y DeliveryService (tenant-scoped) resuelvan el tenant.
    tenantContext.setTenantId(branch.tenantId);
    await this.kitchen.generateTasksForOrder(order.id, order.branchId, order.items);

    if (isDelivery) {
      const delivery = await this.delivery.createForPublicOrder(order.id, {
        addressLine: dto.address!,
        fee,
        lat: dto.lat,
        lng: dto.lng,
      });
      // Va el TOKEN, no el id: el link del cliente no puede ser la misma clave
      // que ven el staff y el repartidor (con ella, el repartidor se calificaba
      // solo). `deliveryId` se mantiene porque el front lo usa para nada más
      // que mostrar; el que abre el seguimiento es `trackingToken`.
      return {
        orderId: order.id,
        deliveryId: delivery.id,
        trackingToken: delivery.trackingToken,
        fulfillment: dto.fulfillment,
        status: order.status,
        total: order.total,
      };
    }

    // Retiro: no hay Delivery; el cliente sigue el estado por
    // `/public/menu/orders/:orderId/status` como cualquier pedido de QR.
    return {
      orderId: order.id,
      fulfillment: dto.fulfillment,
      status: order.status,
      total: order.total,
    };
  }

  /** Forma de salida compartida por el menú de QR y el menú por slug. */
  private mapCategories(
    categories: {
      id: string;
      name: string;
      items: {
        id: string;
        name: string;
        description: string | null;
        price: unknown;
        deliveryPrice: unknown;
        soldOut: boolean;
        imageUrl: string | null;
        isCombo: boolean;
        modifierGroups: {
          id: string;
          name: string;
          minSelect: number;
          maxSelect: number;
          required: boolean;
          options: { id: string; name: string; priceDelta: unknown }[];
        }[];
        comboComponents: { quantity: number; component: { id: string; name: string } }[];
      }[];
    }[],
  ) {
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        /** Precio para delivery (o null = igual al base). El front lo muestra
         *  cuando el cliente elige envío. */
        deliveryPrice: i.deliveryPrice,
        /** "86": agotado por hoy — el front lo muestra deshabilitado. */
        soldOut: i.soldOut,
        imageUrl: i.imageUrl,
        /** Si es combo, el front lo marca y muestra "Incluye: ...". */
        isCombo: i.isCombo,
        comboItems: i.comboComponents.map((cc) => ({ quantity: cc.quantity, name: cc.component.name })),
        modifierGroups: i.modifierGroups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          required: g.required,
          options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })),
        })),
      })),
    }));
  }

  /** Envuelve el helper puro `isBranchOpen` calculando el "ahora" local. */
  private computeOpenState(
    hours: WeeklyHours[],
    closures: { date: Date }[],
    timezone: string,
  ): OpenState {
    const now = localMomentInZone(new Date(), timezone);
    // `date` viene como Date @db.Date (medianoche UTC). Tomar los componentes
    // UTC evita que un timezone negativo lo corra al día anterior.
    const closedDates = closures.map((c) => c.date.toISOString().slice(0, 10));
    return isBranchOpen(hours, closedDates, now);
  }
}

/** Minutos desde medianoche → "HH:MM" (24h). */
function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Texto legible de la ventana de delivery para el mensaje de error, o `null`
 * si no hay ventana configurada (no se agrega nada al mensaje).
 */
function formatDeliveryWindow(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `de ${minutesToHHMM(start)} a ${minutesToHHMM(end)}`;
  if (end != null) return `hasta las ${minutesToHHMM(end)}`;
  return `desde las ${minutesToHHMM(start!)}`;
}
