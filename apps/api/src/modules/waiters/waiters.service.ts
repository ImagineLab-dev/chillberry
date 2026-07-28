import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BILL_SPLIT_MODE, BILL_SPLIT_ROUNDING_TOLERANCE, type UserRole } from '@chillberry/domain';
import { assertPuedeUsarSucursal } from '../../common/security/branch-scope';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { KitchenGateway } from '../kitchen/kitchen.gateway';
import { TransferTableDto } from './dto/transfer-table.dto';
import { MergeTablesDto } from './dto/merge-tables.dto';
import { SplitOrderDto } from './dto/split-order.dto';

const ACTIVE_ORDER_STATUSES = ['WAITING', 'ACCEPTED', 'PREPARING', 'READY'] as const;

/** Quien opera, para el control de sucursal en las operaciones por id. */
type Actor = { id: string; role: UserRole; branchId: string | null };

/**
 * Campos de `Table` que puede ver un MOZO. Existe para dejar afuera el
 * `qrToken`, que NO es un dato de la mesa sino una credencial: con él se pide y
 * se lee la cuenta por `public/menu/:qrToken` sin autenticarse y desde
 * cualquier IP. Por eso `GET /tables` (que sí lo devuelve) está restringido a
 * dueño/admin — pero este módulo lo estaba filtrando por la puerta de al lado,
 * en las 4 respuestas que devolvían la fila entera.
 *
 * Se usa `select` y no `omit` a propósito: con `select`, un campo sensible que
 * se agregue mañana al modelo queda afuera por defecto en vez de filtrarse.
 */
const TABLE_SAFE_SELECT = {
  id: true,
  branchId: true,
  code: true,
  status: true,
  capacity: true,
  active: true,
} as const;

@Injectable()
export class WaitersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kitchenGateway: KitchenGateway,
  ) {}

  /** Mapa de mesas: estado + pedido activo (si hay uno) para pintar 🟢🔴🟡.
   *  Solo mesas activas — una mesa retirada (soft-delete) no va en el mapa. */
  listTables(branchId: string) {
    return this.tenantPrisma.client.table.findMany({
      where: { branchId, active: true },
      select: {
        ...TABLE_SAFE_SELECT,
        orders: {
          where: { status: { in: [...ACTIVE_ORDER_STATUSES] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            total: true,
            billRequestedAt: true,
            billRequestNote: true,
            createdAt: true,
          },
        },
      },
      orderBy: { code: 'asc' },
    });
  }

  async openTable(tableId: string, actor: Actor) {
    const table = await this.tenantPrisma.client.table.findUnique({ where: { id: tableId } });
    if (!table) throw new NotFoundException('Mesa no encontrada');
    // Por id no hay filtro implicito de sucursal: sin esto, el UUID de una mesa
    // de otro local alcanzaba para operarla. Mismo criterio que orders/pos.
    assertPuedeUsarSucursal(actor, table.branchId);
    return this.tenantPrisma.client.table.update({
      where: { id: tableId },
      data: { status: 'OCCUPIED' },
      select: TABLE_SAFE_SELECT,
    });
  }

  async transfer(dto: TransferTableDto, actor: Actor) {
    const userId = actor.id;
    const order = await this.tenantPrisma.client.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    assertPuedeUsarSucursal(actor, order.branchId);
    if (!order.tableId) throw new BadRequestException('El pedido no está asociado a una mesa');
    if (order.tableId === dto.toTableId) {
      throw new BadRequestException('El pedido ya está en esa mesa');
    }

    const toTable = await this.tenantPrisma.client.table.findUnique({ where: { id: dto.toTableId } });
    if (!toTable) throw new NotFoundException('Mesa destino no encontrada');
    // La mesa destino tiene que ser del MISMO local que el pedido: mover un
    // pedido a una mesa de otra sucursal mezcla la caja y la cocina de las dos.
    if (toTable.branchId !== order.branchId) {
      throw new BadRequestException('La mesa destino es de otra sucursal');
    }
    if (toTable.status !== 'AVAILABLE') {
      throw new ConflictException('La mesa destino no está disponible');
    }

    const fromTableId = order.tableId;

    // Batch atómico (array form de $transaction) — cada operación ya pasó
    // por el Prisma Client Extension de tenant-scoping al construirse, así
    // que el batch en sí no necesita reimplementar ese filtro.
    await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.order.update({ where: { id: order.id }, data: { tableId: dto.toTableId } }),
      this.tenantPrisma.client.table.update({ where: { id: fromTableId }, data: { status: 'AVAILABLE' } }),
      this.tenantPrisma.client.table.update({ where: { id: dto.toTableId }, data: { status: 'OCCUPIED' } }),
      this.tenantPrisma.client.tableTransferLog.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          orderId: order.id,
          fromTableId,
          toTableId: dto.toTableId,
          userId,
        },
      }),
    ]);

    return this.tenantPrisma.client.order.findUnique({
      where: { id: order.id },
      include: { table: { select: TABLE_SAFE_SELECT } },
    });
  }

  /**
   * Fusiona N-1 mesas secundarias dentro de la mesa primaria (`tableIds[0]`).
   * Cada mesa secundaria con pedido activo: sus items pasan al pedido de la
   * primaria y su propio pedido se cancela con referencia. Mesas secundarias
   * sin pedido activo solo quedan marcadas OCCUPIED (mismo grupo, sin ítems
   * que mover).
   *
   * Nota: es una secuencia de operaciones, no una única transacción de DB —
   * para el volumen de una fusión manual de mesero el riesgo de un fallo a
   * mitad de camino es bajo y recuperable a mano; si se vuelve un problema
   * real, envolver en `$transaction(async (tx) => ...)`.
   */
  async merge(dto: MergeTablesDto, actor: Actor) {
    const userId = actor.id;
    const [primaryTableId, ...secondaryTableIds] = dto.tableIds;
    if (!primaryTableId) throw new BadRequestException('Se necesitan al menos 2 mesas para fusionar');

    const primaryOrder = await this.tenantPrisma.client.order.findFirst({
      where: { tableId: primaryTableId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!primaryOrder) {
      throw new BadRequestException('La mesa primaria no tiene un pedido activo para fusionar');
    }
    assertPuedeUsarSucursal(actor, primaryOrder.branchId);

    // La mesa PRIMARIA tampoco puede tener una parte ya cobrada: fusionarle más
    // platos e incrementar su total dejaría ese split pagado (monto fijo) sin
    // cubrir el nuevo total, y `split` bloquea re-dividir cuando hay partes pagas
    // → esos platos quedan prácticamente incobrables (sub-cobro). addItems/
    // removeItem/split ya bloquean sobre el pedido que crece; merge lo chequeaba
    // en las secundarias pero NO en la primaria, que es justo la que crece acá.
    const primaryPaidSplits = await this.tenantPrisma.client.billSplit.count({
      where: { orderId: primaryOrder.id, paid: true },
    });
    if (primaryPaidSplits > 0) {
      throw new ConflictException(
        'La mesa primaria ya tiene parte de la cuenta pagada: no se le pueden fusionar más mesas. Cobrá el saldo por separado.',
      );
    }

    let addedSubtotal = 0;
    let addedTax = 0;
    let addedDiscount = 0;
    let addedTotal = 0;

    for (const tableId of secondaryTableIds) {
      const table = await this.tenantPrisma.client.table.findUnique({ where: { id: tableId } });
      if (!table) throw new NotFoundException(`Mesa no encontrada: ${tableId}`);
      // Todas las mesas fusionadas tienen que ser del mismo local que la
      // primaria: fusionar a traves de sucursales mezcla cajas y cocinas.
      if (table.branchId !== primaryOrder.branchId) {
        throw new BadRequestException(`La mesa ${table.code} es de otra sucursal`);
      }

      const order = await this.tenantPrisma.client.order.findFirst({
        where: { tableId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
        orderBy: { createdAt: 'desc' },
      });

      if (order) {
        // Si alguien de esa mesa ya pagó su parte, fusionar volvería a cobrar
        // esos platos en el pedido primario. `addItems`, `removeItem` y `split`
        // ya validaban esto; `merge` era el único que no.
        const paidSplits = await this.tenantPrisma.client.billSplit.count({
          where: { orderId: order.id, paid: true },
        });
        if (paidSplits > 0) {
          throw new ConflictException(
            `La mesa ${table.code} ya tiene parte de la cuenta pagada: no se puede fusionar. Cobrá el saldo por separado.`,
          );
        }

        await this.tenantPrisma.client.orderItem.updateMany({
          where: { orderId: order.id },
          data: { orderId: primaryOrder.id },
        });
        // Las comandas de cocina también se mueven al pedido primario. Sin esto
        // quedaban colgadas del pedido secundario, que se cancela abajo — y el
        // KDS filtra las tareas de pedidos cancelados, así que los platos aún no
        // cocinados de la mesa fusionada desaparecían del tablero (seguían en la
        // cuenta, pero la cocina nunca los veía).
        await this.tenantPrisma.client.kitchenTask.updateMany({
          where: { orderId: order.id },
          data: { orderId: primaryOrder.id },
        });
        // Se trasladan TODOS los componentes del pedido secundario, no sólo el
        // subtotal: si esa mesa tenía un descuento (su `total` < `subtotal`),
        // sumar sólo el subtotal al total de la primaria cobraba el descuento de
        // más (el comensal pagaba de más) y rompía el invariante
        // total = subtotal + tax − descuento. Sumando cada campo por separado, el
        // total de la primaria sube exactamente lo que esa mesa debía (su `total`).
        addedSubtotal += Number(order.subtotal);
        addedTax += Number(order.taxTotal);
        addedDiscount += Number(order.discountTotal);
        addedTotal += Number(order.total);
        // Las filas Discount se re-apuntan a la primaria (como los items y las
        // comandas): así el `discountTotal` que le sumamos queda respaldado por
        // filas reales y el descuento sigue apareciendo en el panel de control,
        // colgado del pedido vivo y no del que se cancela.
        await this.tenantPrisma.client.discount.updateMany({
          where: { orderId: order.id },
          data: { orderId: primaryOrder.id },
        });
        await this.tenantPrisma.client.order.update({
          where: { id: order.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: `Fusionado con mesa ${primaryTableId}`,
          },
        });
      }

      await this.tenantPrisma.client.table.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } });
    }

    // `increment` y NO una escritura absoluta. La version anterior recalculaba
    // subtotal/total desde los valores leidos al ENTRAR al merge: si un mozo
    // agregaba una ronda a la mesa primaria mientras el merge corria, ese
    // increment quedaba pisado — los items existian pero no se cobraban. Sumar
    // el delta preserva cualquier cambio concurrente. Se incrementa cada campo por
    // su delta (no sólo el subtotal) para no cobrar de más el descuento de las
    // secundarias y mantener total = subtotal + tax − descuento.
    await this.tenantPrisma.client.order.update({
      where: { id: primaryOrder.id },
      data: {
        subtotal: { increment: addedSubtotal },
        taxTotal: { increment: addedTax },
        discountTotal: { increment: addedDiscount },
        total: { increment: addedTotal },
      },
    });

    await this.tenantPrisma.client.tableMergeLog.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        primaryTableId,
        mergedTableIds: secondaryTableIds,
        resultOrderId: primaryOrder.id,
        userId,
      },
    });

    return this.tenantPrisma.client.order.findUnique({
      where: { id: primaryOrder.id },
      include: { items: { include: { menuItem: true } }, table: { select: TABLE_SAFE_SELECT } },
    });
  }

  async requestBill(orderId: string, actor: Actor) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id: orderId },
      include: { table: { select: { code: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    assertPuedeUsarSucursal(actor, order.branchId);
    const updated = await this.tenantPrisma.client.order.update({
      where: { id: orderId },
      data: { billRequestedAt: new Date() },
    });

    // Aviso EN VIVO a la CAJA de esa sucursal: una mesa pidió la cuenta. El
    // cajero no está mirando la lista de pendientes todo el tiempo — sin esto
    // se entera recién cuando refresca. Best-effort: nunca rompe el request.
    this.kitchenGateway.emitToCash(order.branchId, 'cash:bill-requested', {
      orderId: order.id,
      tableCode: order.table?.code ?? null,
      total: Number(order.total),
    });

    return updated;
  }

  async split(orderId: string, dto: SplitOrderDto, actor: Actor) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    assertPuedeUsarSucursal(actor, order.branchId);

    const total = Number(order.total);
    let partsData: { label: string; amount: number }[];

    if (dto.mode === BILL_SPLIT_MODE.ByPerson) {
      partsData = dto.parts.map((p) => {
        if (p.amount === undefined) {
          throw new BadRequestException(`La parte "${p.label}" necesita "amount" en modo BY_PERSON`);
        }
        return { label: p.label, amount: p.amount };
      });
    } else {
      // BY_ITEM: cada OrderItem del pedido debe terminar asignado a
      // EXACTAMENTE una parte — ni items sin asignar, ni items repetidos.
      const allItemIds = new Set(order.items.map((i) => i.id));
      const seen = new Set<string>();
      partsData = dto.parts.map((p) => {
        const itemIds = p.itemIds ?? [];
        if (itemIds.length === 0) {
          throw new BadRequestException(`La parte "${p.label}" no tiene items asignados`);
        }
        let amount = 0;
        for (const itemId of itemIds) {
          if (!allItemIds.has(itemId)) {
            throw new BadRequestException(`El item ${itemId} no pertenece a este pedido`);
          }
          if (seen.has(itemId)) {
            throw new BadRequestException(`El item ${itemId} está asignado a más de una parte`);
          }
          seen.add(itemId);
          const item = order.items.find((i) => i.id === itemId)!;
          amount += Number(item.unitPrice) * item.quantity;
        }
        return { label: p.label, amount };
      });
      if (seen.size !== allItemIds.size) {
        throw new BadRequestException('Todos los items del pedido deben quedar asignados a alguna parte');
      }

      // Las partes se arman con los precios de los ítems, o sea que suman el
      // SUBTOTAL — pero lo que se cobra es el TOTAL (subtotal + impuestos −
      // descuento + envío). Sin prorratear, cualquier pedido con un descuento o
      // con envío hacía fallar SIEMPRE la validación de abajo con "La suma de
      // las partes no coincide", y el mozo terminaba dividiendo a ojo por
      // persona (que sí puede descuadrar).
      //
      // Se reparte proporcional a lo que consumió cada uno: si la mesa tiene 20%
      // de cortesía, a cada uno le baja su parte en la misma proporción. El
      // redondeo se ajusta en la última parte para que cierre exacto.
      const itemsSubtotal = partsData.reduce((acc, p) => acc + p.amount, 0);
      if (itemsSubtotal > 0 && Math.abs(itemsSubtotal - total) > BILL_SPLIT_ROUNDING_TOLERANCE) {
        const factor = total / itemsSubtotal;
        let acumulado = 0;
        partsData = partsData.map((p, i) => {
          const esUltima = i === partsData.length - 1;
          const amount = esUltima ? redondear(total - acumulado) : redondear(p.amount * factor);
          acumulado += amount;
          return { label: p.label, amount };
        });
      }
    }

    const sum = partsData.reduce((acc, p) => acc + p.amount, 0);
    if (Math.abs(sum - total) > BILL_SPLIT_ROUNDING_TOLERANCE) {
      throw new BadRequestException(
        `La suma de las partes (${sum.toFixed(2)}) no coincide con el total del pedido (${total.toFixed(2)})`,
      );
    }

    // El ÚNICO guard anti-doble-pago del sistema es `if (split.paid) throw` en
    // PaymentsService.resolveBillSplit — y vive en la fila que este método
    // borra. Sin este chequeo, re-dividir una cuenta con partes ya cobradas
    // destruye la marca de pago y los que ya pagaron pueden pagar de nuevo:
    // pasa con solo pedir un postre después de que uno del grupo pagó.
    const paidSplits = await this.tenantPrisma.client.billSplit.findMany({
      where: { orderId, paid: true },
      select: { label: true },
    });
    if (paidSplits.length > 0) {
      throw new ConflictException(
        `No se puede volver a dividir: ya se cobraron ${paidSplits.length} parte(s) (${paidSplits
          .map((s) => s.label)
          .join(', ')}). Anulá esos pagos antes de recalcular.`,
      );
    }

    // Reemplaza el split previo — solo se llega acá si NINGUNA parte está paga.
    // Transacción: sin esto, un error entre el delete y el create deja el
    // pedido sin ninguna división y sin forma de cobrarlo.
    await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.billSplit.deleteMany({ where: { orderId } }),
      this.tenantPrisma.client.billSplit.createMany({
        data: partsData.map((p) => ({
          tenantId: this.tenantPrisma.tenantId,
          orderId,
          mode: dto.mode,
          label: p.label,
          amount: p.amount,
        })),
      }),
    ]);

    return this.tenantPrisma.client.billSplit.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }
}

/** Redondeo a centavos, para que el prorrateo de la cuenta no deje colas. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
