'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sub-navegación de "Análisis". Reportes y Control (auditoría anti-robo) viven
 * acá adentro como pestañas — son consulta periódica, no operación diaria.
 * Mismo patrón que Configuración y Clientes.
 */
const TABS = [
  { href: '/admin/reports', label: 'Reportes' },
  { href: '/admin/control', label: 'Control' },
];

export function AnalyticsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Secciones de análisis">
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
