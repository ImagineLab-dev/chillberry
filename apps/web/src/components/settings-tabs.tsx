'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sub-navegación de Configuración. "Facturación" y "Equipo" viven acá adentro
 * como pestañas en vez de ocupar su propio lugar en el sidebar — el mismo
 * patrón que usa cualquier SaaS (Configuración → General / Equipo / Facturación).
 */
const TABS = [
  { href: '/admin/settings', label: 'General' },
  { href: '/admin/restaurants', label: 'Restaurantes' },
  { href: '/admin/staff', label: 'Equipo' },
  { href: '/admin/billing', label: 'Facturación' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Secciones de configuración">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            // El borde inferior es el que marca la pestaña activa; el -mb-px la
            // pisa sobre el borde del contenedor para que se vea continua.
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
