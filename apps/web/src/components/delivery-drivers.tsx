'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Bike, MapPin, Power, UserPlus, Users } from 'lucide-react';

// Leaflet solo en cliente (necesita window).
const LiveMap = dynamic(() => import('@/components/live-map'), { ssr: false });
import { api, type ApiError } from '@/lib/api-client';
import { connectDeliverySocket } from '@/lib/socket';
import { VEHICLE_TYPE, formatMoney, type VehicleType } from '@chillberry/domain';
import { Alert, Badge, EmptyState, Skeleton, type Tone } from '@/components/ui';
import { useToast } from '@/components/toast';

// ----------------------------------------------------------------- tipos

type DriverRow = {
  id: string;
  phone: string;
  vehicleType: string;
  licensePlate: string | null;
  availability: string;
  activeDeliveriesCount: number;
  ratingAvg: string | null;
  totalDeliveries: number;
  totalCancellations: number;
  user: { name: string; email: string; active: boolean };
};

type LiveDriver = {
  id: string;
  name: string;
  availability: string;
  vehicleType: string;
  activeDeliveriesCount: number;
  location: { lat: string; lng: string; recordedAt: string } | null;
};

// --------------------------------------------------------- vocabulario

const VEHICLE_LABEL: Record<VehicleType, string> = {
  MOTORCYCLE: 'Moto',
  BICYCLE: 'Bicicleta',
  CAR: 'Auto',
  ON_FOOT: 'A pie',
};

const AVAILABILITY_META: Record<string, { label: string; tone: Tone }> = {
  ONLINE: { label: 'En línea', tone: 'ok' },
  BUSY: { label: 'Ocupado', tone: 'warn' },
  OFFLINE: { label: 'Desconectado', tone: 'neutral' },
};

// --------------------------------------------------------- sección

type Earning = {
  driverId: string;
  driverName: string;
  deliveries: number;
  fees: number;
  avgRating: number | null;
  cancellations: number;
};

export function DeliveryDrivers() {
  const { notify } = useToast();
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [live, setLive] = useState<LiveDriver[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [countryCode, setCountryCode] = useState('PY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<DriverRow[]>('/delivery/drivers'),
      api.get<LiveDriver[]>('/delivery/drivers/map').catch(() => [] as LiveDriver[]),
      // Liquidación de todo el histórico (sin rango) — resumen para el dueño.
      api.get<Earning[]>('/delivery/drivers/earnings').catch(() => [] as Earning[]),
    ])
      .then(([roster, map, earn]) => {
        setDrivers(roster);
        setLive(map);
        setEarnings(earn);
      })
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

  // Refresco en vivo de posiciones: el mapa de repartidores se actualiza cada
  // 15s sin recargar todo el roster (el ping de geolocation del driver es cada 20s).
  useEffect(() => {
    const t = setInterval(() => {
      api.get<LiveDriver[]>('/delivery/drivers/map').then(setLive).catch(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  // Aviso EN VIVO al despachador: entró un delivery nuevo. El panel es
  // tenant-wide, pero las rooms del gateway son por sucursal, así que nos
  // unimos a la de cada sucursal del tenant. Los que quedan SIN repartidor
  // (unassigned) suenan con alerta — son los que requieren acción manual.
  useEffect(() => {
    let socket: ReturnType<typeof connectDeliverySocket> | null = null;
    let cancelled = false;
    api
      .get<{ id: string }[]>('/branches')
      .then((branches) => {
        if (cancelled) return;
        socket = connectDeliverySocket();
        const joinAll = () => branches.forEach((b) => socket?.emit('dispatcher:join', { branchId: b.id }));
        socket.on('connect', joinAll);
        socket.on('delivery:new', (payload: { unassigned?: boolean; addressLine?: string }) => {
          notify({
            title: payload.unassigned ? 'Nuevo delivery SIN repartidor' : 'Nuevo delivery asignado',
            description: payload.unassigned
              ? `${payload.addressLine ?? 'Pedido'} — asigná un repartidor a mano.`
              : payload.addressLine ?? 'Pedido en camino de asignarse.',
            tone: payload.unassigned ? 'warn' : 'info',
            sound: payload.unassigned ? 'alert' : 'new-order',
          });
          api.get<LiveDriver[]>('/delivery/drivers/map').then(setLive).catch(() => {});
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onToggleActive(d: DriverRow) {
    const goingInactive = d.user.active;
    if (goingInactive && !confirm(`¿Dar de baja a ${d.user.name}? No podrá iniciar sesión ni recibir pedidos.`)) {
      return;
    }
    setTogglingId(d.id);
    setError(null);
    try {
      await api.patch(`/delivery/drivers/${d.id}/active`, { active: !d.user.active });
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setTogglingId(null);
    }
  }

  const onlineNow = live.filter((d) => d.availability === 'ONLINE');

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {error && <Alert tone="error">{error}</Alert>}

        {/* Mapa en vivo (GET /delivery/drivers/map, refresco cada 15s): posición
            de cada repartidor en línea con link a Google Maps. */}
        {!loading && (
          <div className="card-dense card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">En línea ahora</span>
              <span className="tabular font-heading text-xl font-semibold">{onlineNow.length}</span>
            </div>
            {(() => {
              const pts = onlineNow
                .filter((d) => d.location)
                .map((d) => ({
                  id: d.id,
                  lat: Number(d.location!.lat),
                  lng: Number(d.location!.lng),
                  label: d.name,
                  kind: 'driver' as const,
                }));
              return pts.length > 0 ? (
                <div className="mt-3">
                  <LiveMap points={pts} height={260} />
                </div>
              ) : null;
            })()}
            {onlineNow.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Ningún repartidor en línea.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {onlineNow.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="font-medium text-foreground">{d.name}</span>
                      <span className="text-xs text-muted-foreground">· {d.activeDeliveriesCount} activas</span>
                    </span>
                    {d.location ? (
                      <a
                        href={`https://www.google.com/maps?q=${d.location.lat},${d.location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        title={`Actualizado ${new Date(d.location.recordedAt).toLocaleTimeString()}`}
                      >
                        Ver en mapa
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">sin posición</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        )}

        {!loading && drivers.length === 0 && (
          <EmptyState
            icon={Users}
            title="Todavía no hay repartidores"
            description="Dá de alta a tu primer repartidor con el formulario de la derecha para empezar a despachar."
          />
        )}

        {!loading &&
          drivers.map((d) => {
            const avail = AVAILABILITY_META[d.availability] ?? { label: d.availability, tone: 'neutral' as Tone };
            return (
              <div key={d.id} className={`card p-4 text-sm ${d.user.active ? '' : 'opacity-60'}`}>
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-base font-semibold">{d.user.name}</span>
                      {d.user.active ? (
                        <Badge tone={avail.tone} dot>
                          {avail.label}
                        </Badge>
                      ) : (
                        <Badge tone="error" dot>
                          De baja
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground">{d.user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">
                      <Bike className="h-3.5 w-3.5" aria-hidden="true" />
                      {VEHICLE_LABEL[d.vehicleType as VehicleType] ?? d.vehicleType}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => onToggleActive(d)}
                      disabled={togglingId === d.id}
                      className={`btn btn-sm ${d.user.active ? 'btn-danger' : ''}`}
                      title={d.user.active ? 'Dar de baja al repartidor' : 'Reactivar al repartidor'}
                    >
                      <Power className="h-4 w-4" />
                      {togglingId === d.id ? '...' : d.user.active ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{d.phone}</span>
                  {d.licensePlate && <span>Patente {d.licensePlate}</span>}
                  <span className="tabular">Activas: {d.activeDeliveriesCount}</span>
                  <span className="tabular">Entregadas: {d.totalDeliveries}</span>
                  <span className="tabular">Canceladas: {d.totalCancellations}</span>
                  {d.ratingAvg && <span className="tabular">★ {Number(d.ratingAvg).toFixed(1)}</span>}
                </div>
              </div>
            );
          })}
      </div>

      <div className="lg:col-span-1">
        <OnboardDriverForm onCreated={load} />
      </div>

      {/* Liquidación por repartidor: entregas completadas + tarifas generadas +
          calificación promedio (histórico). Lo que el dueño mira para pagar. */}
      {earnings.length > 0 && (
        <section className="card p-5 lg:col-span-3">
          <h3 className="mb-4 font-heading text-base font-semibold">Liquidación por repartidor</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Repartidor</th>
                  <th className="pb-2 text-right font-medium">Entregas</th>
                  <th className="pb-2 text-right font-medium">Tarifas generadas</th>
                  <th className="pb-2 text-right font-medium">Calificación</th>
                  <th className="pb-2 text-right font-medium">Cancelaciones</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.driverId} className="border-b border-border/60">
                    <td className="py-2 font-medium">{e.driverName}</td>
                    <td className="tabular py-2 text-right">{e.deliveries}</td>
                    <td className="tabular py-2 text-right font-medium">{formatMoney(e.fees, countryCode)}</td>
                    <td className="tabular py-2 text-right text-muted-foreground">
                      {e.avgRating != null ? `★ ${e.avgRating.toFixed(1)}` : '—'}
                    </td>
                    <td className="tabular py-2 text-right text-muted-foreground">{e.cancellations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// --------------------------------------------------------- alta

function OnboardDriverForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [licensePlate, setLicensePlate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setOk(false);
    try {
      await api.post('/delivery/drivers', {
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        vehicleType,
        ...(licensePlate.trim() ? { licensePlate: licensePlate.trim() } : {}),
      });
      setName('');
      setEmail('');
      setPassword('');
      setPhone('');
      setVehicleType('MOTORCYCLE');
      setLicensePlate('');
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
        <UserPlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        Dar de alta repartidor
      </h2>

      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="ok">Repartidor dado de alta. Ya puede iniciar sesión y ponerse en línea.</Alert>}

      <div className="space-y-1.5">
        <label className="label" htmlFor="drv-name">
          Nombre
        </label>
        <input
          id="drv-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          className="input w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="drv-email">
          Email
        </label>
        <input
          id="drv-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="input w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="drv-password">
          Contraseña
        </label>
        <input
          id="drv-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={72}
          className="input w-full"
        />
        <p className="text-xs text-muted-foreground">Mínimo 8 caracteres. Se la das al repartidor para su login.</p>
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="drv-phone">
          Teléfono
        </label>
        <input
          id="drv-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          minLength={6}
          maxLength={30}
          className="input w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="drv-vehicle">
          Vehículo
        </label>
        <select
          id="drv-vehicle"
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
          className="input w-full"
        >
          {Object.values(VEHICLE_TYPE).map((v) => (
            <option key={v} value={v}>
              {VEHICLE_LABEL[v]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="label" htmlFor="drv-plate">
          Patente (opcional)
        </label>
        <input
          id="drv-plate"
          value={licensePlate}
          onChange={(e) => setLicensePlate(e.target.value)}
          maxLength={20}
          className="input w-full"
        />
      </div>

      <button type="submit" disabled={submitting} className="btn btn-primary btn-lg w-full">
        {submitting ? 'Dando de alta…' : 'Dar de alta'}
      </button>
    </form>
  );
}
