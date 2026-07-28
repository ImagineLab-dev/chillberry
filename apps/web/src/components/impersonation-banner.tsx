'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, UserCog } from 'lucide-react';
import { getImpersonation, stopImpersonation } from '@/lib/impersonation';

/**
 * Aviso fijo cuando el super-admin está "viendo como" un restaurante. Deja claro
 * que NO es tu sesión y da un botón para volver al panel. La impersonación vive en
 * `localStorage` (compartida entre pestañas del host, ver lib/impersonation), y el
 * `storage` event mantiene el banner en sync: si en OTRA pestaña se empieza/termina
 * una impersonación, esta pestaña —que usa las MISMAS cookies de sesión— lo refleja
 * al instante en vez de quedar operando como el tenant sin ningún aviso.
 */
export function ImpersonationBanner() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setTenantName(getImpersonation()?.tenantName ?? null);
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  if (!tenantName) return null;

  return (
    <div className="sticky top-0 z-[80] flex flex-wrap items-center justify-between gap-2 border-b-2 border-warn bg-warn/15 px-4 py-2 text-sm text-warn-foreground backdrop-blur">
      <span className="flex items-center gap-2 font-medium">
        <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
        Estás viendo como <span className="font-semibold">{tenantName}</span> — modo super-admin
      </span>
      <button
        type="button"
        onClick={() => {
          stopImpersonation();
          router.push('/super-admin');
        }}
        className="btn btn-sm shrink-0"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Salir
      </button>
    </div>
  );
}
