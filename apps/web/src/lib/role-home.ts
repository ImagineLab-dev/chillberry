/**
 * La "casa" de cada rol tras autenticarse. FUENTE ÚNICA: la importan el
 * middleware (redirecciones de ruta), el login y la aceptación de invitación.
 * Antes vivía copiada en los tres — ya era un drift esperando a pasar.
 * Es un objeto plano sin dependencias: seguro para el runtime Edge.
 */
export const ROLE_HOME: Record<string, string> = {
  // Staff interno de Chillberry: su casa es el panel del SaaS, no el de un
  // restaurante. `/super-admin` redirige a `/super-admin/tenants`.
  SUPER_ADMIN: '/super-admin/tenants',
  OWNER: '/admin/dashboard',
  ADMIN: '/admin/dashboard',
  KITCHEN: '/kitchen',
  WAITER: '/waiter',
  CASHIER: '/pos',
  DRIVER: '/driver',
};
