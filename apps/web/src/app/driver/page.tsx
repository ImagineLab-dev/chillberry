'use client';

import { ActivarAvisos } from '@/components/activar-avisos';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bike, LogOut, MapPin, Package, Phone, Store } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { connectDeliverySocket } from '@/lib/socket';
import { logout } from '@/lib/auth';
import { DELIVERY_STATUS_LABEL_DRIVER, DELIVERY_STATUS_TONE } from '@/lib/status-labels';
import { Alert, Badge, EmptyState } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/components/toast';

type DriverProfile = { id: string; availability: 'ONLINE' | 'OFFLINE' | 'BUSY' };
type DeliveryItem = {
  id: string;
  status: string;
  addressLine: string;
  deliveryFee: string;
  estimatedMinutes: number | null;
  // OJO: `confirmationCode` NO viaja acá a propósito — el server lo saca de toda
  // respuesta que lea un repartidor. Es el secreto que el cliente le dicta.
  order: {
    total: string;
    customerName: string | null;
    customerPhone: string | null;
    branch: { name: string; address: string };
    items: { id: string; quantity: number; menuItem: { name: string } }[];
  };
};

export default function DriverPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<Record<string, string>>({});
  /** Acción en vuelo: esta pantalla se usa en movimiento, el doble toque es la norma. */
  const [busy, setBusy] = useState(false);
  const [countryCode, setCountryCode] = useState('PY');

  async function loadProfile() {
    const p = await api.get<DriverProfile>('/delivery/drivers/me');
    setProfile(p);
  }

  async function loadDeliveries() {
    const d = await api.get<DeliveryItem[]>('/delivery/orders/available');
    setDeliveries(d);
  }

  useEffect(() => {
    // OJO: estos catch NO pueden quedar vacíos. Si la API está caída, el
    // repartidor ve el EmptyState "No tenés entregas asignadas" y se va a
    // tomar un café con pedidos esperando. Silencio ≠ no hay trabajo.
    loadProfile().catch((err) => setError((err as ApiError).message));
    loadDeliveries().catch(() => setError('No pudimos cargar los datos. Revisá la conexión y reintentá.'));
    api
      .get<{ countryCode: string }>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});

    const socket = connectDeliverySocket();
    socket.on('connect', () => socket.emit('driver:join'));
    socket.on('delivery:assigned', () => {
      // El repartidor casi nunca está mirando la pantalla — sonido urgente +
      // pop-up para que no se pierda una entrega recién asignada.
      notify({
        title: '¡Nueva entrega asignada!',
        description: 'Tenés un pedido para retirar. Tocá para verlo en tu lista.',
        tone: 'info',
        sound: 'assignment',
      });
      loadDeliveries().catch(() => {});
    });

    // Ping de ubicación cada 20s — usa geolocation del navegador si está
    // disponible; si no (o el usuario no dio permiso), no manda nada.
    const locationInterval = setInterval(() => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          api
            .post('/delivery/location', {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speed: pos.coords.speed ?? undefined,
              accuracy: pos.coords.accuracy ?? undefined,
            })
            .catch(() => {});
        },
        () => {},
      );
    }, 20_000);

    return () => {
      socket.disconnect();
      clearInterval(locationInterval);
    };
    // Setup de una sola vez al montar; `notify` es estable (no re-conectar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Corre una acción bloqueando las demás mientras está en vuelo.
   *
   * Esta pantalla se usa en la calle, en el celular, con la moto andando y a
   * veces con guantes: el toque doble es la norma, no la excepción. Sin esto el
   * segundo POST reventaba con un error de transición ("No se puede pasar de
   * PICKED_UP a PICKED_UP") y el repartidor creía que había fallado la entrega.
   */
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function setAvailability(availability: 'ONLINE' | 'OFFLINE' | 'BUSY') {
    await run(async () => {
      const p = await api.patch<DriverProfile>('/delivery/drivers/me/availability', { availability });
      setProfile(p);
    });
  }

  async function onAccept(id: string) {
    await run(async () => {
      await api.post(`/delivery/${id}/accept`);
      await loadDeliveries();
    });
  }

  async function onPickUp(id: string) {
    await run(async () => {
      await api.post(`/delivery/${id}/pick-up`);
      await loadDeliveries();
    });
  }

  async function onDeliver(id: string) {
    await run(async () => {
      await api.post(`/delivery/${id}/deliver`, { confirmationCode: code[id] ?? '' });
      await loadDeliveries();
    });
  }

  // Salida cuando el repartidor NO puede completar la entrega. Antes no existía:
  // un pedido retirado quedaba sin forma de cerrarse desde la app. `FAILED` =
  // lo retiró pero no pudo entregar; `DRIVER_CANCELLED` = lo suelta antes.
  async function onAbort(id: string, status: 'DRIVER_CANCELLED' | 'FAILED') {
    const prompt =
      status === 'FAILED' ? '¿Por qué no pudiste entregar?' : '¿Por qué cancelás esta entrega?';
    const reason = window.prompt(prompt)?.trim();
    // `prompt()` está bloqueado en PWA standalone en iOS y en varios WebViews:
    // ahí devuelve null y el botón no hacía absolutamente nada, sin mensaje, con
    // el pedido colgado. Al menos se lo decimos.
    if (reason === undefined) {
      setError('No pudimos abrir el cuadro para escribir el motivo. Llamá al local para cerrar esta entrega.');
      return;
    }
    if (!reason) return;
    await run(async () => {
      await api.patch(`/delivery/${id}/status`, { status, reason });
      await loadDeliveries();
    });
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  const NEXT_ACTION: Record<string, { label: string; run: (id: string) => void }> = {
    DRIVER_ASSIGNED: { label: 'Aceptar', run: onAccept },
    ACCEPTED: { label: 'Marcar recogido', run: onPickUp },
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bike className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-xl font-semibold">Repartidor</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button onClick={onLogout} className="btn btn-lg" aria-label="Salir">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Salir
          </button>
        </div>
      </header>

      {/* Sin esto, el repartidor sólo se entera de una asignación nueva si deja
          esta pantalla abierta y encendida todo el turno. */}
      <div className="mb-4">
        <ActivarAvisos ruta="push/suscribir" conAuth texto="Avisame cuando me asignen un pedido" />
      </div>

      {error && <Alert tone="error" className="mb-3">{error}</Alert>}

      <div className="mb-4 flex gap-2">
        {(['ONLINE', 'BUSY', 'OFFLINE'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAvailability(a)}
            disabled={busy}
            aria-pressed={profile?.availability === a}
            className={`btn btn-lg flex-1 ${profile?.availability === a ? 'btn-primary' : ''}`}
          >
            {a === 'ONLINE' ? 'Disponible' : a === 'BUSY' ? 'Ocupado' : 'Desconectado'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {deliveries.map((d) => {
          const action = NEXT_ACTION[d.status];
          return (
            <div key={d.id} className="card p-4 text-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-heading text-base font-semibold">{d.order.branch.name}</span>
                <Badge tone={DELIVERY_STATUS_TONE[d.status] ?? 'neutral'} dot>
                  {DELIVERY_STATUS_LABEL_DRIVER[d.status] ?? d.status}
                </Badge>
              </div>
              {/* Las direcciones son EL dato de esta pantalla: se leen al sol,
                  desde una moto. Iban en `muted-foreground`, que es el color
                  para texto secundario. */}
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Store className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Recoger en: <span className="font-medium text-foreground">{d.order.branch.address}</span>
              </p>
              <p className="mb-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Entregar en: <span className="font-medium text-foreground">{d.addressLine}</span>
              </p>

              {/* El nombre y el teléfono ya venían de la API y no se mostraban:
                  el repartidor llegaba al portón, no le abrían, y no tenía a
                  quién llamar desde la app. El `tel:` marca directo. */}
              {(d.order.customerName || d.order.customerPhone) && (
                <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {d.order.customerName && <span className="font-medium">{d.order.customerName}</span>}
                  {d.order.customerPhone && (
                    <a
                      href={`tel:${d.order.customerPhone}`}
                      className="btn btn-sm min-h-[44px] gap-1.5"
                      aria-label={`Llamar a ${d.order.customerName ?? 'el cliente'}`}
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      {d.order.customerPhone}
                    </a>
                  )}
                </p>
              )}
              <ul className="mb-2 text-foreground/90">
                {d.order.items.map((it) => (
                  <li key={it.id}>
                    <span className="tabular">{it.quantity}×</span> {it.menuItem.name}
                  </li>
                ))}
              </ul>
              <p className="tabular mb-3">
                Total pedido {formatMoney(Number(d.order.total), countryCode)} · Fee{' '}
                {formatMoney(Number(d.deliveryFee), countryCode)}
                {d.estimatedMinutes != null && ` · ~${d.estimatedMinutes} min`}
              </p>

              {action && (
                <button onClick={() => action.run(d.id)} disabled={busy} className="btn btn-primary btn-lg w-full">
                  {action.label}
                </button>
              )}

              {/* Cancelar antes de retirar: suelta el pedido (vuelve a reasignarse). */}
              {(d.status === 'DRIVER_ASSIGNED' || d.status === 'ACCEPTED') && (
                <button
                  onClick={() => onAbort(d.id, 'DRIVER_CANCELLED')}
                  disabled={busy}
                  className="btn btn-danger mt-2 w-full"
                >
                  Cancelar entrega
                </button>
              )}

              {d.status === 'PICKED_UP' && (
                <>
                  <div className="flex gap-2">
                    <input
                      value={code[d.id] ?? ''}
                      onChange={(e) => setCode((c) => ({ ...c, [d.id]: e.target.value }))}
                      placeholder="Código del cliente"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      aria-label="Código de confirmación que te dicta el cliente"
                      className="input flex-1"
                    />
                    <button onClick={() => onDeliver(d.id)} disabled={busy} className="btn btn-primary btn-lg">
                      Confirmar entrega
                    </button>
                  </div>
                  {/* Retiró el pedido pero no puede entregar (cliente ausente, etc.) */}
                  <button
                    onClick={() => onAbort(d.id, 'FAILED')}
                    disabled={busy}
                    className="btn btn-danger mt-2 w-full"
                  >
                    No pude entregar
                  </button>
                </>
              )}
            </div>
          );
        })}
        {deliveries.length === 0 && (
          <EmptyState icon={Package} title="No tenés entregas asignadas" description="Cuando te asignen un pedido, aparece acá." />
        )}
      </div>
    </main>
  );
}
