'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  BarChart3,
  Bike,
  Boxes,
  CalendarClock,
  ChefHat,
  ChevronDown,
  Contact,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  QrCode,
  ReceiptText,
  Settings,
  Truck,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { logout } from '@/lib/auth';
import { BerryIcon } from '@/components/berry-icon';
import { CommandPalette } from '@/components/command-palette';
import { ThemeToggle } from '@/components/theme-toggle';

// Ítems del sidebar que son "hubs" con pestañas adentro (ver *-tabs.tsx): el
// ítem queda activo cuando estás en cualquiera de sus rutas hijas. La clave es
// el `href` del ítem del sidebar; el valor, sus rutas hijas.
const GROUPED_ACTIVE: Record<string, string[]> = {
  // Configuración → General / Restaurantes / Equipo / Facturación
  '/admin/settings': ['/admin/settings', '/admin/restaurants', '/admin/staff', '/admin/billing'],
  // Clientes → Clientes / Marketing / Cupones / Opiniones
  '/admin/customers': ['/admin/customers', '/admin/marketing', '/admin/coupons', '/admin/feedback'],
  // Análisis → Reportes / Control
  '/admin/reports': ['/admin/reports', '/admin/control'],
};

type NavItem = { href: string; label: string; icon: LucideIcon };

// El sidebar es SÓLO gestión, agrupado en secciones con encabezado para que
// sea escaneable. Las herramientas full-screen (Caja/Cocina/Mesero) NO viven
// acá — se abren desde el botón "Abrir terminal" (ver TerminalMenu).
const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'Ventas',
    items: [
      { href: '/admin/orders', label: 'Pedidos', icon: ReceiptText },
      { href: '/admin/tables', label: 'Mesas', icon: QrCode },
      { href: '/admin/reservations', label: 'Reservas', icon: CalendarClock },
      { href: '/admin/delivery', label: 'Delivery', icon: Bike },
    ],
  },
  {
    title: 'Catálogo',
    items: [
      { href: '/admin/menu', label: 'Menú', icon: UtensilsCrossed },
      { href: '/admin/carta-design', label: 'Diseño de carta', icon: Palette },
      { href: '/admin/inventory', label: 'Inventario', icon: Boxes },
      { href: '/admin/purchasing', label: 'Compras', icon: Truck },
    ],
  },
  // Clientes va suelto (sin encabezado). Adentro tiene pestañas: Clientes /
  // Marketing / Opiniones (ver customers-tabs.tsx).
  { items: [{ href: '/admin/customers', label: 'Clientes', icon: Contact }] },
  // Análisis va suelto. Adentro: Reportes / Control (ver analytics-tabs.tsx).
  { items: [{ href: '/admin/reports', label: 'Análisis', icon: BarChart3 }] },
  // Configuración va suelto abajo (sin encabezado). Adentro tiene pestañas:
  // General / Restaurantes / Equipo / Facturación (ver settings-tabs.tsx).
  { items: [{ href: '/admin/settings', label: 'Configuración', icon: Settings }] },
];

// Terminales full-screen: apps de rol que el dueño/admin abre para operar o
// supervisar. Cambian de contexto (salen del panel), por eso van aparte con
// un ícono ↗. `/driver` queda fuera a propósito (es DRIVER-only).
const TERMINALS: NavItem[] = [
  { href: '/pos', label: 'Caja', icon: Wallet },
  { href: '/kitchen', label: 'Cocina', icon: ChefHat },
  { href: '/waiter', label: 'Mesero', icon: Users },
];

/** Botón desplegable "Abrir terminal". Cierra con click-afuera y Escape. */
function TerminalMenu({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-ghost min-h-[44px] w-full justify-between md:min-h-0"
      >
        <span className="flex items-center gap-2">
          <ExternalLink className="h-4 w-4 shrink-0" />
          Abrir terminal
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {TERMINALS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex min-h-[44px] items-center gap-2.5 rounded px-3 py-2 text-base text-foreground transition-colors hover:bg-muted md:min-h-0 md:text-sm"
            >
              <t.icon className="h-5 w-5 shrink-0 text-muted-foreground md:h-4 md:w-4" />
              <span className="flex-1">{t.label}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Contenido del sidebar. Se monta dos veces: en el <aside> fijo de escritorio
 * (visible desde `md`) y dentro del drawer de móvil (visible sólo bajo `md`).
 * Como cada instancia vive de un solo lado del breakpoint, las clases `md:` de
 * acá ajustan únicamente la variante de escritorio: en el drawer los ítems van
 * a 44px y 16px porque se tocan con el dedo, en escritorio vuelven a 36px/14px.
 */
function SidebarBody({
  pathname,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  /** Cierra el drawer al tocar un ítem. En escritorio no se pasa. */
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <BerryIcon className="h-7 w-7 shrink-0" />
        <span className="font-heading text-lg font-semibold tracking-tight">Chillberry</span>
      </div>

      {/* Abrir una herramienta full-screen (Caja/Cocina/Mesero) — arriba, aparte
          de la navegación de gestión. */}
      <div className="mb-3">
        <TerminalMenu onNavigate={onNavigate} />
      </div>

      {/* Denso en escritorio (md:) para que las 6 secciones entren sin scroll;
          en el drawer móvil los ítems quedan a 44px (táctil) y el drawer scrollea. */}
      <nav className="flex-1 space-y-3 md:space-y-1.5">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title ?? `group-${gi}`} role="group" aria-label={group.title}>
            {group.title && (
              <p className="mb-0.5 px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60 md:pt-0.5">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const childRoutes = GROUPED_ACTIVE[item.href];
                const isActive = childRoutes
                  ? childRoutes.some((r) => pathname.startsWith(r))
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-h-[44px] items-center gap-2.5 rounded-md px-3 py-2 font-heading text-base transition-colors md:min-h-0 md:py-1.5 md:text-sm ${
                      isActive
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <item.icon className="h-5 w-5 shrink-0 md:h-[18px] md:w-[18px]" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4 space-y-2 border-t border-border pt-4 md:mt-3 md:pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Buscar
            <kbd className="ml-1.5 rounded border border-border px-1 py-0.5 text-[10px]">Ctrl K</kbd>
          </span>
          <ThemeToggle />
        </div>
        <button onClick={onLogout} className="btn btn-ghost min-h-[44px] w-full justify-start md:min-h-0">
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  // Al navegar, el drawer se cierra: si no, queda tapando la página a la que
  // fuiste. Los ítems además cierran en su onClick, porque tocar el ítem de la
  // página en la que ya estás no cambia el pathname y no dispararía este efecto.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground md:flex-row">
      {/* Barra superior de móvil. Los márgenes negativos la sangran hasta los
          bordes para que al quedar pegada arriba no se vea contenido pasando
          por el hueco del padding del contenedor. */}
      <header className="sticky top-0 z-30 -mx-4 -mt-4 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir menú de navegación"
          aria-expanded={drawerOpen}
          className="btn btn-ghost btn-icon h-11 w-11"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BerryIcon className="h-6 w-6 shrink-0" />
        <span className="font-heading text-base font-semibold tracking-tight">Chillberry</span>
      </header>

      {/* Sidebar de escritorio — sticky, sin cambios respecto del original más
          allá de ocultarse bajo `md`. */}
      <aside className="panel sticky top-4 hidden h-[calc(100vh-2rem)] w-56 shrink-0 flex-col overflow-y-auto p-4 md:flex">
        <SidebarBody pathname={pathname} onLogout={onLogout} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 animate-fade-in md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            role="presentation"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="panel absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto rounded-l-none p-4"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Cerrar menú de navegación"
              className="btn btn-ghost btn-icon absolute right-2 top-2 h-11 w-11"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarBody
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
              onLogout={onLogout}
            />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 p-2">{children}</main>

      <CommandPalette />
    </div>
  );
}
