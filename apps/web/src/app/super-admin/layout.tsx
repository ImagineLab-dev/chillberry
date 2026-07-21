'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Building2, LogOut, ScrollText, ShieldCheck } from 'lucide-react';
import { logout } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui';

/**
 * Layout propio del panel interno de Smartia — NO reusa el de `/admin`, que es
 * el panel de un tenant (su nav apunta a mesas, menú, cocina; nada de eso
 * existe acá) y monta el CommandPalette, que busca recursos del tenant en
 * contexto.
 *
 * La barra superior "Panel interno" es deliberada: quien mira esta pantalla
 * está viendo datos de TODOS los clientes, y tiene que saberlo de un vistazo
 * para no confundirla con el panel de un restaurante.
 */

const NAV = [
  { href: '/super-admin/tenants', label: 'Tenants', icon: Building2 },
  { href: '/super-admin/metrics', label: 'Métricas', icon: BarChart3 },
  { href: '/super-admin/audit', label: 'Auditoría', icon: ScrollText },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col gap-4 p-4 lg:flex-row">
        <aside className="panel flex shrink-0 flex-col p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-56 lg:overflow-y-auto">
          <div className="mb-4 flex items-center justify-between gap-2 lg:mb-6">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-6 w-6 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="truncate font-heading text-base font-semibold tracking-tight">Smartia</div>
                <div className="text-xs text-muted-foreground">Panel interno</div>
              </div>
            </div>
            {/* En móvil el toggle vive acá arriba; en desktop baja al pie. */}
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>

          <nav className="flex flex-row flex-wrap gap-1 lg:flex-col lg:space-y-0.5">
            {NAV.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 font-heading text-sm transition-colors ${
                    isActive
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 space-y-2 border-t border-border pt-4 lg:mt-auto">
            <div className="hidden items-center justify-between lg:flex">
              <Badge tone="primary">Chillberry SaaS</Badge>
              <ThemeToggle />
            </div>
            <button onClick={onLogout} className="btn btn-ghost w-full justify-start">
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-2">{children}</main>
      </div>
    </div>
  );
}
