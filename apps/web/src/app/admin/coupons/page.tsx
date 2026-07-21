'use client';

import { useCallback, useEffect, useState } from 'react';
import { Percent, Plus, Ticket, Wallet } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';
import { CustomersTabs } from '@/components/customers-tabs';

const FALLBACK_COUNTRY_CODE = 'PY';

type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
type Coupon = {
  id: string;
  code: string;
  description: string | null;
  discountType: DiscountType;
  value: string;
  minOrderAmount: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
};

/** Estado que ve el dueño de un vistazo (no sólo `active`). */
function couponState(c: Coupon): { label: string; tone: Tone } {
  if (!c.active) return { label: 'Desactivado', tone: 'neutral' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return { label: 'Vencido', tone: 'error' };
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return { label: 'Agotado', tone: 'warn' };
  return { label: 'Activo', tone: 'ok' };
}

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Alta
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENTAGE');
  const [value, setValue] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<Coupon[]>('/coupons')
      .then(setCoupons)
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    api
      .get<{ countryCode: string }>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.post('/coupons', {
        code,
        description: description.trim() || undefined,
        discountType,
        value: Number(value),
        minOrderAmount: minOrderAmount.trim() ? Number(minOrderAmount) : undefined,
        maxUses: maxUses.trim() ? Number(maxUses) : undefined,
        // <input type="date"> da 'YYYY-MM-DD'; se manda como fin de ese día.
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
      });
      setCode('');
      setDescription('');
      setValue('');
      setMinOrderAmount('');
      setMaxUses('');
      setExpiresAt('');
      setNotice('Cupón creado.');
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(c: Coupon) {
    setError(null);
    try {
      if (c.active) await api.delete(`/coupons/${c.id}`);
      else await api.patch(`/coupons/${c.id}`, { active: true });
      load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Cupones"
        description="Códigos de descuento que tus clientes canjean en la carta online o en la caja."
      />
      <CustomersTabs />

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {notice && <Alert tone="ok" className="mb-4">{notice}</Alert>}

      {/* ---- Alta ---- */}
      <form onSubmit={onCreate} className="panel mb-6 flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CÓDIGO (ej. VUELVE15)"
            required
            minLength={3}
            maxLength={32}
            aria-label="Código del cupón"
            className="input tabular w-full uppercase sm:w-52"
          />
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as DiscountType)}
            aria-label="Tipo de descuento"
            className="input w-full sm:w-44"
          >
            <option value="PERCENTAGE">Porcentaje (%)</option>
            <option value="FIXED_AMOUNT">Monto fijo</option>
          </select>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={discountType === 'PERCENTAGE' ? 100 : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={discountType === 'PERCENTAGE' ? '% a descontar' : 'Monto a descontar'}
            required
            aria-label="Valor del descuento"
            className="input tabular w-full sm:w-40"
          />
        </div>

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descripción interna (opcional) — ej. campaña de win-back"
          maxLength={200}
          className="input w-full"
        />

        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Compra mínima (opcional)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value)}
              placeholder="Sin mínimo"
              className="input tabular w-full"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Límite de usos (opcional)</span>
            <input
              type="number"
              min="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Ilimitado"
              className="input tabular w-full"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Vence (opcional)</span>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="input tabular w-full"
            />
          </label>
        </div>

        <button disabled={saving} className="btn btn-primary self-start">
          <Plus className="h-4 w-4" />
          {saving ? 'Creando...' : 'Crear cupón'}
        </button>
      </form>

      {/* ---- Listado ---- */}
      {loading && <Skeleton className="h-32" />}

      {!loading && coupons.length === 0 && (
        <EmptyState
          icon={Ticket}
          title="Todavía no creaste cupones"
          description="Creá un código arriba (ej. VUELVE15) y mandalo por una campaña de Marketing. El cliente lo canjea en la carta online o te lo muestra en la caja."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {coupons.map((c) => {
          const state = couponState(c);
          return (
            <div key={c.id} className={`card p-4 ${c.active ? '' : 'opacity-60'}`}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="tabular font-heading text-lg font-bold tracking-wide">{c.code}</span>
                <Badge tone={state.tone} dot>
                  {state.label}
                </Badge>
              </div>

              <p className="mb-2 flex items-center gap-1.5 font-medium">
                {c.discountType === 'PERCENTAGE' ? (
                  <>
                    <Percent className="h-4 w-4 text-primary" />
                    {Number(c.value)}% de descuento
                  </>
                ) : (
                  <>
                    <Wallet className="h-4 w-4 text-primary" />
                    {formatMoney(c.value, countryCode)} de descuento
                  </>
                )}
              </p>

              {c.description && <p className="mb-2 text-xs text-muted-foreground">{c.description}</p>}

              <ul className="mb-3 space-y-0.5 text-xs text-muted-foreground">
                <li>
                  Usos:{' '}
                  <span className="tabular text-foreground">
                    {c.usedCount}
                    {c.maxUses !== null ? ` / ${c.maxUses}` : ' (ilimitado)'}
                  </span>
                </li>
                {c.minOrderAmount && (
                  <li>
                    Compra mínima:{' '}
                    <span className="tabular text-foreground">{formatMoney(c.minOrderAmount, countryCode)}</span>
                  </li>
                )}
                {c.expiresAt && (
                  <li>
                    Vence:{' '}
                    <span className="tabular text-foreground">
                      {new Date(c.expiresAt).toLocaleDateString('es-PY')}
                    </span>
                  </li>
                )}
              </ul>

              <button type="button" onClick={() => onToggle(c)} className="btn btn-sm w-full">
                {c.active ? 'Desactivar' : 'Reactivar'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
