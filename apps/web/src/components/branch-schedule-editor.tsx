'use client';

import { useEffect, useState } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Skeleton } from '@/components/ui';

type Hour = { id: string; weekday: number; openMinute: number; closeMinute: number };
type Closure = { id: string; date: string; reason: string | null };
type Schedule = { hours: Hour[]; closures: Closure[] };

type TimeRange = { open: string; close: string }; // "HH:MM"
type DayState = { open: boolean; ranges: TimeRange[] };

// weekday: 0=Dom … 6=Sáb. Se muestra Lun→Dom (arranque de semana rioplatense),
// pero el índice numérico que viaja a la API es siempre el original.
const WEEKDAYS: { idx: number; label: string }[] = [
  { idx: 1, label: 'Lunes' },
  { idx: 2, label: 'Martes' },
  { idx: 3, label: 'Miércoles' },
  { idx: 4, label: 'Jueves' },
  { idx: 5, label: 'Viernes' },
  { idx: 6, label: 'Sábado' },
  { idx: 0, label: 'Domingo' },
];

const DEFAULT_RANGE: TimeRange = { open: '09:00', close: '18:00' };

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(t: string): number {
  const parts = t.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Agrupa las horas de la API en el modelo por-día del editor. */
function buildDays(hours: Hour[]): Record<number, DayState> {
  const days: Record<number, DayState> = {};
  for (const { idx } of WEEKDAYS) days[idx] = { open: false, ranges: [] };
  for (const h of hours) {
    const day = days[h.weekday];
    if (!day) continue;
    day.open = true;
    day.ranges.push({ open: minutesToTime(h.openMinute), close: minutesToTime(h.closeMinute) });
  }
  for (const { idx } of WEEKDAYS) {
    const day = days[idx];
    if (day) day.ranges.sort((a, b) => timeToMinutes(a.open) - timeToMinutes(b.open));
  }
  return days;
}

function sortClosures(closures: Closure[]): Closure[] {
  return [...closures].sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)));
}

/** Formatea 'YYYY-MM-DD' en local sin cruzar por UTC (evita el off-by-one). */
function formatClosureDate(dateStr: string): string {
  const iso = dateStr.slice(0, 10);
  const parts = iso.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

// YYYY-MM-DD local de hoy (en-CA da ese formato) para el mínimo del date input.
function todayISO(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Editor de horarios de atención + fechas cerradas de una sucursal. */
export function BranchScheduleEditor({ branchId }: { branchId: string }) {
  const [days, setDays] = useState<Record<number, DayState>>(() => buildDays([]));
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [savingHours, setSavingHours] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursNotice, setHoursNotice] = useState<string | null>(null);

  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const [addingClosure, setAddingClosure] = useState(false);
  const [closureError, setClosureError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Schedule>(`/branches/${branchId}/schedule`)
      .then((s) => {
        if (cancelled) return;
        setDays(buildDays(s.hours));
        setClosures(sortClosures(s.closures));
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as ApiError).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  // ---- mutadores del modelo por-día (siempre clonan, nunca mutan en sitio) ----
  function patchDay(idx: number, fn: (day: DayState) => DayState) {
    setDays((prev) => {
      const current = prev[idx] ?? { open: false, ranges: [] };
      return { ...prev, [idx]: fn(current) };
    });
  }

  function toggleDay(idx: number, open: boolean) {
    setHoursNotice(null);
    patchDay(idx, (day) => ({
      open,
      ranges: open && day.ranges.length === 0 ? [{ ...DEFAULT_RANGE }] : day.ranges,
    }));
  }

  function addRange(idx: number) {
    setHoursNotice(null);
    patchDay(idx, (day) => ({ ...day, ranges: [...day.ranges, { ...DEFAULT_RANGE }] }));
  }

  function removeRange(idx: number, i: number) {
    setHoursNotice(null);
    patchDay(idx, (day) => {
      const ranges = day.ranges.filter((_, j) => j !== i);
      return { open: ranges.length > 0, ranges };
    });
  }

  function updateRange(idx: number, i: number, field: keyof TimeRange, value: string) {
    setHoursNotice(null);
    patchDay(idx, (day) => ({
      ...day,
      ranges: day.ranges.map((r, j) => (j === i ? { ...r, [field]: value } : r)),
    }));
  }

  async function onSaveHours() {
    setHoursError(null);
    setHoursNotice(null);

    const payload: { weekday: number; openMinute: number; closeMinute: number }[] = [];
    for (const { idx, label } of WEEKDAYS) {
      const day = days[idx];
      if (!day?.open) continue;
      for (const r of day.ranges) {
        if (!r.open || !r.close) {
          setHoursError(`${label}: completá la hora de apertura y de cierre en todas las franjas.`);
          return;
        }
        const openMinute = timeToMinutes(r.open);
        const closeMinute = timeToMinutes(r.close);
        if (closeMinute <= openMinute) {
          setHoursError(`${label}: el cierre (${r.close}) debe ser posterior a la apertura (${r.open}).`);
          return;
        }
        payload.push({ weekday: idx, openMinute, closeMinute });
      }
    }

    setSavingHours(true);
    try {
      const s = await api.put<Schedule>(`/branches/${branchId}/hours`, { hours: payload });
      setDays(buildDays(s.hours));
      setClosures(sortClosures(s.closures));
      setHoursNotice('Horarios guardados.');
    } catch (err) {
      setHoursError((err as ApiError).message);
    } finally {
      setSavingHours(false);
    }
  }

  async function onAddClosure(e: React.FormEvent) {
    e.preventDefault();
    setClosureError(null);
    if (!closureDate) {
      setClosureError('Elegí una fecha.');
      return;
    }
    setAddingClosure(true);
    try {
      await api.post(`/branches/${branchId}/closures`, {
        date: closureDate,
        reason: closureReason.trim() || null,
      });
      // Re-leemos sólo las fechas cerradas para no pisar ediciones de horarios
      // sin guardar que el usuario pueda tener abiertas arriba.
      const s = await api.get<Schedule>(`/branches/${branchId}/schedule`);
      setClosures(sortClosures(s.closures));
      setClosureDate('');
      setClosureReason('');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409) setClosureError('Esa fecha ya está marcada como cerrada.');
      else setClosureError(apiErr.message);
    } finally {
      setAddingClosure(false);
    }
  }

  async function onRemoveClosure(id: string) {
    setClosureError(null);
    setRemovingId(id);
    try {
      await api.delete(`/branches/${branchId}/closures/${id}`);
      setClosures((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setClosureError((err as ApiError).message);
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (loadError) return <Alert tone="error">{loadError}</Alert>;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="font-heading text-base font-semibold">Horarios de atención</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        Sin horarios cargados = siempre disponible para pedidos online. Cargá franjas sólo si querés limitar cuándo se
        toman pedidos.
      </p>

      {hoursError && <Alert tone="error">{hoursError}</Alert>}
      {hoursNotice && <Alert tone="ok">{hoursNotice}</Alert>}

      {/* Editor semanal */}
      <ul className="space-y-2">
        {WEEKDAYS.map(({ idx, label }) => {
          const day = days[idx] ?? { open: false, ranges: [] };
          return (
            <li key={idx} className="card card-dense p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-heading font-medium text-foreground">{label}</span>
                <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(e) => toggleDay(idx, e.target.checked)}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
                    aria-label={`${label}: abierto`}
                  />
                  {day.open ? 'Abierto' : 'Cerrado'}
                </label>
              </div>

              {day.open && (
                <div className="mt-2 space-y-2 border-t border-border pt-2">
                  {day.ranges.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        value={r.open}
                        onChange={(e) => updateRange(idx, i, 'open', e.target.value)}
                        className="input w-32"
                        aria-label={`${label}: apertura franja ${i + 1}`}
                      />
                      <span className="text-muted-foreground">a</span>
                      <input
                        type="time"
                        value={r.close}
                        onChange={(e) => updateRange(idx, i, 'close', e.target.value)}
                        className="input w-32"
                        aria-label={`${label}: cierre franja ${i + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeRange(idx, i)}
                        className="btn btn-sm min-h-[44px] min-w-[44px]"
                        aria-label={`Quitar franja ${i + 1} de ${label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addRange(idx)}
                    className="btn btn-sm min-h-[44px]"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar franja
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" onClick={onSaveHours} disabled={savingHours} className="btn btn-primary min-h-[44px]">
        {savingHours ? 'Guardando...' : 'Guardar horarios'}
      </button>

      {/* Fechas cerradas */}
      <div className="space-y-3 border-t border-border pt-4">
        <h4 className="font-heading text-sm font-semibold">Días cerrados (feriados, vacaciones)</h4>

        {closureError && <Alert tone="error">{closureError}</Alert>}

        <form onSubmit={onAddClosure} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`closure-date-${branchId}`} className="label text-xs">
              Fecha
            </label>
            <input
              id={`closure-date-${branchId}`}
              type="date"
              min={todayISO()}
              value={closureDate}
              onChange={(e) => setClosureDate(e.target.value)}
              className="input w-44"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`closure-reason-${branchId}`} className="label text-xs">
              Motivo (opcional)
            </label>
            <input
              id={`closure-reason-${branchId}`}
              value={closureReason}
              onChange={(e) => setClosureReason(e.target.value)}
              placeholder="Feriado nacional"
              className="input w-full sm:w-56"
            />
          </div>
          <button disabled={addingClosure} className="btn btn-primary min-h-[44px]">
            <Plus className="h-4 w-4" />
            {addingClosure ? 'Agregando...' : 'Agregar'}
          </button>
        </form>

        {closures.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay días cerrados cargados.</p>
        ) : (
          <ul className="space-y-1.5">
            {closures.map((c) => (
              <li
                key={c.id}
                className="card card-dense flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium capitalize text-foreground">{formatClosureDate(c.date)}</span>
                  {c.reason && <span className="text-muted-foreground"> — {c.reason}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveClosure(c.id)}
                  disabled={removingId === c.id}
                  className="btn btn-sm min-h-[44px]"
                  aria-label={`Quitar día cerrado ${formatClosureDate(c.date)}`}
                >
                  <Trash2 className="h-4 w-4" />
                  {removingId === c.id ? '...' : 'Quitar'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
