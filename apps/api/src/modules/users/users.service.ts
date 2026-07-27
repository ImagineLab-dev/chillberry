import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { USER_ROLE, type UserRole } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { BillingService } from '../billing/billing.service';
import { CreateUserDto } from './dto/create-user.dto';
import { MailAdapter } from '../integrations/mail/mail.adapter';
import { mailDeInvitacion } from '../integrations/mail/mail.templates';
import { loadEnv } from '../../config/env';
import { UpdateUserDto } from './dto/update-user.dto';

const SAFE_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  active: true,
  // La sucursal se devuelve para que la pantalla de equipo muestre dónde
  // trabaja cada uno; sin esto el dueño no ve a quién le falta asignar.
  branchId: true,
  createdAt: true,
} as const;

/** Igual que SAFE_SELECT pero incluye el token para derivar `invitePending`. Se
 *  usa internamente; el token NUNCA sale en la respuesta (ver `conInvitePending`). */
const SELECT_CON_INVITE = { ...SAFE_SELECT, invitationToken: true } as const;

/** Vida útil de una invitación. Un link de mail que sirve para siempre es una
 *  credencial eterna dando vueltas por buzones y forwards; vencida, el dueño
 *  la reenvía desde Equipo (rota el token). */
const INVITACION_DIAS = 7;

/** Reemplaza el token por un booleano: el front sabe que hay invitación pendiente
 *  sin recibir el token (que es una credencial). */
function conInvitePending<T extends { invitationToken?: string | null }>(u: T) {
  const { invitationToken, ...resto } = u;
  return { ...resto, invitePending: invitationToken != null };
}

function vencimientoDeInvitacion(): Date {
  return new Date(Date.now() + INVITACION_DIAS * 24 * 60 * 60 * 1000);
}

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
    private readonly mail: MailAdapter,
  ) {}

  async create(dto: CreateUserDto) {
    // Mismo patrón que BranchesService.create: el límite del plan se valida
    // acá, no en el controller. `maxUsers` estaba definido en los planes y no
    // se chequeaba en ningún lado — el límite era decorativo.
    await this.billing.assertCanCreateUser();

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    await this.validarSucursal(dto.branchId);

    // Con contraseña: la cuenta queda lista y el empleado entra ya.
    // Sin contraseña: se manda una invitación por mail para que él la fije. La
    // cuenta se crea igual, con un passwordHash aleatorio inservible y un token;
    // no puede entrar hasta aceptar. Así el dueño no tiene que manejar la clave
    // de otro (y no queda una clave débil elegida a las apuradas).
    const invita = !dto.password;
    const passwordHash = await argon2.hash(dto.password ?? randomBytes(24).toString('hex'));
    const invitationToken = invita ? randomBytes(24).toString('hex') : null;

    const creado = await this.tenantPrisma.client.user.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: dto.role,
        phone: dto.phone,
        branchId: dto.branchId ?? null,
        invitationToken,
        invitationExpiresAt: invita ? vencimientoDeInvitacion() : null,
      },
      select: SELECT_CON_INVITE,
    });

    if (invita && invitationToken) {
      await this.enviarMailInvitacion(dto.email.toLowerCase(), dto.name, invitationToken);
    }

    // Un usuario DRIVER sin perfil de Driver es una cuenta rota: /driver da 404
    // en todo, no aparece para asignarle entregas, y el delivery queda PENDING
    // para siempre. Pasó en el primer uso real (22/07/2026): el dueño creó al
    // repartidor desde Equipo y "no me aparece ningún repartidor".
    if (dto.role === USER_ROLE.Driver) {
      await this.asegurarPerfilDriver(creado.id, dto.phone ?? null);
    }

    return conInvitePending(creado);
  }

  /**
   * Crea el perfil de Driver si no existe. Con defaults deliberadamente laxos
   * (moto, sin chapa): el objetivo es que la cuenta FUNCIONE ya — el repartidor
   * completa sus datos después desde su pantalla, y arranca OFFLINE hasta que
   * él mismo se ponga disponible.
   */
  private async asegurarPerfilDriver(userId: string, phone: string | null): Promise<void> {
    const existe = await this.tenantPrisma.client.driver.findFirst({ where: { userId } });
    if (existe) return;
    await this.tenantPrisma.client.driver.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        userId,
        phone: phone ?? '',
        vehicleType: 'MOTORCYCLE',
      },
    });
  }

  /**
   * Reenvía la invitación de una cuenta que todavía no la aceptó: rota el
   * token (el link viejo muere) y extiende el vencimiento. Para "no me llegó
   * el mail" y para invitaciones vencidas.
   */
  async resendInvite(id: string) {
    const target = await this.tenantPrisma.client.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (!target.invitationToken) {
      throw new ConflictException('Esta cuenta ya está activa — no tiene invitación pendiente');
    }

    const invitationToken = randomBytes(24).toString('hex');
    const actualizado = await this.tenantPrisma.client.user.update({
      where: { id },
      data: { invitationToken, invitationExpiresAt: vencimientoDeInvitacion() },
      select: SELECT_CON_INVITE,
    });

    await this.enviarMailInvitacion(target.email, target.name, invitationToken);
    return conInvitePending(actualizado);
  }

  /** El mail con el link. Best-effort: si no sale, la cuenta queda creada con
   *  su invitación pendiente y el dueño puede reenviarla; igual se loguea. */
  private async enviarMailInvitacion(email: string, nombre: string, token: string): Promise<void> {
    const tenant = await this.tenantPrisma.client.tenant.findFirst({
      where: { id: this.tenantPrisma.tenantId },
      select: { name: true },
    });
    const { html, text } = mailDeInvitacion({
      restaurante: tenant?.name ?? 'tu restaurante',
      nombre,
      link: `${loadEnv().WEB_ORIGIN.split(',')[0]}/invitacion/${token}`,
    });
    await this.mail
      .send({ to: email, subject: `Te sumaron al equipo en Chillberry`, text, html })
      .catch(() => {});
  }

  async list() {
    const usuarios = await this.tenantPrisma.client.user.findMany({
      select: SELECT_CON_INVITE,
      orderBy: { createdAt: 'asc' },
    });
    return usuarios.map(conInvitePending);
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

    // Mover de sucursal: se valida que sea de este restaurante. `null` explícito
    // la quita (el empleado pasa a ver todos los locales), por eso se compara
    // contra `undefined` y no por truthy.
    if (dto.branchId !== undefined) await this.validarSucursal(dto.branchId);

    // Reactivar un usuario (inactivo -> activo) es, a efectos del plan, un ALTA
    // de usuario activo: tiene que pasar por el MISMO límite que crear uno. Sin
    // esto, un tenant en el tope evadía el paywall dando de baja a uno y
    // reactivando otro (o reactivando al que había desactivado). Solo se chequea
    // en la TRANSICIÓN (target inactivo): re-guardar un usuario ya activo con
    // `active:true` es un no-op y no debe contar de más.
    if (dto.active === true && !target.active) {
      await this.billing.assertCanCreateUser();
    }

    // La contraseña (reset por owner/admin) no es un campo de User: se hashea y
    // se escribe como `passwordHash`. El resto del dto va tal cual.
    //
    // Al fijar una contraseña se ANULA cualquier invitación pendiente
    // (`invitationToken: null`). Sin esto, el link del mail de invitación —que
    // no vence solo— seguía vivo para siempre: cualquiera que lo consiguiera
    // podía pisar la clave recién puesta con `accept-invite` y quedarse con la
    // cuenta. Fijar la clave a mano ES la otra forma de completar el alta, así
    // que la invitación deja de tener sentido en el mismo acto.
    const { password, ...rest } = dto;
    const passwordHash = password ? await argon2.hash(password) : undefined;
    const updated = await this.tenantPrisma.client.user.update({
      where: { id },
      data: { ...rest, ...(passwordHash ? { passwordHash, invitationToken: null, invitationExpiresAt: null } : {}) },
      select: SAFE_SELECT,
    });
    // Cambio de rol A repartidor: mismo criterio que en el alta — sin perfil
    // de Driver la cuenta queda rota (404 en toda su pantalla).
    if (dto.role === USER_ROLE.Driver) {
      await this.asegurarPerfilDriver(id, updated.phone ?? null);
    }

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
  /**
   * La sucursal tiene que existir y ser de ESTE restaurante.
   *
   * Se resuelve con el cliente tenant-scoped: si el id es de otro tenant,
   * simplemente no aparece y se rechaza. Sin esto, un dueño podría atar a su
   * empleado a la sucursal de otro restaurante — y ese empleado pasaría todos
   * los controles de sucursal contra datos ajenos.
   */
  private async validarSucursal(branchId?: string | null): Promise<void> {
    if (!branchId) return;
    const branch = await this.tenantPrisma.client.branch.findFirst({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
  }

}
