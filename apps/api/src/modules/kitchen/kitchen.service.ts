import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canTransitionKitchenTask,
  canTransitionOrder,
  type KitchenTaskStatus,
  type OrderStatus,
  type StationType,
} from '@chillberry/domain';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { NotificationsService } from '../integrations/notifications.service';
import { KitchenGateway } from './kitchen.gateway';

/**
 * Cuánto tiempo sigue visible una comanda ya ENTREGADA en el tablero. Existe
 * para que la columna ENTREGADOS sea útil (poder deshacer un "entregado"
 * disparado por error) sin volverse un archivo histórico infinito.
 */
const DELIVERED_VISIBLE_MS = 4 * 60 * 60 * 1000;

const DEFAULT_STATIONS: { type: StationType; name: string }[] = [
  { type: 'HOT_KITCHEN', name: 'Cocina caliente' },
  { type: 'DRINKS', name: 'Bebidas' },
  { type: 'DESSERTS', name: 'Postres' },
  { type: 'GRILL', name: 'Parrilla' },
];

const TASK_TIMESTAMP_FIELD: Partial<Record<KitchenTaskStatus, string>> = {
  IN_PROGRESS: 'startedAt',
  READY: 'readyAt',
  DELIVERED: 'deliveredAt',
};

// Estado anterior en el flujo (para el "recall"/bump-back de cocina): deshacer
// un avance disparado por error. NEW no tiene anterior.
const PREV_KITCHEN_STATUS: Partial<Record<KitchenTaskStatus, KitchenTaskStatus>> = {
  IN_PROGRESS: 'NEW',
  READY: 'IN_PROGRESS',
  DELIVERED: 'READY',
};

@Injectable()
export class KitchenService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gateway: KitchenGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /** Se llama al crear una sucursal — cada branch arranca con las 4 estaciones estándar. */
  async ensureDefaultStations(branchId: string) {
    for (const station of DEFAULT_STATIONS) {
      await this.tenantPrisma.client.kitchenStation.upsert({
        where: { branchId_type: { branchId, type: station.type } },
        update: {},
        create: { branchId, type: station.type, name: station.name, tenantId: this.tenantPrisma.tenantId },
      });
    }
  }

  listStations(branchId: string) {
    return this.tenantPrisma.client.kitchenStation.findMany({
      where: { branchId, active: true },
      orderBy: { type: 'asc' },
    });
  }

  /**
   * Agrupa los items del pedido por estación (según `MenuItem.stationId`) y
   * crea una `KitchenTask` por estación con items presentes. Items sin
   * estación asignada caen en la primera estación de la sucursal (fallback)
   * para no perder el item de la vista de cocina.
   */
  async generateTasksForOrder(
    orderId: string,
    branchId: string,
    orderItems: { id: string; menuItemId: string }[],
  ) {
    const menuItemIds = [...new Set(orderItems.map((i) => i.menuItemId))];
    const menuItems = await this.tenantPrisma.client.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    const stations = await this.listStations(branchId);
    const fallbackStationId = stations[0]?.id;

    const itemIdsByStation = new Map<string, string[]>();
    for (const item of orderItems) {
      const stationId = menuItemById.get(item.menuItemId)?.stationId ?? fallbackStationId;
      if (!stationId) continue;
      const bucket = itemIdsByStation.get(stationId) ?? [];
      bucket.push(item.id);
      itemIdsByStation.set(stationId, bucket);
    }

    const createdTasks = [];
    for (const [stationId, itemIds] of itemIdsByStation) {
      const task = await this.tenantPrisma.client.kitchenTask.create({
        data: { orderId, stationId, tenantId: this.tenantPrisma.tenantId },
      });
      await this.tenantPrisma.client.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: { kitchenTaskId: task.id },
      });
      createdTasks.push(task);
      this.gateway.emitToBranch(branchId, 'kitchen:task:created', { taskId: task.id, orderId });
    }
    return createdTasks;
  }

  /**
   * Avisa al KDS que las tareas de un pedido cambiaron sin crear una nueva
   * (p.ej. el mesero quitó o cambió la cantidad de un ítem ya enviado). El
   * board escucha `kitchen:task:updated` y se recarga.
   */
  notifyTasksChanged(branchId: string, orderId: string) {
    this.gateway.emitToBranch(branchId, 'kitchen:task:updated', { orderId });
  }

  /**
   * Feed del Kanban: las tareas VIGENTES de la sucursal, con su pedido e ítems.
   *
   * Antes el `where` era sólo `station.branchId`, sin filtro de estado ni
   * ventana de tiempo, así que devolvía TODAS las tareas de la historia de la
   * sucursal. Dos consecuencias, las dos malas:
   *
   *  - La columna ENTREGADOS crecía sin techo: a las pocas semanas el board
   *    traía miles de comandas con todos sus ítems en cada refresco.
   *  - Un pedido ANULADO seguía mostrando su comanda, así que cocina preparaba
   *    comida de un pedido que ya no existía.
   *
   * Ahora: nada de pedidos cancelados, y las entregadas sólo mientras siguen
   * siendo útiles para el turno (se ven un rato por si hay que deshacer).
   */
  listBoard(branchId: string) {
    const desde = new Date(Date.now() - DELIVERED_VISIBLE_MS);
    return this.tenantPrisma.client.kitchenTask.findMany({
      where: {
        station: { branchId },
        order: { status: { not: 'CANCELLED' } },
        OR: [{ status: { not: 'DELIVERED' } }, { updatedAt: { gte: desde } }],
      },
      include: {
        station: true,
        order: { include: { table: true } },
        items: {
          include: {
            // Si el ítem es un combo, sus componentes para que el cocinero vea
            // qué lleva ("Combo Clásico — Hamburguesa, Papas, Refresco").
            menuItem: {
              include: {
                comboComponents: {
                  include: { component: { select: { name: true } } },
                  orderBy: { quantity: 'desc' },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateTaskStatus(taskId: string, nextStatus: KitchenTaskStatus, userId: string) {
    const task = await this.tenantPrisma.client.kitchenTask.findUnique({
      where: { id: taskId },
      include: { station: true },
    });
    if (!task) throw new NotFoundException('Tarea de cocina no encontrada');

    if (!canTransitionKitchenTask(task.status as KitchenTaskStatus, nextStatus)) {
      throw new ConflictException(`No se puede pasar de ${task.status} a ${nextStatus}`);
    }

    const timestampField = TASK_TIMESTAMP_FIELD[nextStatus];
    const updated = await this.tenantPrisma.client.kitchenTask.update({
      where: { id: taskId },
      data: {
        status: nextStatus,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
        ...(nextStatus === 'IN_PROGRESS' ? { takenById: userId } : {}),
      },
    });

    await this.aggregateOrderStatus(task.orderId);
    this.gateway.emitToBranch(task.station.branchId, 'kitchen:task:updated', {
      taskId,
      status: nextStatus,
      orderId: task.orderId,
    });
    return updated;
  }

  /**
   * "Recall" / bump-back: retrocede una tarea UN paso en el flujo — el cocinero
   * marcó algo por error (avanzó a listo, o dio por entregado sin serlo). El
   * flujo normal es forward-only; esto es la excepción explícita de deshacer.
   *
   * Limpia el timestamp del estado que se deshace (y `takenById` si vuelve a
   * NEW), y re-agrega el estado del pedido — que puede volver de READY a
   * PREPARING si el pedido ya no está completo. No se puede sobre un pedido
   * cerrado (cobrado o cancelado).
   */
  async recallTask(taskId: string, _userId: string) {
    const task = await this.tenantPrisma.client.kitchenTask.findUnique({
      where: { id: taskId },
      include: { station: true, order: { select: { status: true } } },
    });
    if (!task) throw new NotFoundException('Tarea de cocina no encontrada');
    if (task.order.status === 'COMPLETED' || task.order.status === 'CANCELLED') {
      throw new ConflictException('El pedido ya está cerrado — no se puede deshacer en cocina');
    }
    const prev = PREV_KITCHEN_STATUS[task.status as KitchenTaskStatus];
    if (!prev) {
      throw new ConflictException('La tarea está en el primer estado — no hay nada que deshacer');
    }

    // Se limpia el timestamp del estado ACTUAL (el que se deshace); si vuelve a
    // NEW, también quién la había tomado.
    const clearField = TASK_TIMESTAMP_FIELD[task.status as KitchenTaskStatus];
    const updated = await this.tenantPrisma.client.kitchenTask.update({
      where: { id: taskId },
      data: {
        status: prev,
        ...(clearField ? { [clearField]: null } : {}),
        ...(prev === 'NEW' ? { takenById: null } : {}),
      },
    });

    await this.aggregateOrderStatus(task.orderId);
    this.gateway.emitToBranch(task.station.branchId, 'kitchen:task:updated', {
      taskId,
      status: prev,
      orderId: task.orderId,
    });
    return updated;
  }

  /**
   * El status del Order es un agregado de sus KitchenTask: arranca a moverse
   * (WAITING->PREPARING) en cuanto una estación toma la primera tarea, y pasa
   * a READY solo cuando TODAS las estaciones terminaron.
   */
  private async aggregateOrderStatus(orderId: string) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id: orderId },
      include: { kitchenTasks: true, table: { select: { code: true } } },
    });
    if (!order || order.kitchenTasks.length === 0) return;
    // Un pedido cerrado (cobrado/cancelado) no se re-agrega — su estado es final.
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') return;

    const statuses = order.kitchenTasks.map((t) => t.status);
    const anyStarted = statuses.some((s) => s !== 'NEW');
    const allDone = statuses.every((s) => s === 'READY' || s === 'DELIVERED');

    // --- Retroceso por "recall" en cocina: mantener el pedido consistente con
    // sus tareas cuando el cocinero deshace un avance. Es directo (sin el guard
    // forward-only), porque es justamente la operación inversa. ---
    if (!allDone && order.status === 'READY') {
      await this.tenantPrisma.client.order.update({
        where: { id: orderId },
        data: { status: 'PREPARING', readyAt: null },
      });
      return; // el pedido volvió atrás; no aplicar además una regla forward
    }
    if (!anyStarted && (order.status === 'PREPARING' || order.status === 'ACCEPTED')) {
      await this.tenantPrisma.client.order.update({
        where: { id: orderId },
        data: { status: 'WAITING', acceptedAt: null },
      });
      return;
    }

    if (anyStarted && order.status === 'WAITING') {
      await this.setOrderStatus(orderId, 'WAITING', 'ACCEPTED');
      await this.setOrderStatus(orderId, 'ACCEPTED', 'PREPARING');
    }
    if (allDone && order.status === 'PREPARING') {
      await this.setOrderStatus(orderId, 'PREPARING', 'READY');

      // Avisar "listo": en vivo a las pantallas de la sucursal (el mozo escucha
      // `order:ready` en el mismo namespace `/kitchen`), y al cliente por
      // los avisos si dejó teléfono (take away / delivery). Best-effort: nunca
      // rompe el avance de estado.
      this.gateway.emitToBranch(order.branchId, 'order:ready', {
        orderId,
        tableCode: order.table?.code ?? null,
        type: order.type,
      });
      const ref = order.table?.code ? `mesa ${order.table.code}` : null;
      await this.notifications.notifyOrderReady(order.tenantId, order.customerPhone, ref).catch(() => {});
    }
  }

  private async setOrderStatus(orderId: string, from: OrderStatus, to: OrderStatus) {
    if (!canTransitionOrder(from, to)) return;
    const timestampField = { ACCEPTED: 'acceptedAt', READY: 'readyAt' }[to as 'ACCEPTED' | 'READY'];
    await this.tenantPrisma.client.order.update({
      where: { id: orderId },
      data: { status: to, ...(timestampField ? { [timestampField]: new Date() } : {}) },
    });
  }
}
