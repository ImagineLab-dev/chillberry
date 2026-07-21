'use client';

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

/**
 * Primitivas de UI. La apariencia vive en las clases de `globals.css` (que
 * heredan el tema solas vía variables CSS); estos componentes existen sólo
 * donde había duplicación real:
 *
 * - `Badge`: el mapa estado→color estaba reescrito a mano en ~10 archivos.
 * - `Alert`: la misma cadena de clases estaba copiada en 12 archivos.
 * - `Skeleton`: había dos implementaciones locales distintas.
 */

export type Tone = 'ok' | 'warn' | 'info' | 'error' | 'neutral' | 'primary';

const BADGE_TONE: Record<Tone, string> = {
  ok: 'badge-ok',
  warn: 'badge-warn',
  info: 'badge-info',
  error: 'badge-error',
  neutral: 'badge-neutral',
  primary: 'badge-primary',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  /** Punto de color al inicio — para estados que se escanean de un vistazo. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={clsx('badge', BADGE_TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const ALERT_TONE = {
  error: { cls: 'alert-error', Icon: XCircle },
  warn: { cls: 'alert-warn', Icon: AlertTriangle },
  ok: { cls: 'alert-ok', Icon: CheckCircle2 },
  info: { cls: 'alert-info', Icon: Info },
} as const;

export function Alert({
  tone = 'error',
  className,
  children,
}: {
  tone?: keyof typeof ALERT_TONE;
  className?: string;
  children: React.ReactNode;
}) {
  const { cls, Icon } = ALERT_TONE[tone];
  return (
    <div role="alert" className={clsx('alert', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

/**
 * Estado vacío con voz humana — no "No data available". Es el momento en que
 * un usuario nuevo decide si entiende el producto.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="font-heading text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Encabezado de página: título + subtítulo + acciones a la derecha. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
