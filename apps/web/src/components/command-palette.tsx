'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Bike,
  Boxes,
  CalendarClock,
  ChefHat,
  Contact,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Moon,
  Palette,
  QrCode,
  ReceiptText,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Sun,
  Truck,
  UsersRound,
  UtensilsCrossed,
  Search,
} from 'lucide-react';
import { logout } from '@/lib/auth';
import { useTheme } from './theme-provider';

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void | Promise<void>;
};

/** Coincidencia por subsecuencia — "adus" encuentra "Admin · Usuarios". */
function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (const char of h) {
    if (char === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

export function CommandPalette() {
  const router = useRouter();
  const { toggleTheme, theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      setOpen(false);
    };
    // Mismo orden que las secciones del sidebar, para que buscar y navegar
    // sean coherentes: Ventas → Catálogo → Clientes → Análisis → Negocio →
    // Terminales.
    return [
      { id: 'dashboard', label: 'Dashboard', hint: 'Resumen de hoy', icon: LayoutDashboard, run: go('/admin/dashboard') },
      // Ventas
      { id: 'orders', label: 'Pedidos', icon: ReceiptText, run: go('/admin/orders') },
      { id: 'tables', label: 'Mesas', hint: 'Códigos QR', icon: QrCode, run: go('/admin/tables') },
      { id: 'reservations', label: 'Reservas', hint: 'Agenda del salón', icon: CalendarClock, run: go('/admin/reservations') },
      { id: 'delivery', label: 'Delivery', hint: 'Despacho de envíos', icon: Bike, run: go('/admin/delivery') },
      // Catálogo
      { id: 'menu', label: 'Menú', hint: 'Productos, extras y combos', icon: UtensilsCrossed, run: go('/admin/menu') },
      { id: 'carta-design', label: 'Diseño de carta', hint: 'Aspecto de la carta pública', icon: Palette, run: go('/admin/carta-design') },
      { id: 'inventory', label: 'Inventario', hint: 'Insumos y recetas', icon: Boxes, run: go('/admin/inventory') },
      { id: 'purchasing', label: 'Compras', hint: 'Proveedores y órdenes de compra', icon: Truck, run: go('/admin/purchasing') },
      // Clientes
      { id: 'customers', label: 'Clientes', hint: 'Habitués', icon: Contact, run: go('/admin/customers') },
      { id: 'marketing', label: 'Marketing', hint: 'Segmentos y campañas', icon: Megaphone, run: go('/admin/marketing') },
      { id: 'feedback', label: 'Opiniones', hint: 'Calificación de clientes', icon: Star, run: go('/admin/feedback') },
      // Análisis
      { id: 'reports', label: 'Reportes', hint: 'Ventas', icon: BarChart3, run: go('/admin/reports') },
      { id: 'control', label: 'Control', hint: 'Anulaciones, descuentos', icon: ShieldCheck, run: go('/admin/control') },
      // Negocio
      { id: 'restaurants', label: 'Restaurantes', hint: 'Marcas y sucursales', icon: Store, run: go('/admin/restaurants') },
      { id: 'settings', label: 'Configuración', hint: 'País, moneda, puntos', icon: Settings, run: go('/admin/settings') },
      { id: 'staff', label: 'Equipo', hint: 'Configuración', icon: UsersRound, run: go('/admin/staff') },
      { id: 'billing', label: 'Facturación', hint: 'Configuración', icon: CreditCard, run: go('/admin/billing') },
      // Terminales (apps full-screen)
      { id: 'kitchen', label: 'Cocina (KDS)', icon: ChefHat, run: go('/kitchen') },
      { id: 'pos', label: 'Caja / POS', icon: CreditCard, run: go('/pos') },
      { id: 'waiter', label: 'Mesas (mesero)', icon: UtensilsCrossed, run: go('/waiter') },
      // Sin entrada a /driver: es la app operativa del repartidor y depende de
      // tener un perfil de Driver (owner/admin no lo tienen → pantalla vacía).
      {
        id: 'theme',
        label: theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => {
          toggleTheme();
          setOpen(false);
        },
      },
      {
        id: 'logout',
        label: 'Cerrar sesión',
        icon: LogOut,
        run: async () => {
          setOpen(false);
          await logout();
          router.replace('/login');
        },
      },
    ];
  }, [router, toggleTheme, theme]);

  const results = useMemo(
    () => commands.filter((c) => fuzzyMatch(`${c.label} ${c.hint ?? ''}`, query)),
    [commands, query],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // El input se monta con el diálogo; enfocar en el próximo frame.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // El índice activo debe seguir siendo válido cuando la lista se achica.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(1, results.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + Math.max(1, results.length)) % Math.max(1, results.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void results[active]?.run();
      }
    },
    [results, active],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] animate-fade-in"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="panel w-full max-w-lg overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar comandos"
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onListKeyDown}
            placeholder="Buscar una pantalla o acción..."
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2">
          {results.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                type="button"
                onClick={() => void cmd.run()}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  i === active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                }`}
              >
                <cmd.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 font-medium">{cmd.label}</span>
                {cmd.hint && <span className="text-xs text-muted-foreground">{cmd.hint}</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nada coincide con “{query}”.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
