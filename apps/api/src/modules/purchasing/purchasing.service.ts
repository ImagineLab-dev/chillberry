import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

/**
 * Compras: proveedores y órdenes de compra. El valor central es la RECEPCIÓN:
 * al recibir una OC, cada renglón suma al stock del insumo (con su fila en el
 * libro mayor, tipo PURCHASE) y actualiza el costo unitario del insumo — así el
 * inventario y el costeo quedan al día sin cargar cada movimiento a mano.
 */
@Injectable()
export class PurchasingService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  // ------------------------------------------------------------ proveedores

  listSuppliers() {
    return this.tenantPrisma.client.supplier.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  createSupplier(dto: CreateSupplierDto) {
    return this.tenantPrisma.client.supplier.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        name: dto.name.trim(),
        contactName: dto.contactName?.trim() || null,
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    await this.getSupplierOrThrow(id);
    return this.tenantPrisma.client.supplier.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName?.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active != null ? { active: dto.active } : {}),
      },
    });
  }

  // ---------------------------------------------------------- órdenes de compra

  listPurchaseOrders(branchId?: string, status?: string) {
    return this.tenantPrisma.client.purchaseOrder.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(status ? { status: status as never } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { select: { id: true, quantity: true, unitCost: true, ingredient: { select: { name: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getPurchaseOrder(id: string) {
    const po = await this.tenantPrisma.client.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } },
      },
    });
    if (!po) throw new NotFoundException('Orden de compra no encontrada');
    return po;
  }

  /**
   * Crea una OC con sus renglones. Valida que proveedor, sucursal e insumos
   * pertenezcan al tenant (y que cada insumo sea de esa sucursal). El total se
   * precomputa server-side (Σ cantidad × costo unitario).
   */
  async createPurchaseOrder(dto: CreatePurchaseOrderDto, userId: string) {
    const branch = await this.tenantPrisma.client.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    await this.getSupplierOrThrow(dto.supplierId);

    // Todos los insumos deben ser de esta sucursal — sino, recibir la OC subiría
    // stock de un insumo de otra sucursal.
    const ingredientIds = [...new Set(dto.items.map((i) => i.ingredientId))];
    const ingredients = await this.tenantPrisma.client.ingredient.findMany({
      where: { id: { in: ingredientIds }, branchId: dto.branchId },
      select: { id: true },
    });
    if (ingredients.length !== ingredientIds.length) {
      throw new BadRequestException('Algún insumo no pertenece a esta sucursal');
    }

    const total = dto.items.reduce((s, it) => s + it.quantity * it.unitCost, 0);

    return this.tenantPrisma.client.purchaseOrder.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        supplierId: dto.supplierId,
        status: dto.markOrdered ? 'ORDERED' : 'DRAFT',
        notes: dto.notes?.trim() || null,
        total: Math.round(total * 100) / 100,
        createdById: userId,
        items: {
          create: dto.items.map((it) => ({
            tenantId: this.tenantPrisma.tenantId,
            ingredientId: it.ingredientId,
            quantity: it.quantity,
            unitCost: it.unitCost,
          })),
        },
      },
      include: { items: true },
    });
  }

  /** DRAFT → ORDERED, o cancelar (DRAFT/ORDERED → CANCELLED). No sobre RECEIVED. */
  async setStatus(id: string, next: 'ORDERED' | 'CANCELLED') {
    const po = await this.getPurchaseOrder(id);
    if (po.status === 'RECEIVED') {
      throw new ConflictException('La orden ya fue recibida — no se puede cambiar su estado');
    }
    if (po.status === 'CANCELLED') {
      throw new ConflictException('La orden está cancelada');
    }
    return this.tenantPrisma.client.purchaseOrder.update({ where: { id }, data: { status: next } });
  }

  /**
   * RECIBIR: suma cada renglón al stock del insumo, deja la fila PURCHASE en el
   * libro mayor y actualiza el costo unitario del insumo al de la compra. Todo
   * en una transacción; sólo una vez (RECEIVED es terminal).
   */
  async receive(id: string, userId: string) {
    const po = await this.getPurchaseOrder(id);
    if (po.status === 'RECEIVED') throw new ConflictException('La orden ya fue recibida');
    if (po.status === 'CANCELLED') throw new ConflictException('La orden está cancelada — no se puede recibir');
    if (po.items.length === 0) throw new BadRequestException('La orden no tiene renglones');

    await this.tenantPrisma.client.$transaction(async (tx) => {
      // El cambio de estado va PRIMERO y con guarda en la misma sentencia. La
      // transacción era atómica pero NO idempotente: el chequeo de arriba lee y
      // el update escribía por `id` sin condición, así que un doble click (o dos
      // encargados confirmando la misma OC) ejecutaba las dos y el stock se
      // sumaba DOS VECES, con dos movimientos PURCHASE y el costeo inflado.
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: { notIn: ['RECEIVED', 'CANCELLED'] } },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException('La orden ya fue recibida o cancelada');
      }

      for (const item of po.items) {
        await tx.ingredient.update({
          where: { id: item.ingredientId },
          data: {
            stockQty: { increment: item.quantity },
            // El costo del insumo se actualiza al de la última compra.
            costPerUnit: item.unitCost,
          },
        });
        await tx.stockMovement.create({
          data: {
            tenantId: this.tenantPrisma.tenantId,
            ingredientId: item.ingredientId,
            type: 'PURCHASE',
            quantityDelta: item.quantity,
            reason: `OC ${po.id.slice(0, 8)} — ${po.supplier.name}`,
            userId,
          },
        });
      }
    });
    return this.getPurchaseOrder(id);
  }

  // ----------------------------------------------------------------- helpers

  private async getSupplierOrThrow(id: string) {
    const s = await this.tenantPrisma.client.supplier.findFirst({ where: { id } });
    if (!s) throw new NotFoundException('Proveedor no encontrado');
    return s;
  }
}
