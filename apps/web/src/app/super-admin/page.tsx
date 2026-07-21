import { redirect } from 'next/navigation';

/**
 * `/super-admin` no tiene pantalla propia — la portada del panel es el listado
 * de tenants. Redirige en el server para que la URL quede canónica en
 * `/super-admin/tenants` (el middleware ya manda acá a un SUPER_ADMIN que
 * entra a `/`).
 */
export default function SuperAdminIndexPage() {
  redirect('/super-admin/tenants');
}
