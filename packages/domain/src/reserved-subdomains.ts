/**
 * Subdominios que NO puede reclamar un tenant ni resolver como storefront:
 * chocan con la app, el correo o la infra. Compartido entre el chequeo de
 * escritura (tenant-settings) y el de resolución (getStoreBySubdomain), para
 * que un nombre reservado no entre por ninguno de los dos caminos.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'super-admin', 'superadmin', 'dashboard',
  'mail', 'smtp', 'ftp', 'ns', 'ns1', 'ns2', 'cdn', 'assets', 'static',
  'chillberry', 'system', 'smartia', 'status', 'help', 'support', 'blog',
]);

export function isReservedSubdomain(value: string): boolean {
  return RESERVED_SUBDOMAINS.has(value.trim().toLowerCase());
}
