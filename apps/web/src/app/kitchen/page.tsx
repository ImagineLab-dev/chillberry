'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import {
  AlertTriangle,
  Bike,
  Check,
  ChefHat,
  Clock,
  LogOut,
  Printer,
  RotateCcw,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { KITCHEN_TASK_DELAY_MINUTES, STATION_LABELS, type KitchenTaskStatus, type StationType } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { printKitchenTicket } from '@/lib/tickets';
import { connectKitchenSocket } from '@/lib/socket';
import { offlineQueue } from '@/lib/offline-queue';
import { logout } from '@/lib/auth';
import { Badge } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/components/toast';

type Branch = { id: string; name: string };
type Station = { id: string; type: StationType; name: string };
type Task = {
  id: string;
  status: KitchenTaskStatus;
  createdAt: string;
  station: Station;
  order: { id: string; notes: string | null; type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'; table: { code: string } | null };
  items: {
    id: string;
    quantity: number;
    round: number;
    notes: string | null;
    modifiers: OrderItemModifier[] | null;
    menuItem: {
      name: string;
      /** Un combo se arma con varios productos; el cocinero necesita saber
       *  cuáles. `isCombo` sólo controla si se muestran los componentes. */
      isCombo: boolean;
      comboComponents: { quantity: number; component: { name: string } }[];
    };
  }[];
};

/** Snapshot que guarda `OrderItem.modifiers` al crear el pedido. */
type OrderItemModifier = { groupName: string; optionName: string; priceDelta: string };

const COLUMNS: {
  status: KitchenTaskStatus;
  title: string;
  icon: LucideIcon;
  action?: { label: string; next: KitchenTaskStatus };
}[] = [
  { status: 'NEW', title: 'NUEVOS', icon: ChefHat, action: { label: 'Tomar pedido', next: 'IN_PROGRESS' } },
  { status: 'IN_PROGRESS', title: 'EN PREPARACIÓN', icon: Clock, action: { label: 'Marcar listo', next: 'READY' } },
  { status: 'READY', title: 'LISTOS', icon: Check, action: { label: 'Entregado', next: 'DELIVERED' } },
  { status: 'DELIVERED', title: 'ENTREGADOS', icon: Check },
];

// Estado anterior para el "Deshacer" (recall) — NEW no retrocede.
const PREV_STATUS: Partial<Record<KitchenTaskStatus, KitchenTaskStatus>> = {
  IN_PROGRESS: 'NEW',
  READY: 'IN_PROGRESS',
  DELIVERED: 'READY',
};

export default function KitchenPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [queueSize, setQueueSize] = useState(0);
  /** El último intento de traer el tablero falló: lo que se ve puede estar
   *  viejo. Es distinto de `offline` (que mira el navegador): con wifi ok y la
   *  API caída, `offline` es false y el tablero igual está desactualizado. */
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  // Filtro por estación: cada pantalla de cocina (parrilla, bebidas, etc.) ve
  // solo lo suyo. Se persiste por dispositivo en localStorage. Init 'ALL' para
  // no romper la hidratación; el valor guardado se lee en un effect.
  const [stationFilter, setStationFilter] = useState<StationType | 'ALL'>('ALL');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('kds-station');
    if (saved) setStationFilter(saved as StationType | 'ALL');
  }, []);

  function changeStation(v: StationType | 'ALL') {
    setStationFilter(v);
    localStorage.setItem('kds-station', v);
  }

  const loadBoard = useCallback(async (forBranchId: string) => {
    if (!forBranchId) return;
    try {
      const board = await api.get<Task[]>('/kitchen/board', { query: { branchId: forBranchId } });
      setTasks(board);
      setStale(false);
    } catch {
      // La vista sigue mostrando el último estado conocido, PERO se marca como
      // desactualizada: el badge "Sin conexión" mira `navigator.onLine`, así que
      // con wifi ok y API caída el tablero se veía congelado y al día. Y el
      // contador de minutos sigue corriendo (es local), lo que refuerza el
      // engaño.
      setStale(true);
    }
  }, []);

  // Carga de sucursales + selección inicial.
  useEffect(() => {
    api
      .get<Branch[]>('/branches')
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch(() => {});
  }, []);

  // Reloj para "retrasado" + intento periódico de sincronizar la cola offline.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const sync = setInterval(async () => {
      const { synced } = await offlineQueue.flush();
      setQueueSize(offlineQueue.size());
      if (synced > 0 && branchId) await loadBoard(branchId);
    }, 8_000);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setOffline(!navigator.onLine);
    setQueueSize(offlineQueue.size());
    return () => {
      clearInterval(clock);
      clearInterval(sync);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [branchId, loadBoard]);

  // Board inicial + socket en tiempo real por sucursal.
  useEffect(() => {
    if (!branchId) return;
    loadBoard(branchId);

    const socket = connectKitchenSocket();
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('kitchen:join', { branchId }));
    socket.on('kitchen:task:created', () => {
      notify({ title: 'Nuevo pedido en cocina', tone: 'info', sound: 'new-order' });
      loadBoard(branchId);
    });
    socket.on('kitchen:task:updated', () => loadBoard(branchId));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [branchId, loadBoard, notify]);

  async function advance(task: Task, nextStatus: KitchenTaskStatus) {
    // Optimista: la cocina necesita feedback instantáneo, no esperar el round-trip.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      await api.patch(`/kitchen/tasks/${task.id}/status`, { status: nextStatus });
    } catch (err) {
      const status = (err as ApiError).status;
      if (status === undefined) {
        // Fallo de red (no una respuesta del server con error) — encolar y reintentar luego.
        offlineQueue.enqueue(task.id, nextStatus);
        setQueueSize(offlineQueue.size());
      } else {
        // El server rechazó la transición — revertir el optimismo Y AVISAR. Sin
        // el aviso la comanda saltaba sola a la columna anterior sin ningún
        // mensaje: el cocinero volvía a tocar, volvía a saltar, y terminaba
        // gritando al salón. El backend manda el motivo en castellano.
        notify({
          title: 'No se pudo avanzar la comanda',
          description: (err as ApiError).message,
          tone: 'error',
          sound: 'alert',
        });
        await loadBoard(branchId);
      }
    }
  }

  // "Deshacer" (recall): retrocede la tarea un paso. Optimista igual que
  // `advance`; si el server rechaza (ej. pedido ya cobrado), se recarga.
  async function recall(task: Task) {
    const prev = PREV_STATUS[task.status];
    if (!prev) return;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, status: prev } : t)));
    try {
      await api.post(`/kitchen/tasks/${task.id}/recall`);
    } catch (err) {
      notify({
        title: 'No se pudo deshacer',
        description: (err as ApiError).message,
        tone: 'error',
        sound: 'alert',
      });
      await loadBoard(branchId);
    }
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  const byStatus = (status: KitchenTaskStatus) =>
    tasks.filter((t) => t.status === status && (stationFilter === 'ALL' || t.station.type === stationFilter));

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <ChefHat className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-xl font-semibold">Cocina — KDS</h1>
        </div>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          aria-label="Sucursal"
          className="input min-w-[8rem] flex-1 text-base sm:flex-none"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={stationFilter}
          onChange={(e) => changeStation(e.target.value as StationType | 'ALL')}
          className="input text-base"
          aria-label="Filtrar por estación"
        >
          <option value="ALL">Todas las estaciones</option>
          {(Object.keys(STATION_LABELS) as StationType[]).map((s) => (
            <option key={s} value={s}>
              {STATION_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-3">
          {offline && (
            <Badge tone="error">
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              Sin conexión
            </Badge>
          )}
          {!offline && stale && (
            <Badge tone="warn">
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              Sin actualizar — puede haber comandas nuevas
            </Badge>
          )}
          {queueSize > 0 && (
            <Badge tone="warn">
              {queueSize === 1 ? '1 acción por sincronizar' : `${queueSize} acciones por sincronizar`}
            </Badge>
          )}
          <ThemeToggle />
          <button onClick={onLogout} className="btn btn-lg" aria-label="Salir">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Salir
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-3 overflow-x-auto p-4">
        {/* `card-dense`: escala de clay contenida. Con 40 comandas en 4 columnas,
            el radio y la sombra generosos se comen el contenido, y esto se lee a
            2 metros con las manos ocupadas. */}
        {COLUMNS.map((col) => (
          <div key={col.status} className="card card-dense flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 font-heading text-base font-semibold tracking-wide">
              <col.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {col.title}
              <span className="tabular ml-auto text-muted-foreground">{byStatus(col.status).length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {byStatus(col.status).map((task) => {
                const elapsedMin = Math.floor((now - new Date(task.createdAt).getTime()) / 60_000);
                const delayed =
                  (task.status === 'NEW' || task.status === 'IN_PROGRESS') && elapsedMin >= KITCHEN_TASK_DELAY_MINUTES;
                return (
                  <div
                    key={task.id}
                    className={`card card-dense overflow-hidden ${delayed ? 'border-error ring-2 ring-error' : ''}`}
                  >
                    {/* "Retrasado" ocupa el ancho completo y va en color pleno: se
                        tiene que ver de reojo desde el otro lado de la cocina. */}
                    {delayed && (
                      <div className="flex items-center gap-2 bg-destructive px-3 py-1.5 font-heading text-base font-bold uppercase tracking-wide text-destructive-foreground">
                        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
                        Retrasado
                      </div>
                    )}
                    <div className="p-3">
                      <div className="mb-2 flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-2 font-heading text-2xl font-bold leading-none">
                          {/* Sin mesa: distinguir retiro en mostrador de delivery.
                              Antes ambos decían "Takeaway" y el cocinero no sabía
                              cuál empaquetar para el repartidor. */}
                          {task.order.table
                            ? `Mesa ${task.order.table.code}`
                            : task.order.type === 'DELIVERY'
                              ? 'Delivery'
                              : 'Retiro'}
                          {!task.order.table && task.order.type === 'DELIVERY' && (
                            <Badge tone="info">
                              <Bike className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Delivery</span>
                            </Badge>
                          )}
                        </span>
                        <span
                          className={`tabular text-lg font-semibold ${delayed ? 'text-error' : 'text-muted-foreground'}`}
                        >
                          {elapsedMin} min
                        </span>
                      </div>
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <Badge tone="info">{STATION_LABELS[task.station.type]}</Badge>
                        {/* "Ronda N": el cocinero tiene que saber que esto es un
                            agregado a una mesa ya servida, no un pedido nuevo. */}
                        {task.items[0] && task.items[0].round > 1 && (
                          <Badge tone="warn">Ronda {task.items[0].round}</Badge>
                        )}
                      </div>
                      {/* Nota general del pedido ("somos alérgicos al maní"):
                          aplica a TODOS los platos, así que va arriba de la lista
                          y no colgada de un ítem. */}
                      {task.order.notes && (
                        <div className="mb-2 flex items-start gap-1.5 rounded-md border border-error/30 bg-error/15 px-2 py-1.5 text-base font-semibold text-error-foreground">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          {task.order.notes}
                        </div>
                      )}
                      <ul className="mb-3 space-y-1.5">
                        {task.items.map((it) => (
                          <li key={it.id} className="text-lg font-medium leading-snug">
                            <span className="tabular">{it.quantity}×</span> {it.menuItem.name}
                            {it.menuItem.isCombo && (
                              <>
                                {' '}
                                <Badge tone="primary">Combo</Badge>
                              </>
                            )}
                            {/* Combo: qué lleva, para que el cocinero sepa qué
                                armar. Va en línea chica bajo el nombre. */}
                            {it.menuItem.isCombo && it.menuItem.comboComponents.length > 0 && (
                              <span className="mt-0.5 block text-base font-normal text-muted-foreground">
                                {it.menuItem.comboComponents
                                  .map((c) => `${c.quantity}× ${c.component.name}`)
                                  .join(' · ')}
                              </span>
                            )}
                            {/* Extras elegidos por el comensal — cambian lo que
                                hay que cocinar, así que van pegados al ítem. */}
                            {it.modifiers && it.modifiers.length > 0 && (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {it.modifiers.map((m, i) => (
                                  <Badge key={`${it.id}-${i}`} tone="info">
                                    {m.optionName}
                                  </Badge>
                                ))}
                              </span>
                            )}
                            {/* Las notas son el motivo por el que un plato vuelve:
                                bloque propio y con color, nunca un paréntesis gris. */}
                            {it.notes && (
                              <span className="mt-1 flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/15 px-2 py-1 text-base font-semibold text-warn-foreground">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                {it.notes}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {col.action && (
                        <button
                          onClick={() => advance(task, col.action!.next)}
                          className="btn btn-primary btn-lg w-full font-semibold"
                        >
                          {col.action.label}
                        </button>
                      )}
                      {/* Deshacer: sólo si la tarea no está en el primer estado.
                          El cocinero corrige un avance disparado por error. */}
                      {col.status !== 'NEW' && (
                        <button
                          onClick={() => recall(task)}
                          className="btn btn-ghost btn-lg mt-2 w-full"
                          aria-label="Deshacer último avance"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Deshacer
                        </button>
                      )}
                      <button
                        onClick={() =>
                          printKitchenTicket({
                            station: STATION_LABELS[task.station.type],
                            type: task.order.type,
                            tableCode: task.order.table?.code ?? null,
                            orderNotes: task.order.notes,
                            items: task.items.map((it) => ({
                              quantity: it.quantity,
                              notes: it.notes,
                              modifiers: it.modifiers,
                              menuItem: { name: it.menuItem.name },
                            })),
                            now: new Date(),
                          })
                        }
                        className="btn btn-lg mt-2 w-full"
                        aria-label="Imprimir comanda"
                      >
                        <Printer className="h-4 w-4" />
                        Imprimir comanda
                      </button>
                    </div>
                  </div>
                );
              })}
              {byStatus(col.status).length === 0 && <p className="p-2 text-base text-muted-foreground">Sin pedidos</p>}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
