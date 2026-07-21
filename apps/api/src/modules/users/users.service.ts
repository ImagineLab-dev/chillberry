import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { USER_ROLE, type UserRole } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { BillingService } from '../billing/billing.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SAFE_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  active: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    // Chequeo de unicidad de email: es GLOBAL, no por tenant — hay que
    // consultarlo con el cliente crudo (sin scope), porque el cliente
    // tenant-scoped filtraría por tenantId y dejaría pasar un duplicado
    // que pertenece a otro tenant (fallaría feo contra el constraint de DB).
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly billing: BillingService,
  ) {}

  async create(dto: CreateUserDto) {
    // Mismo patrón que BranchesService.create: el límite del plan se valida
    // acá, no en el controller. `maxUsers` estaba definido en los planes y no
    // se chequeaba en ningún lado — el límite era decorativo.
    await this.billing.assertCanCreateUser();

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    const passwordHash = await argon2.hash(dto.password);
    return this.tenantPrisma.client.user.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: dto.role,
        phone: dto.phone,
      },
      select: SAFE_SELECT,
    });
  }

  list() {
    return this.tenantPrisma.client.user.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Solo un OWNER puede cambiar roles (evita que un ADMIN se auto-promueva
   * o promueva a otro a OWNER) o desactivar a otro OWNER, y nadie puede
   * desactivarse a sí mismo (evita quedar sin ningún usuario activo que
   * pueda revertirlo).
   */
  async update(id: string, dto: UpdateUserDto, actingUser: { id: string; role: UserRole }) {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Usuario no encontrado');

    if (dto.role && actingUser.role !== USER_ROLE.Owner) {
      throw new ForbiddenException('Solo el propietario puede cambiar roles');
    }
    // Defensa en profundidad contra escalada de privilegios (además del @IsIn
    // del DTO): SUPER_ADMIN nunca se asigna por esta vía, y no se puede crear un
    // segundo OWNER promoviendo a otro usuario.
    if (dto.role === USER_ROLE.SuperAdmin) {
      throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN');
    }
    if (dto.role === USER_ROLE.Owner && target.role !== USER_ROLE.Owner) {
      throw new ForbiddenException('No se puede promover a otro usuario a propietario');
    }
    if (target.role === USER_ROLE.Owner && actingUser.role !== USER_ROLE.Owner) {
      throw new ForbiddenException('Solo el propietario puede modificar a otro propietario');
    }
    if (id === actingUser.id && dto.active === false) {
      throw new ForbiddenException('No podés desactivar tu propia cuenta');
    }

    // La contraseña (reset por owner/admin) no es un campo de User: se hashea y
    // se escribe como `passwordHash`. El resto del dto va tal cual.
    const { password, ...rest } = dto;
    const passwordHash = password ? await argon2.hash(password) : undefined;
    const updated = await this.tenantPrisma.client.user.update({
      where: { id },
      data: { ...rest, ...(passwordHash ? { passwordHash } : {}) },
      select: SAFE_SELECT,
    });
    // Revocar las sesiones activas. Dos motivos distintos:
    //  - cambio de contraseña: obligamos a re-login con la clave nueva (si no,
    //    un token robado seguiría vivo tras el reset);
    //  - baja de la cuenta (`active:false`), que es LA vía para echar a alguien:
    //    sin esto la sesión abierta seguía funcionando y el ex-empleado
    //    conservaba todos los permisos de su rol.
    if (password || dto.active === false) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    }
    return updated;
  }

  /**
   * Borrado DURO de una cuenta — solo si NO dejó ningún rastro. Los ids de
   * usuario viven en columnas sueltas sin FK (auditoría: quién creó el pedido,
   * tomó la comanda, abrió la caja, aplicó el descuento…), así que Postgres no
   * frena el borrado: lo frenamos acá contando esas referencias. Si hay alguna,
   * 409 → hay que desactivar, no borrar (perderíamos la trazabilidad). El caso
   * de uso real es limpiar cuentas de prueba que nunca operaron.
   */
  async remove(id: string, actingUser: { id: string; role: UserRole }) {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (id === actingUser.id) throw new ForbiddenException('No podés eliminar tu propia cuenta');
    if (target.role === USER_ROLE.Owner) {
      throw new ForbiddenException('No se puede eliminar la cuenta del propietario; desactivala si hace falta');
    }

    const c = this.tenantPrisma.client;
    const driver = await c.driver.findFirst({ where: { userId: id } });
    const [orders, tasks, reservations, transfers, merges, cashMoves, cashSessions, discounts, deliveries] =
      await Promise.all([
        // El pedido guarda quién lo atendió (`waiterId`) y quién lo anuló
        // (`cancelledById`) — cualquiera de los dos es historial del usuario.
        c.order.count({ where: { OR: [{ waiterId: id }, { cancelledById: id }] } }),
        c.kitchenTask.count({ where: { takenById: id } }),
        c.reservation.count({ where: { createdById: id } }),
        c.tableTransferLog.count({ where: { userId: id } }),
        c.tableMergeLog.count({ where: { userId: id } }),
        c.cashMovement.count({ where: { createdById: id } }),
        c.cashRegisterSession.count({ where: { cashierId: id } }),
        c.discount.count({ where: { appliedById: id } }),
        driver ? c.delivery.count({ where: { driverId: driver.id } }) : Promise.resolve(0),
      ]);
    const total = orders + tasks + reservations + transfers + merges + cashMoves + cashSessions + discounts + deliveries;
    if (total > 0) {
      throw new ConflictException(
        'Este usuario tiene historial (pedidos, cobros, entregas o auditoría) y no se puede eliminar. Desactivalo en su lugar.',
      );
    }

    // Sin historial: el borrado arrastra en cascada refresh tokens y, si era
    // repartidor, su perfil/documentos/ubicaciones (onDelete: Cascade en schema).
    // `deleteMany` (no `delete`) porque el client tenant-scoped inyecta tenantId
    // en el where y `delete` exige un unique declarado — mismo patrón que closures.
    const result = await c.user.deleteMany({ where: { id } });
    if (result.count === 0) throw new NotFoundException('Usuario no encontrado');
    return { ok: true };
  }
}
