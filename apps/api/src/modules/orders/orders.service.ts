import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_TYPE, canTransitionOrder, type OrderStatus } from '@chillberry/domain';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { KitchenService } from '../kitchen/kitchen.service';
import { ModifiersService } from '../menu/modifiers.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kitchen: KitchenService,
    private readonly modifiers: ModifiersService,
    // Para registrar la merma cuando se anula un pedido ya preparado.
    private readonly inventory: InventoryService,
  ) {}

  async create(dto: CreateOrderDto, waiterId: string) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');

    if (dto.tableId) {
      const table = await this.tenantPrisma.client.table.findUnique({ where: { id: dto.tableId } });
      if (!table) throw new NotFoundException('Mesa no encontrada');
      if (table.branchId !== dto.branchId) {
        throw new BadRequestException('La mesa no pertenece a esa sucursal');
      }
    }

    const orderType = dto.type ?? ORDER_TYPE.DineIn;
    const { itemsData, subtotal } = await this.buildItemsData(
      dto.items,
      dto.branchId,
      1,
      orderType === ORDER_TYPE.Delivery,
    );

    const order = await this.tenantPrisma.client.order.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        tableId: dto.tableId,
        waiterId,
        type: dto.type ?? ORDER_TYPE.DineIn,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        notes: dto.notes,
        subtotal,
        total: subtotal,
        items: { create: itemsData },
      },
      include: { items: { include: { menuItem: true } } },
    });

    // Genera una KitchenTask por estación (KDS) — el pedido queda en WAITING
    // hasta que cocina toma la primera tarea (ver KitchenService.aggregateOrderStatus).
    await this.kitchen.generateTasksForOrder(order.id, order.branchId, order.items);

    return order;
  }

  /**
   * Agrega una ronda a un pedido YA abierto: "agregame un postre a la mesa 4".
   *
   * Es el flujo central del rubro (picada → milanesas → postre, una sola
   * cuenta) y no existía: no había endpoint para sumar ítems a un pedido y la
   * UI del mesero ocultaba el carrito apenas la mesa tenía pedido. Sin esto, la
   * segunda tanda obligaba a abrir un pedido nuevo (dos cuentas para una mesa).
   *
   * Solo agrega a cocina los ítems NUEVOS —no re-dispara los ya entregados— y
   * los marca con la ronda siguiente para que el KDS los muestre aparte.
   */
  async addItems(orderId: string, items: CreateOrderItemDto[], _actingUserId: string) {
    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new ConflictException('No se pueden agregar ítems a un pedido cerrado');
    }
    // Si ya se cobró una parte, sumar ítems descuadra el split y los pagos
    // hechos. Que primero anulen el pago o cierren la cuenta.
    const paidSplit = await this.tenantPrisma.client.billSplit.findFirst({
      where: { orderId, paid: true },
      select: { id: true },
    });
    if (paidSplit) {
      throw new ConflictException('Este pedido ya tiene una parte cobrada — no se le pueden agregar ítems');
    }

    const lastRound = await this.tenantPrisma.client.orderItem.aggregate({
      where: { orderId },
      _max: { round: true },
    });
    const nextRound = (lastRound._max.round ?? 0) + 1;

    const { itemsData, subtotal: addedSubtotal } = await this.buildItemsData(
      items,
      order.branchId,
      nextRound,
      order.type === ORDER_TYPE.Delivery,
    );

    // Se crean e insertan los ítems, y se leen de vuelta SOLO los nuevos para
    // mandarlos a cocina — `createMany` no devuelve las filas, así que se
    // filtran por la ronda recién asignada.
    await this.tenantPrisma.client.orderItem.createMany({ data: itemsData.map((d) => ({ ...d, orderId })) });
    const newItems = await this.tenantPrisma.client.orderItem.findMany({
      where: { orderId, round: nextRound },
      select: { id: true, menuItemId: true },
    });

    // `increment` y no un valor absoluto: dos mozos agregando a la misma mesa en
    // el mismo segundo leían ambos el subtotal viejo y el segundo pisaba al
    // primero — los dos ítems quedaban creados pero uno no sumaba a la cuenta.
    // El descuadre era permanente y silencioso. Como sólo cambia el subtotal, el
    // total se mueve exactamente lo mismo (tax/descuento/envío no cambian acá).
    await this.tenantPrisma.client.order.update({
      where: { id: orderId },
      data: {
        subtotal: { increment: addedSubtotal },
        total: { increment: addedSubtotal },
        // Volver a WAITING si la mesa ya estaba servida: la nueva ronda todavía
        // no se cocinó. Si el pedido estaba más atrás, se respeta su estado.
        status: order.status === 'READY' ? 'WAITING' : order.status,
      },
    });

    await this.kitchen.generateTasksForOrder(orderId, order.branchId, newItems);

    return this.getOrThrow(orderId);
  }

  /**
   * Quita un ítem de un pedido YA enviado a cocina — el caso "el mozo disparó
   * mal un plato". Antes, sacar un ítem obligaba a cancelar TODO el pedido.
   *
   * Recalcula el total, limpia la KitchenTask si queda sin ítems y avisa al KDS.
   * No se puede vaciar el pedido (el último ítem no se quita: se cancela el
   * pedido), ni tocar uno cerrado o con una parte ya cobrada.
   */
  async removeItem(orderId: string, itemId: string, _actingUserId: string) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { id: true, quantity: true, unitPrice: true, kitchenTaskId: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    this.assertOrderItemsEditable(order.status);
    await this.assertNoPaidSplit(orderId);

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado en este pedido');
    if (order.items.length === 1) {
      throw new ConflictException('Es el único ítem del pedido — cancelá el pedido en vez de vaciarlo');
    }

    const lineTotal = Number(item.unitPrice) * item.quantity;
    const newSubtotal = Number(order.subtotal) - lineTotal;
    this.assertDiscountFits(order, newSubtotal);

    // El delta se aplica SÓLO si este delete fue el que realmente borró la fila.
    // Sin este guard, dos taps del mozo (o dos requests) borran el ítem una vez
    // pero restan el total dos veces: el segundo delete no encuentra nada
    // (count=0) pero antes se restaba igual, dejando el total por debajo de lo
    // real y de forma permanente.
    const borrado = await this.tenantPrisma.client.orderItem.deleteMany({ where: { id: itemId, orderId } });
    if (borrado.count === 0) return this.getOrThrow(orderId);
    await this.applySubtotalDelta(orderId, -lineTotal);

    // Si la KitchenTask del ítem quedó vacía, se borra (sino el KDS mostraría
    // una tarjeta sin ítems). Después se avisa al board para que se recargue.
    if (item.kitchenTaskId) {
      const remainingOnTask = await this.tenantPrisma.client.orderItem.count({
        where: { kitchenTaskId: item.kitchenTaskId },
      });
      if (remainingOnTask === 0) {
        await this.tenantPrisma.client.kitchenTask.deleteMany({ where: { id: item.kitchenTaskId } });
      }
    }
    this.kitchen.notifyTasksChanged(order.branchId, orderId);

    return this.getOrThrow(orderId);
  }

  /**
   * Cambia la cantidad de un ítem ya enviado (ej. "eran 2 no 3"). Recalcula el
   * total y avisa al KDS. Para llevar a 0 se usa `removeItem`, no cantidad 0.
   */
  async updateItemQuantity(orderId: string, itemId: string, quantity: number, _actingUserId: string) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException('La cantidad debe ser 1 o más (para quitar el ítem, eliminalo)');
    }
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: { select: { id: true, quantity: true, unitPrice: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    this.assertOrderItemsEditable(order.status);
    await this.assertNoPaidSplit(orderId);

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado en este pedido');
    if (item.quantity === quantity) return this.getOrThrow(orderId);

    const delta = (quantity - item.quantity) * Number(item.unitPrice);
    const newSubtotal = Number(order.subtotal) + delta;
    this.assertDiscountFits(order, newSubtotal);

    // El where incluye la cantidad LEÍDA: así el update sólo pega si nadie la
    // cambió en el medio. Si dos "eran 2 no 3" concurrentes pasaran los dos, el
    // segundo no matchea (la cantidad ya no es la que leyó) y su delta stale no
    // se aplica — antes ambos restaban y el subtotal bajaba el doble.
    const cambiado = await this.tenantPrisma.client.orderItem.updateMany({
      where: { id: itemId, orderId, quantity: item.quantity },
      data: { quantity },
    });
    if (cambiado.count === 0) return this.getOrThrow(orderId);
    await this.applySubtotalDelta(orderId, delta);
    this.kitchen.notifyTasksChanged(order.branchId, orderId);

    return this.getOrThrow(orderId);
  }

  private assertOrderItemsEditable(status: string) {
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      throw new ConflictException('No se pueden editar los ítems de un pedido cerrado');
    }
  }

  private async assertNoPaidSplit(orderId: string) {
    const paidSplit = await this.tenantPrisma.client.billSplit.findFirst({
      where: { orderId, paid: true },
      select: { id: true },
    });
    if (paidSplit) {
      throw new ConflictException('Este pedido ya tiene una parte cobrada — no se pueden editar los ítems');
    }
  }

  /** El descuento ya aplicado no puede superar el nuevo total (evita total negativo). */
  private assertDiscountFits(order: { discountTotal: unknown; taxTotal: unknown }, newSubtotal: number) {
    const discount = Number(order.discountTotal);
    if (discount > 0 && discount > newSubtotal + Number(order.taxTotal)) {
      throw new ConflictException(
        'El descuento aplicado supera el nuevo total — quitá el descuento antes de editar los ítems',
      );
    }
  }

  /**
   * Mueve subtotal y total por un DELTA, no escribiendo el absoluto: así dos
   * ediciones concurrentes del mismo pedido (quitar un ítem en una tablet
   * mientras se cambia la cantidad en otra) se suman en la DB en vez de pisarse.
   * Sólo se toca el subtotal, así que el total se mueve exactamente igual.
   */
  private async applySubtotalDelta(orderId: string, delta: number) {
    await this.tenantPrisma.client.order.update({
      where: { id: orderId },
      data: { subtotal: { increment: delta }, total: { increment: delta } },
    });
  }

  /**
   * Valida ítems + resuelve precios/modificadores server-side, para reusar
   * entre `create` (pedido nuevo) y `addItems` (ronda siguiente).
   */
  private async buildItemsData(
    items: CreateOrderItemDto[],
    branchId: string,
    round: number,
    isDelivery: boolean,
  ) {
    const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
    const menuItems = await this.tenantPrisma.client.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId, active: true },
    });

    const missing = menuItemIds.filter((id) => !menuItems.some((m) => m.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(`Productos no encontrados en esta sucursal: ${missing.join(', ')}`);
    }

    // "86": no se puede pedir un producto marcado como agotado.
    const soldOut = menuItems.filter((m) => m.soldOut).map((m) => m.name);
    if (soldOut.length > 0) {
      throw new BadRequestException(`Sin stock por hoy: ${soldOut.join(', ')}`);
    }

    // Precio por canal: delivery usa `deliveryPrice` si está cargado, sino el
    // precio base. El precio efectivo se mete en el map que consume
    // `resolveLines` (que sólo lee `.price`), así no hace falta tocar esa lógica.
    const menuItemById = new Map(
      menuItems.map((item) => [
        item.id,
        { ...item, price: isDelivery && item.deliveryPrice != null ? item.deliveryPrice : item.price },
      ]),
    );

    // El precio SIEMPRE se toma del servidor, nunca de lo que mande el cliente.
    const resolved = await this.modifiers.resolveLines(items, menuItemById);

    let subtotal = 0;
    const itemsData = items.map((line, i) => {
      const { unitPrice, modifiers } = resolved[i]!;
      subtotal += Number(unitPrice) * line.quantity;
      return {
        // La extensión de tenant-scoping solo intercepta la llamada de nivel
        // superior; un `items: { create: [...] }` anidado NO pasa por ella, así
        // que el tenantId va a mano.
        tenantId: this.tenantPrisma.tenantId,
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        round,
        unitPrice,
        notes: line.notes,
        modifiers: modifiers ?? undefined,
      };
    });

    return { itemsData, subtotal };
  }

  list(filters: { branchId?: string; status?: OrderStatus; limit?: number; offset?: number }) {
    return this.tenantPrisma.client.order.findMany({
      where: {
        branchId: filters.branchId,
        status: filters.status,
      },
      include: { items: { include: { menuItem: true } }, table: true },
      orderBy: { createdAt: 'desc' },
      // Paginación: la lista era un findMany sin límite (se degrada con volumen).
      take: Math.min(Math.max(filters.limit ?? 50, 1), 200),
      skip: Math.max(filters.offset ?? 0, 0),
    });
  }

  async getOrThrow(id: string) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id },
      include: { items: { include: { menuItem: true } }, table: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  async updateStatus(id: string, nextStatus: OrderStatus, actingUserId: string, reason?: string) {
    const order = await this.getOrThrow(id);

    if (!canTransitionOrder(order.status as OrderStatus, nextStatus)) {
      throw new ConflictException(
        `No se puede pasar de ${order.status} a ${nextStatus}`,
      );
    }

    // Cancelar deja rastro: quién y por qué. El motivo es obligatorio —
    // anular es el vector de fraude clásico (cobrar en efectivo y después
    // anular la venta), y sin motivo + responsable el arqueo cierra perfecto
    // y no queda evidencia.
    const isCancel = nextStatus === 'CANCELLED';
    if (isCancel && (!reason || reason.trim().length < 3)) {
      throw new BadRequestException('Para cancelar un pedido tenés que indicar el motivo');
    }

    const timestampField = {
      ACCEPTED: 'acceptedAt',
      READY: 'readyAt',
      COMPLETED: 'completedAt',
      CANCELLED: 'cancelledAt',
    }[nextStatus as 'ACCEPTED' | 'READY' | 'COMPLETED' | 'CANCELLED'];

    const updated = await this.tenantPrisma.client.order.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
        ...(isCancel ? { cancelReason: reason, cancelledById: actingUserId } : {}),
      },
    });

    // Anulación DESPUÉS de que cocina lo preparó: la comida se hizo y se tiró,
    // así que los insumos se consumieron igual. Se registran como MERMA.
    //
    // Sin esto quedaba un agujero: la depleción de inventario corre al COMPLETAR
    // un pedido, y un pedido anulado nunca completa — o sea que nunca descontaba
    // nada. Cada anulación tardía inflaba el stock teórico y alguien tenía que
    // acordarse de cargar la merma a mano.
    //
    // Sólo desde PREPARING en adelante: si se anula en WAITING o ACCEPTED, la
    // comida no se llegó a hacer y no hay nada que perder.
    if (isCancel && (order.status === 'PREPARING' || order.status === 'READY')) {
      await this.inventory.registerWasteForOrder(id, reason!.trim());
    }

    return updated;
  }
}
