'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, Check, Clock, Phone, Plus, UserX, Users, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';

type Branch = { id: string; name: string };
type TableRow = { id: string; code: string; status: string };
type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'SEATED' | 'CANCELLED' | 'NO_SHOW';
type Reservation = {
  id: string;
  branchId: string;
  tableId: string | null;
  customerName: string;
  customerPhone: string | null;
  partySize: number;
  reservedFor: string;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
  table: { code: string } | null;
};

/** estado → color del badge + etiqueta en español (rioplatense). */
const STATUS_META: Record<ReservationStatus, { tone: Tone; label: string }> = {
  PENDING: { tone: 'warn', label: 'Pendiente' },
  CONFIRMED: { tone: 'info', label: 'Confirmada' },
  SEATED: { tone: 'ok', label: 'Sentada' },
  CANCELLED: { tone: 'neutral', label: 'Cancelada' },
  NO_SHOW: { tone: 'error', label: 'No vino' },
};

/** Filtro de estado del listado. '' = todas. */
const STATUS_FILTERS: { value: '' | ReservationStatus; label: string }[] = [
  { value: '', label: 'Todos los estados' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'SEATED', label: 'Sentadas' },
  { value: 'CANCELLED', label: 'Canceladas' },
  { value: 'NO_SHOW', label: 'No vino' },
];

/** YYYY-MM-DD de hoy en horario local (para el <input type="date">). */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const fmtHour = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });

/** Una reserva como card. Estado local propio (busy, error, modo "sentar") — mismo
 *  patrón que TableCard: cada card se ocupa de su propia mutación. */
function ReservationCard({
  reservation: r,
  availableTables,
  showDate,
  onChanged,
}: {
  reservation: Reservation;
  /** Mesas AVAILABLE del branch — para elegir al sentar una reserva sin mesa. */
  availableTables: TableRow[];
  /** En "Próximas" las reservas cruzan varios días: mostramos la fecha además de la hora. */
  showDate: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [seating, setSeating] = useState(false);
  const [pickTable, setPickTable] = useState('');

  const when = new Date(r.reservedFor);
  const meta = STATUS_META[r.status];

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setCardError(null);
    try {
      await api.patch(`/reservations/${r.id}`, body);
      await onChanged();
    } catch (err) {
      setCardError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function onSentarClick() {
    // Con mesa ya asignada: sentar directo (el backend ocupa esa mesa).
    // Sin mesa: abrir el selector de mesas disponibles.
    if (r.tableId) {
      void patch({ status: 'SEATED', tableId: r.tableId });
    } else {
      setSeating(true);
    }
  }

  async function confirmSeat() {
    if (!pickTable) return;
    await patch({ status: 'SEATED', tableId: pickTable });
    setSeating(false);
    setPickTable('');
  }

  const isTerminal = r.status === 'SEATED' || r.status === 'CANCELLED' || r.status === 'NO_SHOW';

  return (
    <li className="card card-dense p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-center">
          <div className="tabular font-heading text-2xl font-semibold leading-none">{fmtHour.format(when)}</div>
          {showDate && <div className="mt-1 text-xs text-muted-foreground">{fmtDate.format(when)}</div>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading font-medium text-foreground">{r.customerName}</span>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="tabular">{r.partySize}</span> {r.partySize === 1 ? 'persona' : 'personas'}
            </span>
            {r.customerPhone && (
              <a href={`tel:${r.customerPhone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="tabular">{r.customerPhone}</span>
              </a>
            )}
            {r.table && <span className="font-medium text-foreground">Mesa {r.table.code}</span>}
          </div>

          {r.notes && <p className="mt-1 text-sm text-muted-foreground">{r.notes}</p>}
        </div>
      </div>

      {cardError && (
        <Alert tone="error" className="mt-3">
          {cardError}
        </Alert>
      )}

      {/* Selector de mesa al sentar una reserva sin mesa asignada. */}
      {seating && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {availableTables.length > 0 ? (
            <>
              <select
                value={pickTable}
                onChange={(e) => setPickTable(e.target.value)}
                className="input w-full sm:w-48"
                aria-label="Mesa para sentar"
              >
                <option value="">Elegí una mesa...</option>
                {availableTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Mesa {t.code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void confirmSeat()}
                disabled={busy || !pickTable}
                className="btn btn-primary btn-sm"
              >
                <Check className="h-4 w-4" />
                Sentar acá
              </button>
              <button
                type="button"
                onClick={() => {
                  setSeating(false);
                  setPickTable('');
                }}
                disabled={busy}
                className="btn btn-ghost btn-sm"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">No hay mesas disponibles en esta sucursal ahora.</span>
              <button
                type="button"
                onClick={() => setSeating(false)}
                className="btn btn-ghost btn-sm"
              >
                Cerrar
              </button>
            </>
          )}
        </div>
      )}

      {/* Acciones según el estado. Los estados terminales no muestran nada. */}
      {!isTerminal && !seating && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {r.status === 'PENDING' && (
            <button type="button" onClick={() => void patch({ status: 'CONFIRMED' })} disabled={busy} className="btn btn-sm">
              <Check className="h-4 w-4" />
              Confirmar
            </button>
          )}
          {r.status === 'CONFIRMED' && (
            <button type="button" onClick={onSentarClick} disabled={busy} className="btn btn-primary btn-sm">
              <Users className="h-4 w-4" />
              Sentar
            </button>
          )}
          {r.status === 'CONFIRMED' && (
            <button type="button" onClick={() => void patch({ status: 'NO_SHOW' })} disabled={busy} className="btn btn-sm">
              <UserX className="h-4 w-4" />
              No vino
            </button>
          )}
          <button type="button" onClick={() => void patch({ status: 'CANCELLED' })} disabled={busy} className="btn btn-danger btn-sm">
            <X className="h-4 w-4" />
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}

export default function ReservationsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tables, setTables] = useState<TableRow[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const [mode, setMode] = useState<'day' | 'upcoming'>('day');
  const [day, setDay] = useState<string>(todayLocal());
  const [statusFilter, setStatusFilter] = useState<'' | ReservationStatus>('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form de nueva reserva.
  const [fName, setFName] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fParty, setFParty] = useState('2');
  const [fWhen, setFWhen] = useState('');
  const [fTable, setFTable] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadBranches() {
    const b = await api.get<Branch[]>('/branches');
    setBranches(b);
    if (!branchId && b[0]) setBranchId(b[0].id);
  }

  const loadTables = useCallback(async (forBranchId: string) => {
    if (!forBranchId) return;
    setTables(await api.get<TableRow[]>('/tables', { query: { branchId: forBranchId } }));
  }, []);

  const loadReservations = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | undefined> = { branchId, status: statusFilter || undefined };
      if (mode === 'day') {
        query.from = new Date(`${day}T00:00:00`).toISOString();
        query.to = new Date(`${day}T23:59:59`).toISOString();
      } else {
        // "Próximas" = agenda hacia adelante desde este momento.
        query.from = new Date().toISOString();
      }
      setReservations(await api.get<Reservation[]>('/reservations', { query }));
    } catch (err) {
      setError((err as ApiError).message);
      setReservations([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, mode, day, statusFilter]);

  useEffect(() => {
    loadBranches().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTables(branchId).catch(() => {});
  }, [branchId, loadTables]);

  useEffect(() => {
    loadReservations().catch(() => {});
  }, [loadReservations]);

  // Tras cualquier mutación: recargar reservas Y mesas (sentar ocupa una mesa).
  const refresh = useCallback(async () => {
    await Promise.all([loadReservations(), loadTables(branchId)]);
  }, [loadReservations, loadTables, branchId]);

  const availableTables = tables.filter((t) => t.status === 'AVAILABLE');

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) return;
    setCreating(true);
    setFormError(null);
    try {
      await api.post('/reservations', {
        branchId,
        tableId: fTable || undefined,
        customerName: fName,
        customerPhone: fPhone || undefined,
        partySize: Number(fParty) || 1,
        reservedFor: new Date(fWhen).toISOString(),
        notes: fNotes || undefined,
      });
      setFName('');
      setFPhone('');
      setFParty('2');
      setFWhen('');
      setFTable('');
      setFNotes('');
      await refresh();
    } catch (err) {
      setFormError((err as ApiError).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reservas"
        description="La agenda del salón: quién viene, cuántos son y a qué hora. Confirmá, sentá o cancelá con un toque."
      />

      <div className="mb-6">
        <label htmlFor="res-branch" className="label mb-1.5">
          Sucursal
        </label>
        <select
          id="res-branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="input w-full sm:w-64"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Form de nueva reserva. */}
      <form onSubmit={onCreate} className="panel mb-8 p-5">
        <h2 className="mb-3 font-heading text-lg font-semibold">Nueva reserva</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="res-name" className="label mb-1.5">
              Nombre
            </label>
            <input
              id="res-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="Familia López"
              required
              className="input w-full"
            />
          </div>
          <div>
            <label htmlFor="res-phone" className="label mb-1.5">
              Teléfono
            </label>
            <input
              id="res-phone"
              type="tel"
              value={fPhone}
              onChange={(e) => setFPhone(e.target.value)}
              placeholder="Opcional"
              className="input w-full"
            />
          </div>
          <div>
            <label htmlFor="res-party" className="label mb-1.5">
              Personas
            </label>
            <input
              id="res-party"
              type="number"
              min={1}
              value={fParty}
              onChange={(e) => setFParty(e.target.value)}
              required
              className="input w-full"
            />
          </div>
          <div>
            <label htmlFor="res-when" className="label mb-1.5">
              Fecha y hora
            </label>
            <input
              id="res-when"
              type="datetime-local"
              value={fWhen}
              onChange={(e) => setFWhen(e.target.value)}
              required
              className="input w-full"
            />
          </div>
          <div>
            <label htmlFor="res-table" className="label mb-1.5">
              Mesa
            </label>
            <select
              id="res-table"
              value={fTable}
              onChange={(e) => setFTable(e.target.value)}
              className="input w-full"
            >
              <option value="">Sin asignar</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  Mesa {t.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="res-notes" className="label mb-1.5">
              Notas
            </label>
            <input
              id="res-notes"
              value={fNotes}
              onChange={(e) => setFNotes(e.target.value)}
              placeholder="Cumpleaños, alergias, etc."
              className="input w-full"
            />
          </div>
        </div>

        {formError && (
          <Alert tone="error" className="mt-3">
            {formError}
          </Alert>
        )}

        <button type="submit" disabled={creating} className="btn btn-primary mt-4">
          <Plus className="h-4 w-4" />
          Crear reserva
        </button>
      </form>

      {/* Filtros de listado. */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('day')}
            aria-pressed={mode === 'day'}
            className={`btn btn-sm ${mode === 'day' ? 'btn-primary' : ''}`}
          >
            <CalendarDays className="h-4 w-4" />
            Por día
          </button>
          <button
            type="button"
            onClick={() => setMode('upcoming')}
            aria-pressed={mode === 'upcoming'}
            className={`btn btn-sm ${mode === 'upcoming' ? 'btn-primary' : ''}`}
          >
            <Clock className="h-4 w-4" />
            Próximas
          </button>
        </div>

        {mode === 'day' && (
          <div>
            <label htmlFor="res-day" className="label mb-1.5">
              Día
            </label>
            <input
              id="res-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="input w-full sm:w-44"
            />
          </div>
        )}

        <div>
          <label htmlFor="res-status" className="label mb-1.5">
            Estado
          </label>
          <select
            id="res-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | ReservationStatus)}
            className="input w-full sm:w-48"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton className="h-24 w-full" />
            </li>
          ))}
        </ul>
      ) : reservations.length > 0 ? (
        <ul className="space-y-3">
          {reservations.map((r) => (
            <ReservationCard
              key={r.id}
              reservation={r}
              availableTables={availableTables}
              showDate={mode === 'upcoming'}
              onChanged={refresh}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title={mode === 'day' ? 'No hay reservas para este día' : 'No hay reservas próximas'}
          description={
            mode === 'day'
              ? 'Cuando alguien reserve para esta fecha —o la cargues vos acá arriba— va a aparecer en esta lista.'
              : 'La agenda hacia adelante está vacía. Cargá una reserva arriba y aparece acá.'
          }
        />
      )}
    </div>
  );
}
