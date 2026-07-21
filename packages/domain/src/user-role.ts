/**
 * Roles de usuario dentro de un tenant. `SUPER_ADMIN` es staff interno de
 * Chillberry (soporte/operación del SaaS) — no pertenece a ningún tenant.
 */
export const USER_ROLE = {
  SuperAdmin: 'SUPER_ADMIN',
  Owner: 'OWNER',
  Admin: 'ADMIN',
  Waiter: 'WAITER',
  Kitchen: 'KITCHEN',
  Cashier: 'CASHIER',
  Driver: 'DRIVER',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];
