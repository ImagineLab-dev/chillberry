'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, Clock, MapPin, Package, Phone, User, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { formatMoney, INCIDENT_TYPE, type IncidentType } from '@chillberry/domain';
import { Alert, Badge, EmptyState, Skeleton, type Tone } from '@/components/ui';

// ----------------------------------------------------------------- tipos

type DeliveryRow = {
  id: string;
  status: string;
  addressLine: string;
  deliveryFee: string;
  confirmationCode: string;
  estimatedMinutes: number | null;
  createdAt: string;
  assignedAt: string | null;
  driverId: string | null;
  order: {
    id: string;
    customerName: string | null;
    customerPhone: string | null;
    total: string;
    type: string;
    status: string;
    createdAt: string;
  };
  driver: { id: string; phone: string; availability: string; user: { name: string } } | null;
  zone: { name: string } | null;
};

type DriverRoster = {
  id: string;
  availability: string;
  phone: string;
  user: { name: string };
};

// --------------------------------------------------------- vocabulario

// Etiqueta + tono por estado. El tono se elige para que el board se escanee de
// un vistazo: PENDING en warn (necesita acción: sin asignar), en tránsito en
// info/primary, entregado en ok, cualquier cancelación/fallo en error.
const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente', tone: 'warn' },
  DRIVER_ASSIGNED: { label: 'Asignado', tone: 'info' },
  ACCEPTED: { label: 'Aceptado', tone: 'info' },
  PICKED_UP: { label: 'Retirado', tone: 'primary' },
  DELIVERED: { label: 'Entregado', tone: 'ok' },
  DRIVER_CANCELLED: { label: 'Cancelado (repartidor)', tone: 'error' },
  CUSTOMER_CANCELLED: { label: 'Cancelado (cliente)', tone: 'error' },
  RESTAURANT_CANCELLED: { label: 'Cancelado (local)', tone: 'error' },
  FAILED: { label: 'Fallido', tone: 'error' },
};

// Orden de despacho para el filtro — los estados vivos primero.
const STATUS_FILTER_ORDER = [
  'PENDING',
  'DRIVER_ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'DELIVERED',
  'RESTAURANT_CANCELLED',
  'CUSTOMER_CANCELLED',
  'DRIVER_CANCELLED',
  'FAILED',
] as const;

// Motivos de cancelación que admite el DTO (PATCH /delivery/:id/status).
const CANCEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'RESTAURANT_CANCELLED', label: 'Cancela el local' },
  { value: 'CUSTOMER_CANCELLED', label: 'Cancela el cliente' },
  { value: 'DRIVER_CANCELLED', label: 'Cancela el repartidor' },
];

const INCIDENT_LABEL: Record<IncidentType, string> = {
  CUSTOMER_UNREACHABLE: 'Cliente no responde',
  WRONG_ADDRESS: 'Dirección incorrecta',
  DAMAGED_ORDER: 'Pedido dañado',
  DELAY: 'Demora',
  OTHER: 'Otro',
};

// Estados terminales: no admiten cancelación ni reasignación.
const TERMINAL = new Set([
  'DELIVERED',
  'DRIVER_CANCELLED',
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CANCELLED',
  'FAILED',
]);

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ------------------------------------------------------------- board

export function DeliveryBoard({ branchId, countryCode }: { branchId: string; countryCode: string }) {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRoster[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onlineDrivers = useMemo(() => drivers.filter((d) => d.availability === 'ONLINE'), [drivers]);

  const load = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const query: Record<string, string> = { branchId };
    if (status) query.status = status;
    Promise.all([
      api.get<DeliveryRow[]>('/delivery', { query }),
      api.get<DriverRoster[]>('/delivery/drivers'),
    ])
      .then(([deliveries, roster]) => {
        setRows(deliveries);
        setDrivers(roster);
      })
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [branchId, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <label className="label" htmlFor="del-status">
            Estado
          </label>
          <select
            id="del-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input w-full sm:w-56"
          >
            <option value="">Todos los estados</option>
            {STATUS_FILTER_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s]?.label ?? s}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={load} className="btn btn-lg">
          Actualizar
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon={Package}
          title="No hay entregas en esta sucursal"
          description="Cuando entre un pedido con envío, aparece acá para asignarle repartidor y seguirlo."
        />
      )}

      {!loading && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <DeliveryCard
              key={row.id}
              row={row}
              onlineDrivers={onlineDrivers}
              countryCode={countryCode}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------- tarjeta

type Panel = 'assign' | 'cancel' | 'incident' | null;

function DeliveryCard({
  row,
  onlineDrivers,
  countryCode,
  onChanged,
}: {
  row: DeliveryRow;
  onlineDrivers: DriverRoster[];
  countryCode: string;
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [driverId, setDriverId] = useState('');
  const [cancelStatus, setCancelStatus] = useState('RESTAURANT_CANCELLED');
  const [cancelReason, setCancelReason] = useState('');
  const [incidentType, setIncidentType] = useState<IncidentType>('CUSTOMER_UNREACHABLE');
  const [incidentDesc, setIncidentDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = STATUS_META[row.status] ?? { label: row.status, tone: 'neutral' as Tone };
  const canAssign = row.status === 'PENDING' || row.status === 'DRIVER_ASSIGNED';
  const canCancel = !TERMINAL.has(row.status);

  function togglePanel(next: Panel) {
    setError(null);
    setPanel((cur) => (cur === next ? null : next));
  }

  async function runAssign() {
    if (!driverId) {
      setError('Elegí un repartidor.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/delivery/assign/${row.id}`, { driverId });
      setPanel(null);
      setDriverId('');
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function runCancel() {
    if (!cancelReason.trim()) {
      setError('El motivo es obligatorio.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/delivery/${row.id}/status`, { status: cancelStatus, reason: cancelReason.trim() });
      setPanel(null);
      setCancelReason('');
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function runIncident() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/delivery/${row.id}/incidents`, {
        type: incidentType,
        ...(incidentDesc.trim() ? { description: incidentDesc.trim() } : {}),
      });
      setPanel(null);
      setIncidentDesc('');
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-heading text-base font-semibold">
              {row.order.customerName || 'Cliente sin nombre'}
            </span>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
          </div>
          {row.order.customerPhone && (
            <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <a href={`tel:${row.order.customerPhone}`} className="hover:text-foreground hover:underline">
                {row.order.customerPhone}
              </a>
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="tabular font-heading text-base font-semibold">
            {formatMoney(Number(row.order.total), countryCode)}
          </p>
          <p className="tabular text-xs text-muted-foreground">
            Envío {formatMoney(Number(row.deliveryFee), countryCode)}
          </p>
        </div>
      </div>

      <p className="mb-1 flex items-start gap-1.5 text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{row.addressLine}</span>
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Bike className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {row.driver ? (
            <span className="text-foreground">
              {row.driver.user.name} · {row.driver.phone}
            </span>
          ) : (
            <span className="text-warn-foreground">Sin asignar</span>
          )}
        </span>
        {row.zone?.name && <span>Zona: {row.zone.name}</span>}
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formatWhen(row.createdAt)}
        </span>
        <span className="tabular">Código {row.confirmationCode}</span>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2">
        {canAssign && (
          <button
            type="button"
            onClick={() => togglePanel('assign')}
            className={`btn ${panel === 'assign' ? 'btn-primary' : ''}`}
          >
            <User className="h-4 w-4" aria-hidden="true" />
            {row.status === 'PENDING' ? 'Asignar repartidor' : 'Reasignar'}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={() => togglePanel('cancel')}
            className={`btn ${panel === 'cancel' ? 'btn-danger' : ''}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancelar
          </button>
        )}
        <button
          type="button"
          onClick={() => togglePanel('incident')}
          className={`btn ${panel === 'incident' ? 'btn-primary' : ''}`}
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Incidente
        </button>
      </div>

      {panel && (
        <div className="panel mt-3 space-y-3 p-3">
          {error && <Alert tone="error">{error}</Alert>}

          {panel === 'assign' && (
            <div className="space-y-2">
              <label className="label" htmlFor={`assign-${row.id}`}>
                Repartidor en línea
              </label>
              {onlineDrivers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay repartidores en línea ahora. Cuando alguno se ponga disponible, va a aparecer acá.
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <select
                    id={`assign-${row.id}`}
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="input w-full sm:w-64"
                  >
                    <option value="">Elegir repartidor…</option>
                    {onlineDrivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.user.name} · {d.phone}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={runAssign}
                    disabled={submitting}
                    className="btn btn-primary btn-lg"
                  >
                    Confirmar asignación
                  </button>
                </div>
              )}
            </div>
          )}

          {panel === 'cancel' && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <label className="label" htmlFor={`cancel-status-${row.id}`}>
                  Motivo de cancelación
                </label>
                <select
                  id={`cancel-status-${row.id}`}
                  value={cancelStatus}
                  onChange={(e) => setCancelStatus(e.target.value)}
                  className="input w-full sm:w-64"
                >
                  {CANCEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="label" htmlFor={`cancel-reason-${row.id}`}>
                  Detalle (obligatorio)
                </label>
                <input
                  id={`cancel-reason-${row.id}`}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  maxLength={300}
                  placeholder="Ej: el cliente no respondió al teléfono"
                  className="input w-full"
                />
              </div>
              <button
                type="button"
                onClick={runCancel}
                disabled={submitting}
                className="btn btn-danger btn-lg"
              >
                Cancelar la entrega
              </button>
            </div>
          )}

          {panel === 'incident' && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <label className="label" htmlFor={`inc-type-${row.id}`}>
                  Tipo de incidente
                </label>
                <select
                  id={`inc-type-${row.id}`}
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value as IncidentType)}
                  className="input w-full sm:w-64"
                >
                  {Object.values(INCIDENT_TYPE).map((t) => (
                    <option key={t} value={t}>
                      {INCIDENT_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="label" htmlFor={`inc-desc-${row.id}`}>
                  Descripción (opcional)
                </label>
                <input
                  id={`inc-desc-${row.id}`}
                  value={incidentDesc}
                  onChange={(e) => setIncidentDesc(e.target.value)}
                  maxLength={500}
                  placeholder="Qué pasó"
                  className="input w-full"
                />
              </div>
              <button
                type="button"
                onClick={runIncident}
                disabled={submitting}
                className="btn btn-primary btn-lg"
              >
                Registrar incidente
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
