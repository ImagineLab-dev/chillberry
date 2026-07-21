'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sub-navegación de "Clientes". Marketing y Opiniones viven acá adentro como
 * pestañas en vez de ocupar su propio lugar en el sidebar — son parte de la
 * relación con el cliente y de baja frecuencia. Mismo patrón que Configuración.
 */
const TABS = [
  { href: '/admin/customers', label: 'Clientes' },
  { href: '/admin/marketing', label: 'Marketing' },
  { href: '/admin/coupons', label: 'Cupones' },
  { href: '/admin/feedback', label: 'Opiniones' },
];

export function CustomersTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Secciones de clientes">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
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
