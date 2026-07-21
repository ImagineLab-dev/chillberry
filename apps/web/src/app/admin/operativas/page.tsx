import { redirect } from 'next/navigation';

/**
 * "Operativas" se disolvió en la reorganización del sidebar: las terminales
 * (Caja/Cocina/Mesero) se abren desde el botón "Abrir terminal", e Inventario y
 * Diseño de carta pasaron a tener su propia entrada en la sección Catálogo.
 * Se deja este redirect para no romper links/bookmarks viejos.
 */
export default function OperativasPage() {
  redirect('/admin/dashboard');
}
