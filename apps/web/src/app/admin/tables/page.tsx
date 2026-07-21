'use client';

import { AyudaSeccion } from '@/components/ayuda-seccion';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Pencil, Plus, Power, QrCode as QrCodeIcon, RefreshCw, Trash2, X } from 'lucide-react';
import { TABLE_STATUS } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';

type Branch = { id: string; name: string };
type Table = { id: string; code: string; qrToken: string; status: string; capacity: number | null; active: boolean };

const STATUS_TONE: Record<string, Tone> = {
  AVAILABLE: 'ok',
  OCCUPIED: 'error',
  RESERVED: 'warn',
};

function TableCard({ table, onChanged }: { table: Table; onChanged: () => Promise<void> }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editCode, setEditCode] = useState(table.code);
  const [editCapacity, setEditCapacity] = useState(table.capacity != null ? String(table.capacity) : '');
  const [editStatus, setEditStatus] = useState<string>(table.status);
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const menuUrl = `${window.location.origin}/menu/${table.qrToken}`;
    QRCode.toDataURL(menuUrl, { width: 240, margin: 1 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [table.qrToken]);

  function onDownload() {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `mesa-${table.code}-qr.png`;
    a.click();
  }

  async function onRotate() {
    if (!confirm('Esto invalida el QR actual — hay que reimprimirlo. ¿Continuar?')) return;
    setBusy(true);
    setCardError(null);
    try {
      await api.post(`/tables/${table.id}/rotate-qr`);
      await onChanged();
    } catch (err) {
      setCardError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCardError(null);
    try {
      await api.patch(`/tables/${table.id}`, {
        code: editCode,
        capacity: editCapacity === '' ? null : Number(editCapacity),
        status: editStatus,
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      setCardError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function onToggleActive() {
    setBusy(true);
    setCardError(null);
    try {
      await api.patch(`/tables/${table.id}`, { active: !table.active });
      await onChanged();
    } catch (err) {
      setCardError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  // Borrado DURO — el backend solo lo permite si la mesa no tiene pedidos ni
  // reservas; si los tiene devuelve 409 con el texto que mostramos ("...
  // desactivala en su lugar"). Confirmamos siempre: es irreversible.
  async function onDelete() {
    if (!confirm(`¿Eliminar definitivamente la mesa ${table.code}? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setCardError(null);
    try {
      await api.delete(`/tables/${table.id}`);
      await onChanged();
    } catch (err) {
      setCardError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card flex flex-col gap-4 p-5 ${table.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-lg font-semibold">Mesa {table.code}</p>
          <p className="text-sm text-muted-foreground">Capacidad: {table.capacity ?? '—'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {!table.active && (
            <Badge tone="error" dot>
              Inactiva
            </Badge>
          )}
          <Badge tone={STATUS_TONE[table.status] ?? 'info'} dot>
            {table.status}
          </Badge>
        </div>
      </div>

      {/* bg-white fijo, NO tokenizar: el QR se genera con `margin: 1` pero la norma
          pide 4 módulos de zona de silencio — esta placa blanca lo compensa. En
          oscuro o con otro color de fondo, el código deja de escanear. */}
      <div className="flex justify-center rounded-md bg-white p-3">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`Código QR de la mesa ${table.code}`}
            width={140}
            height={140}
          />
        ) : (
          <div className="flex h-[140px] w-[140px] items-center justify-center text-xs text-muted-foreground">
            Generando QR...
          </div>
        )}
      </div>

      {cardError && <Alert tone="error">{cardError}</Alert>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onDownload} disabled={!qrDataUrl} className="btn btn-sm">
          <Download className="h-4 w-4" />
          Descargar
        </button>
        <button type="button" onClick={onRotate} disabled={busy} className="btn btn-sm">
          <RefreshCw className="h-4 w-4" />
          Rotar QR
        </button>
        <button
          type="button"
          onClick={() => {
            if (!editing) {
              setEditCode(table.code);
              setEditCapacity(table.capacity != null ? String(table.capacity) : '');
              setEditStatus(table.status);
            }
            setEditing((v) => !v);
          }}
          disabled={busy}
          className="btn btn-sm"
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editing ? 'Cancelar' : 'Editar'}
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={busy}
          className="btn btn-sm"
          title={table.active ? 'Desactivar mesa (la saca del mapa del mesero)' : 'Reactivar mesa'}
        >
          <Power className="h-4 w-4" />
          {table.active ? 'Desactivar' : 'Activar'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="btn btn-sm btn-danger"
          title="Eliminar definitivamente (solo si no tiene pedidos ni reservas)"
        >
          <Trash2 className="h-4 w-4" />
          Eliminar
        </button>
      </div>

      {editing && (
        <form onSubmit={onSaveEdit} className="flex flex-col gap-2 border-t border-border pt-3">
          <input
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            placeholder="Código de mesa"
            required
            className="input w-full"
          />
          <input
            type="number"
            value={editCapacity}
            onChange={(e) => setEditCapacity(e.target.value)}
            placeholder="Capacidad"
            className="input w-full"
          />
          <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="input w-full">
            {Object.values(TABLE_STATUS).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy} className="btn btn-primary">
            Guardar cambios
          </button>
        </form>
      )}
    </div>
  );
}

export default function TablesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [branchId, setBranchId] = useState('');
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [error, setError] = useState<string | null>(null);
  // Carga inicial de las mesas de la sucursal. Sin esto, un GET fallido/lento se
  // veía igual que "esta sucursal no tiene mesas" (cuenta vacía), sin reintento.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadBranches() {
    const b = await api.get<Branch[]>('/branches');
    setBranches(b);
    if (!branchId && b[0]) setBranchId(b[0].id);
    return b;
  }

  async function loadTables(forBranchId: string) {
    if (!forBranchId) return;
    setTables(await api.get<Table[]>('/tables', { query: { branchId: forBranchId } }));
  }

  useEffect(() => {
    loadBranches()
      .then((b) => {
        // Sin sucursales no corre loadTables (corta con branchId vacío):
        // cerramos el loading acá para mostrar el estado vacío.
        if (b.length === 0) setLoading(false);
      })
      .catch((err) => {
        setLoadError((err as ApiError).message);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadTables(branchId)
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

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/tables', { branchId, code, capacity: Number(capacity) });
      setCode('');
      await loadTables(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div>
      <PageHeader title="Mesas" description="Cada mesa tiene su QR: el comensal lo escanea y ve el menú." />

      <AyudaSeccion id="tables" titulo="Cada mesa lleva su propio QR">
        <p>Al crear una mesa se genera su código. Lo imprimís, lo pegás en la mesa, y el cliente pide desde su teléfono sin instalar nada.</p>
        <p>Si el QR de una mesa se filtra, podés rotarlo sin cambiar nada más.</p>
      </AyudaSeccion>


      <div className="mb-4">
        <label htmlFor="tables-branch" className="label mb-1.5">
          Sucursal
        </label>
        <select
          id="tables-branch"
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

      <form onSubmit={onCreate} className="mb-6 flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Número/código de mesa"
          required
          className="input w-full sm:w-40"
        />
        <input
          type="number"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="Capacidad"
          className="input w-full sm:w-28"
        />
        <button className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Crear mesa
        </button>
      </form>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      )}

      {loadError && !loading && (
        <Alert tone="error" className="mb-4">
          {loadError}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <TableCard key={t.id} table={t} onChanged={() => loadTables(branchId)} />
        ))}
      </div>
      {!loading && !loadError && tables.length === 0 && (
        <EmptyState
          icon={QrCodeIcon}
          title="Esta sucursal todavía no tiene mesas"
          description="Creá tu primera mesa acá arriba y te generamos el código QR para imprimir y pegar."
        />
      )}
    </div>
  );
}
