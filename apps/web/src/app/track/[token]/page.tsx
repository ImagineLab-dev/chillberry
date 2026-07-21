'use client';

import { ActivarAvisos } from '@/components/activar-avisos';
import { use, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { io } from 'socket.io-client';
import { Bike, CheckCircle2, MapPin, Package, Star, XCircle } from 'lucide-react';
import { Alert, Skeleton, type Tone } from '@/components/ui';

// Mapa embebido: Leaflet necesita `window`, así que se carga solo en el cliente.
const LiveMap = dynamic(() => import('@/components/live-map'), { ssr: false });

type Tracking = {
  status: string;
  estimatedMinutes: number | null;
  driverName: string | null;
  location: { lat: number; lng: number } | null;
  /** La casa del cliente, para poder encuadrar el mapa con los dos extremos. */
  destino: { lat: number; lng: number } | null;
  /** Camino por las calles. Null si el ruteo no está configurado o falló. */
  route: Array<[number, number]> | null;
  routeDistanceM: number | null;
  /** Minutos que estima el motor de ruteo desde la posición REAL del repartidor. */
  routeMinutes: number | null;
  /** El cliente puede calificar (entregado y sin calificar aún). */
  canRate: boolean;
  rated: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Buscando repartidor...',
  DRIVER_ASSIGNED: 'Repartidor asignado, esperando que acepte',
  ACCEPTED: 'Tu pedido va en camino a ser retirado',
  PICKED_UP: 'Tu pedido está en camino',
  DELIVERED: 'Entregado',
  DRIVER_CANCELLED: 'Cancelado por el repartidor',
  CUSTOMER_CANCELLED: 'Cancelado',
  RESTAURANT_CANCELLED: 'Cancelado por el restaurante',
  FAILED: 'No se pudo completar la entrega',
};

// Ícono + color por estado: esta pantalla se mira muchas veces seguidas
// mientras se espera, así que el estado tiene que leerse de un vistazo sin
// tener que leer la frase entera.
const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  PENDING: Package,
  DRIVER_ASSIGNED: Bike,
  ACCEPTED: Bike,
  PICKED_UP: Bike,
  DELIVERED: CheckCircle2,
  DRIVER_CANCELLED: XCircle,
  CUSTOMER_CANCELLED: XCircle,
  RESTAURANT_CANCELLED: XCircle,
  FAILED: XCircle,
};

const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'neutral',
  DRIVER_ASSIGNED: 'warn',
  ACCEPTED: 'info',
  PICKED_UP: 'info',
  DELIVERED: 'ok',
  DRIVER_CANCELLED: 'error',
  CUSTOMER_CANCELLED: 'error',
  RESTAURANT_CANCELLED: 'error',
  FAILED: 'error',
};

// Mismos pares tinte/texto que usan los badges en globals.css — heredan tema.
const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok-foreground',
  warn: 'bg-warn/15 text-warn-foreground',
  info: 'bg-info/15 text-info-foreground',
  error: 'bg-error/15 text-error-foreground',
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/15 text-primary',
};

export default function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  // El parámetro es el `trackingToken`, no el id del delivery. El id lo conocen
  // el staff y el repartidor: con él, el repartidor podía calificarse 5/5 a sí
  // mismo antes que el cliente.
  const { token } = use(params);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Calificación del repartidor (aparece al entregarse).
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);

  async function submitRating() {
    if (rating < 1) return;
    setRatingBusy(true);
    try {
      const res = await fetch(`${API_BASE}/track/${token}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: ratingComment.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      setRatingDone(true);
    } catch {
      // Silencioso: si falla, el cliente puede reintentar; no es crítico.
    } finally {
      setRatingBusy(false);
    }
  }

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/track/${token}`);
      if (!res.ok) throw new Error('No se encontró el pedido');
      setTracking(await res.json());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load().catch(() => {});

    const socket = io(`${SOCKET_URL}/delivery`, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('delivery:track', { trackingToken: token }));
    socket.on('delivery:updated', () => load());
    socket.on('driver:location', (payload: { lat: number; lng: number }) => {
      setTracking((prev) => (prev ? { ...prev, location: payload } : prev));
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const StatusIcon = tracking ? (STATUS_ICON[tracking.status] ?? Package) : Package;
  const tone: Tone = tracking ? (STATUS_TONE[tracking.status] ?? 'neutral') : 'neutral';

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="panel w-full max-w-sm p-6 text-center">
        <h1 className="mb-6 font-heading text-lg font-semibold text-foreground">Seguimiento de tu pedido</h1>

        {error && (
          <Alert tone="error" className="text-left">
            {error}
          </Alert>
        )}

        {!tracking && !error && (
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}

        {tracking && (
          <div className="animate-fade-in">
            <div
              className={`mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}
            >
              <StatusIcon className="h-9 w-9" />
            </div>

            <p className="font-heading text-xl font-semibold text-foreground">
              {STATUS_LABEL[tracking.status] ?? tracking.status}
            </p>

            {/* Se prefiere el tiempo del motor de ruteo: sale de dónde está el
                repartidor AHORA. `estimatedMinutes` es el compromiso que cargó
                el restaurante para la zona y no se recalcula nunca, así que
                sólo se muestra cuando no hay ruta. */}
            {tracking.routeMinutes != null ? (
              <p className="mt-3 text-base text-muted-foreground">
                Llega en{' '}
                <span className="tabular font-semibold text-foreground">~{tracking.routeMinutes} min</span>
                {tracking.routeDistanceM != null && (
                  <span className="tabular"> · a {(tracking.routeDistanceM / 1000).toFixed(1)} km</span>
                )}
              </p>
            ) : (
              tracking.estimatedMinutes != null && (
                <p className="mt-3 text-base text-muted-foreground">
                  Tiempo estimado:{' '}
                  <span className="tabular font-semibold text-foreground">~{tracking.estimatedMinutes} min</span>
                </p>
              )
            )}

            {/* Avisos al teléfono: es lo que reemplaza al WhatsApp. Sin esto,
                quien cierra la pestaña no se entera de nada hasta volver. */}
            <div className="mt-4">
              <ActivarAvisos ruta={`push/suscribir/seguimiento/${token}`} />
            </div>

            {tracking.driverName && (
              <p className="mt-1 text-base text-muted-foreground">
                Repartidor: <span className="font-medium text-foreground">{tracking.driverName}</span>
              </p>
            )}

            {tracking.location && (
              <div className="mt-5">
                {/* Mapa embebido en vivo: el punto del repartidor se mueve con
                    cada `driver:location` que llega por el socket. */}
                <LiveMap
                  points={[
                    {
                      id: 'driver',
                      lat: tracking.location.lat,
                      lng: tracking.location.lng,
                      label: tracking.driverName ?? 'Repartidor',
                      kind: 'driver',
                    },
                    ...(tracking.destino
                      ? [
                          {
                            id: 'destino',
                            lat: tracking.destino.lat,
                            lng: tracking.destino.lng,
                            label: 'Tu dirección',
                            kind: 'destino' as const,
                          },
                        ]
                      : []),
                  ]}
                  route={tracking.route}
                  height={220}
                />
                <a
                  href={`https://maps.google.com/?q=${tracking.location.lat},${tracking.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn mt-2 w-full"
                >
                  <MapPin className="h-4 w-4" />
                  Abrir en Google Maps
                </a>
              </div>
            )}

            {/* Calificación del repartidor: aparece al entregarse. */}
            {(tracking.canRate || ratingDone || tracking.rated) && (
              <div className="mt-6 border-t border-border pt-5">
                {ratingDone || tracking.rated ? (
                  <p className="text-sm text-muted-foreground">¡Gracias por calificar tu entrega! 🙌</p>
                ) : (
                  <>
                    <p className="mb-2 text-sm font-medium text-foreground">¿Cómo estuvo tu entrega?</p>
                    <div className="mb-3 flex justify-center gap-1.5" role="group" aria-label="Calificación">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          aria-label={`${star} estrella${star > 1 ? 's' : ''}`}
                          className="p-0.5 transition-transform hover:scale-110"
                        >
                          <Star
                            className={`h-9 w-9 ${
                              star <= (hoverRating || rating)
                                ? 'fill-warn text-warn'
                                : 'text-muted-foreground/40'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={ratingComment}
                      onChange={(e) => setRatingComment(e.target.value)}
                      placeholder="¿Algún comentario? (opcional)"
                      maxLength={500}
                      rows={2}
                      className="input mb-3 w-full resize-none text-sm"
                      aria-label="Comentario de la entrega"
                    />
                    <button
                      type="button"
                      onClick={submitRating}
                      disabled={rating < 1 || ratingBusy}
                      className="btn btn-primary w-full"
                    >
                      {ratingBusy ? 'Enviando...' : 'Enviar calificación'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
