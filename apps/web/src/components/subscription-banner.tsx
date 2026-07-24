'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { getCurrentClaims } from '@/lib/auth';

type Estado = { bloqueada: boolean; motivo: 'TRIAL_VENCIDO' | 'CANCELADA' | 'SUSPENDIDA' | null };

const TITULO: Record<NonNullable<Estado['motivo']>, string> = {
  TRIAL_VENCIDO: 'Tu prueba gratuita terminó',
  CANCELADA: 'Tu suscripción terminó',
  SUSPENDIDA: 'Tu suscripción está suspendida',
};

/**
 * Banner de SOLO LECTURA — se monta en TODAS las superficies del staff (admin,
 * caja, mesero, cocina, repartidor). Con la suscripción vencida, el backend
 * rechaza toda escritura con 402 (SubscriptionGuard); esto se lo ANTICIPA al
 * usuario y lo dirige al pago, en vez de dejar que descubra el bloqueo a los
 * golpes con cada botón.
 *
 * Chequea el estado CADA MINUTO (decisión de producto): el bloqueo aparece
 * a lo sumo 60s después de vencer, y —igual de importante— desaparece a lo
 * sumo 60s después de pagar. No es descartable: mientras esté bloqueado, el
 * banner está.
 */
export function SubscriptionBanner() {
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    let vivo = true;
    const chequear = () => {
      api
        .get<Estado>('/billing/estado')
        .then((e) => {
          if (vivo) setEstado(e);
        })
        // Sin red o sin sesión: no se muestra nada — el banner nunca debe
        // romper la pantalla que lo hospeda.
        .catch(() => {});
    };
    chequear();
    const id = setInterval(chequear, 60_000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  if (!estado?.bloqueada || !estado.motivo) return null;

  // El rol sale del JWT ya presente — sin requests extra. Solo dueño/gerente
  // pueden pagar; al resto se le dice a quién recurrir.
  const rol = getCurrentClaims()?.role;
  const puedePagar = rol === 'OWNER' || rol === 'ADMIN';
  const suspendida = estado.motivo === 'SUSPENDIDA';

  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-error/40 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-error-foreground" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-heading font-semibold">{TITULO[estado.motivo]}.</span>{' '}
            <span className="text-muted-foreground">
              Tus datos están intactos, pero el sistema quedó en solo lectura.
            </span>
          </p>
        </div>
        {suspendida ? (
          <span className="text-sm font-medium">Escribinos a soporte@chillberry.app</span>
        ) : puedePagar ? (
          <Link href="/admin/billing" className="btn btn-primary shrink-0">
            Regularizar el pago
          </Link>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">
            Avisale al dueño para reactivarlo
          </span>
        )}
      </div>
    </div>
  );
}
