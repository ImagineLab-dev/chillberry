'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPinned, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { DELIVERY_FEE_TYPE, formatMoney, type DeliveryFeeType } from '@chillberry/domain';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui';

// ----------------------------------------------------------------- tipos

type ZoneRow = {
  id: string;
  name: string;
  feeType: string;
  baseFee: string;
  perKmFee: string | null;
  freeKmThreshold: string | null;
  estimatedMinutes: number;
  minOrderAmount: string | null;
};

const FEE_TYPE_LABEL: Record<DeliveryFeeType, string> = {
  FIXED: 'Tarifa fija',
  BY_ZONE: 'Por zona',
  BY_DISTANCE: 'Por distancia',
};

// --------------------------------------------------------- sección

export function DeliveryZones({ branchId, countryCode }: { branchId: string; countryCode: string }) {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    api
      .get<ZoneRow[]>('/delivery/zones', { query: { branchId } })
      .then(setZones)
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRemove(z: ZoneRow) {
    if (!confirm(`¿Quitar la zona "${z.name}"? Dejará de estar disponible para pedidos nuevos.`)) return;
    setRemovingId(z.id);
    setError(null);
    try {
      await api.delete(`/delivery/zones/${z.id}`);
      if (editingId === z.id) setEditingId(null);
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {error && <Alert tone="error">{error}</Alert>}

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}

        {!loading && zones.length === 0 && (
          <EmptyState
            icon={MapPinned}
            title="Sin zonas de envío"
            description="Creá zonas para definir cuánto cobrás de envío y en cuánto tiempo llega según la zona del cliente."
          />
        )}

        {!loading &&
          zones.map((z) => (
            <div key={z.id} className="card p-4 text-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-heading text-base font-semibold">{z.name}</span>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{FEE_TYPE_LABEL[z.feeType as DeliveryFeeType] ?? z.feeType}</Badge>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === z.id ? null : z.id)}
                    className="btn btn-sm"
                    title="Editar zona"
                  >
                    {editingId === z.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    {editingId === z.id ? 'Cerrar' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(z)}
                    disabled={removingId === z.id}
                    className="btn btn-sm btn-danger"
                    title="Quitar zona"
                  >
                    <Trash2 className="h-4 w-4" />
                    {removingId === z.id ? '...' : 'Quitar'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="tabular">Base {formatMoney(Number(z.baseFee), countryCode)}</span>
                {z.perKmFee != null && (
                  <span className="tabular">Por km {formatMoney(Number(z.perKmFee), countryCode)}</span>
                )}
                {z.freeKmThreshold != null && (
                  <span className="tabular">{Number(z.freeKmThreshold)} km sin cargo</span>
                )}
                <span className="tabular">~{z.estimatedMinutes} min</span>
                {z.minOrderAmount != null && (
                  <span className="tabular">Mínimo {formatMoney(Number(z.minOrderAmount), countryCode)}</span>
                )}
              </div>

              {editingId === z.id && (
                <EditZoneForm
                  zone={z}
                  onSaved={() => {
                    setEditingId(null);
                    load();
                  }}
                />
              )}
            </div>
          ))}
      </div>

      <div className="lg:col-span-1">
        <CreateZoneForm branchId={branchId} onCreated={load} />
      </div>
    </div>
  );
}

// --------------------------------------------------------- alta

function CreateZoneForm({ branchId, onCreated }: { branchId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [feeType, setFeeType] = useState<DeliveryFeeType>('FIXED');
  const [baseFee, setBaseFee] = useState('');
  const [perKmFee, setPerKmFee] = useState('');
  const [freeKmThreshold, setFreeKmThreshold] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const isByDistance = feeType === 'BY_DISTANCE';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) {
      setError('Elegí una sucursal primero.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setOk(false);
    try {
      await api.post('/delivery/zones', {
        branchId,
        name: name.trim(),
        feeType,
        baseFee: Number(baseFee),
        estimatedMinutes: Number(estimatedMinutes),
        ...(isByDistance && perKmFee !== '' ? { perKmFee: Number(perKmFee) } : {}),
        ...(isByDistance && freeKmThreshold !== '' ? { freeKmThreshold: Number(freeKmThreshold) } : {}),
        ...(minOrderAmount !== '' ? { minOrderAmount: Number(minOrderAmount) } : {}),
      });
      setName('');
      setBaseFee('');
      setPerKmFee('');
      setFreeKmThreshold('');
      setEstimatedMinutes('');
      setMinOrderAmount('');
      setOk(true);
      onCreated();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
        <Plus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        Nueva zona de envío
      </h2>

      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="ok">Zona creada.</Alert>}

      <div className="space-y-1.5">
        <label className="label" htmlFor="zone-name">
          Nombre
        </label>
        <input
          id="zone-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          maxLength={80}
          placeholder="Ej: Centro"
          className="input w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="zone-feetype">
          Tipo de tarifa
        </label>
        <select
          id="zone-feetype"
          value={feeType}
          onChange={(e) => setFeeType(e.target.value as DeliveryFeeType)}
          className="input w-full"
        >
          {Object.values(DELIVERY_FEE_TYPE).map((f) => (
            <option key={f} value={f}>
              {FEE_TYPE_LABEL[f]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="zone-basefee">
          Tarifa base
        </label>
        <input
          id="zone-basefee"
          type="number"
          min={0}
          step="0.01"
          value={baseFee}
          onChange={(e) => setBaseFee(e.target.value)}
          required
          className="input w-full"
        />
      </div>

      {isByDistance && (
        <>
          <div className="space-y-1.5">
            <label className="label" htmlFor="zone-perkm">
              Tarifa por km (opcional)
            </label>
            <input
              id="zone-perkm"
              type="number"
              min={0}
              step="0.01"
              value={perKmFee}
              onChange={(e) => setPerKmFee(e.target.value)}
              className="input w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="label" htmlFor="zone-freekm">
              Km sin cargo (opcional)
            </label>
            <input
              id="zone-freekm"
              type="number"
              min={0}
              step="0.01"
              value={freeKmThreshold}
              onChange={(e) => setFreeKmThreshold(e.target.value)}
              className="input w-full"
            />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className="label" htmlFor="zone-eta">
          Tiempo estimado (minutos)
        </label>
        <input
          id="zone-eta"
          type="number"
          min={1}
          step="1"
          value={estimatedMinutes}
          onChange={(e) => setEstimatedMinutes(e.target.value)}
          required
          className="input w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="zone-minorder">
          Pedido mínimo (opcional)
        </label>
        <input
          id="zone-minorder"
          type="number"
          min={0}
          step="0.01"
          value={minOrderAmount}
          onChange={(e) => setMinOrderAmount(e.target.value)}
          className="input w-full"
        />
      </div>

      <button type="submit" disabled={submitting} className="btn btn-primary btn-lg w-full">
        {submitting ? 'Creando…' : 'Crear zona'}
      </button>
    </form>
  );
}

// --------------------------------------------------------- edición inline

function EditZoneForm({ zone, onSaved }: { zone: ZoneRow; onSaved: () => void }) {
  const [name, setName] = useState(zone.name);
  const [feeType, setFeeType] = useState<DeliveryFeeType>(zone.feeType as DeliveryFeeType);
  const [baseFee, setBaseFee] = useState(zone.baseFee);
  const [perKmFee, setPerKmFee] = useState(zone.perKmFee ?? '');
  const [freeKmThreshold, setFreeKmThreshold] = useState(zone.freeKmThreshold ?? '');
  const [estimatedMinutes, setEstimatedMinutes] = useState(String(zone.estimatedMinutes));
  const [minOrderAmount, setMinOrderAmount] = useState(zone.minOrderAmount ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isByDistance = feeType === 'BY_DISTANCE';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/delivery/zones/${zone.id}`, {
        name: name.trim(),
        feeType,
        baseFee: Number(baseFee),
        estimatedMinutes: Number(estimatedMinutes),
        // perKm/freeKm solo aplican a BY_DISTANCE; en otros tipos no se mandan.
        ...(isByDistance && perKmFee !== '' ? { perKmFee: Number(perKmFee) } : {}),
        ...(isByDistance && freeKmThreshold !== '' ? { freeKmThreshold: Number(freeKmThreshold) } : {}),
        ...(minOrderAmount !== '' ? { minOrderAmount: Number(minOrderAmount) } : {}),
      });
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2 border-t border-border pt-3">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="input w-full" />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Tipo de tarifa</span>
          <select
            value={feeType}
            onChange={(e) => setFeeType(e.target.value as DeliveryFeeType)}
            className="input w-full"
          >
            {Object.values(DELIVERY_FEE_TYPE).map((f) => (
              <option key={f} value={f}>
                {FEE_TYPE_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Tarifa base</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={baseFee}
            onChange={(e) => setBaseFee(e.target.value)}
            required
            className="input w-full"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Tiempo estimado (min)</span>
          <input
            type="number"
            min={1}
            step="1"
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
            required
            className="input w-full"
          />
        </label>
        {isByDistance && (
          <>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Tarifa por km</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={perKmFee}
                onChange={(e) => setPerKmFee(e.target.value)}
                className="input w-full"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Km sin cargo</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={freeKmThreshold}
                onChange={(e) => setFreeKmThreshold(e.target.value)}
                className="input w-full"
              />
            </label>
          </>
        )}
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Pedido mínimo</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(e.target.value)}
            className="input w-full"
          />
        </label>
      </div>
      <button type="submit" disabled={submitting} className="btn btn-primary btn-sm">
        {submitting ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </form>
  );
}
