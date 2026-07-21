/**
 * Slug del tenant "sistema" al que pertenecen los usuarios SUPER_ADMIN.
 *
 * `User.tenantId` es NOT NULL y toda la cadena de auth asume que un JWT
 * SIEMPRE trae un tenantId (`jwt.strategy.ts` tira 401 si falta). En vez de
 * aflojar eso — que es la garantía sobre la que está construido el aislamiento
 * multi-tenant — el super admin vive en un tenant propio y vacío.
 *
 * Consecuencia buscada: si por un bug el tenantId de un super admin se filtra
 * a un camino tenant-scoped, scopea a ESTE tenant, que no tiene ni
 * restaurantes ni pedidos ni usuarios de nadie. Falla cerrado (no ve nada),
 * nunca abierto (ver datos de otro).
 *
 * Se excluye de listados y métricas: es infraestructura de Smartia, no un
 * cliente del SaaS.
 */
export const SYSTEM_TENANT_SLUG = 'smartia-system';

/** Acciones auditables. Guardadas como texto en `SuperAdminAuditLog.action`. */
export const SUPER_ADMIN_AUDIT_ACTION = {
  ChangePlan: 'CHANGE_PLAN',
  SuspendSubscription: 'SUSPEND_SUBSCRIPTION',
  ReactivateSubscription: 'REACTIVATE_SUBSCRIPTION',
} as const;

export type SuperAdminAuditAction =
  (typeof SUPER_ADMIN_AUDIT_ACTION)[keyof typeof SUPER_ADMIN_AUDIT_ACTION];

/** Paginación de `/super-admin/tenants` y `/super-admin/audit`. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Cuántos meses de altas devuelve `/super-admin/metrics`. */
export const SIGNUP_MONTHS = 6;

/** Cuántas facturas/pedidos recientes trae el detalle de un tenant. */
export const RECENT_INVOICES_LIMIT = 10;
