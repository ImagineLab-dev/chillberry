'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, PageHeader } from '@/components/ui';
import { DeliveryBoard } from '@/components/delivery-board';
import { DeliveryDrivers } from '@/components/delivery-drivers';
import { DeliveryZones } from '@/components/delivery-zones';

const FALLBACK_COUNTRY_CODE = 'PY';

type Branch = { id: string; name: string };
type TenantSettings = { countryCode: string };

const TABS = [
  { id: 'board', label: 'Despachos' },
  { id: 'drivers', label: 'Repartidores' },
  { id: 'zones', label: 'Zonas de envío' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function DeliveryPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);
  const [tab, setTab] = useState<TabId>('board');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Branch[]>('/branches')
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch((err) => setError((err as ApiError).message));
    api
      .get<TenantSettings>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title="Delivery"
        description="Despachá pedidos, asigná repartidores y configurá tus zonas de envío."
      />

      <div className="mb-6 space-y-1.5">
        <label className="label" htmlFor="del-branch">
          Sucursal
        </label>
        <select
          id="del-branch"
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

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {/* Pestañas — el board vive en la sucursal; repartidores es a nivel tenant. */}
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Secciones de delivery">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'board' && <DeliveryBoard branchId={branchId} countryCode={countryCode} />}
      {tab === 'drivers' && <DeliveryDrivers />}
      {tab === 'zones' && <DeliveryZones branchId={branchId} countryCode={countryCode} />}
    </div>
  );
}
