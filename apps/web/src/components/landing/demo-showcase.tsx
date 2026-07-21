'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bike,
  Check,
  ChefHat,
  Clock,
  LayoutDashboard,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Star,
  Store,
  Users,
} from 'lucide-react';

/**
 * Demos de producto para la landing. Cada pestaña es una ESCENA que avanza sola
 * paso a paso, así se ve el producto en uso y no una captura quieta: entra la
 * comanda y viaja por el tablero, el dueño pasa de las métricas al reporte y al
 * control, el cliente elige, pide y sigue su pedido hasta calificarlo.
 *
 * Reglas que se respetan acá:
 *  - Nada puede mostrar una función que el producto no tenga. Cada escena se
 *    auditó contra su pantalla real; si cambia el producto, esto se actualiza.
 *  - La reproducción es controlable (pausa + saltar a un paso) y no arranca sola
 *    si el visitante pidió menos movimiento: contenido que se mueve solo sin
 *    control es una barrera de accesibilidad, no un adorno.
 *  - Los mockups conservan su ancho de escritorio y scrollean DENTRO del marco;
 *    la página nunca scrollea de costado.
 */

type TabKey = 'cocina' | 'mesero' | 'owner' | 'repartidor' | 'cliente';

const STEP_MS = 2600;

// ------------------------------------------------------------------ helpers

/**
 * Avanza el paso solo. Cuando la escena termina NO vuelve a empezar: llama a
 * `onFinish` para que el recorrido siga con la vista siguiente, así el visitante
 * ve el sistema completo sin tocar nada. Se puede pausar y saltar a mano.
 */
function useAutoStep(count: number, resetKey: string, onFinish: () => void) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Refs para que el intervalo lea siempre el valor fresco sin re-crearse en
  // cada paso (y para no llamar a `onFinish` dentro de un updater de estado,
  // que React considera fase de render).
  const stepRef = useRef(0);
  const finishRef = useRef(onFinish);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    finishRef.current = onFinish;
  }, [onFinish]);

  // Cambió de pestaña: la escena arranca de cero.
  useEffect(() => {
    setStep(0);
    stepRef.current = 0;
  }, [resetKey]);

  // Si el visitante pidió menos movimiento, no reproducimos solos: se navega a
  // mano con los puntos.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (stepRef.current + 1 < count) setStep(stepRef.current + 1);
      else finishRef.current();
    }, STEP_MS);
    return () => clearInterval(id);
  }, [count, playing]);

  const goTo = useCallback((i: number) => {
    setPlaying(false);
    setStep(i);
  }, []);

  return { step, playing, setPlaying, goTo };
}

/** Marco tipo pantalla, para que el mockup se lea como una captura real. */
function ScreenFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-lg">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-error/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/** Resalta el elemento que acaba de cambiar, para que el ojo lo siga. */
const focusRing = (on: boolean) => (on ? 'ring-2 ring-primary' : '');

// ------------------------------------------------------------------ Cocina

const KDS_COLUMNS = [
  { title: 'NUEVOS', icon: ChefHat, action: 'Tomar pedido' },
  { title: 'EN PREPARACIÓN', icon: Clock, action: 'Marcar listo' },
  { title: 'LISTOS', icon: Check, action: 'Entregado' },
  { title: 'ENTREGADOS', icon: Check, action: null },
];

/** Tickets fijos del tablero (los que no protagonizan la escena). */
const KDS_STATIC = [
  { col: 0, ref: 'Mesa 9', station: 'Bebidas', min: 1, items: ['3× Refresco'] },
  { col: 1, ref: 'Mesa 7', station: 'Parrilla', min: 21, items: ['3× Milanesa'], late: true },
  { col: 3, ref: 'Retiro', station: 'Postres', min: 14, items: ['1× Flan casero'] },
];

const KITCHEN_STEPS = [
  'Entra la comanda: el mozo la cargó en el salón',
  'El cocinero la toma — el reloj empieza a correr',
  'Sale el plato: queda listo para servir',
  'El mozo lo levanta y la comanda se cierra',
];

function DemoKitchen({ step }: { step: number }) {
  return (
    <div className="min-w-[860px] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="input w-40 py-1.5 text-xs text-muted-foreground">Sucursal Centro</span>
        <span className="input w-44 py-1.5 text-xs text-muted-foreground">Todas las estaciones</span>
        <span className="badge badge-ok ml-auto">En línea</span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {KDS_COLUMNS.map((col, colIdx) => {
          const statics = KDS_STATIC.filter((t) => t.col === colIdx);
          const hasHero = step === colIdx;
          return (
            <div key={col.title}>
              <div className="mb-2 flex items-center gap-1.5">
                <col.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-heading text-xs font-bold tracking-wide text-muted-foreground">
                  {col.title}
                </span>
                <span className="tabular ml-auto text-xs text-muted-foreground">
                  {statics.length + (hasHero ? 1 : 0)}
                </span>
              </div>
              <div className="space-y-2">
                {/* Tipografía grande a propósito: el KDS real se lee a dos
                    metros, con las manos ocupadas. */}
                {hasHero && (
                  <div className={`card p-3 transition-shadow ${focusRing(true)}`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-heading text-2xl font-bold">Mesa 4</span>
                      <span className="tabular text-lg text-muted-foreground">{step + 1} min</span>
                    </div>
                    <span className="badge badge-neutral mb-2">Cocina caliente</span>
                    <ul className="space-y-1">
                      <li className="text-lg font-medium">2× Hamburguesa Clásica</li>
                      <li className="text-lg font-medium">1× Papas Fritas</li>
                    </ul>
                    <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/15 px-2 py-1 text-xs font-semibold text-warn-foreground">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      sin cebolla
                    </p>
                    {col.action && (
                      <div className="btn btn-primary btn-lg mt-2 w-full justify-center">{col.action}</div>
                    )}
                    {colIdx > 0 && (
                      <div className="btn mt-1.5 w-full justify-center gap-1 text-xs">
                        <RotateCcw className="h-3.5 w-3.5" /> Deshacer
                      </div>
                    )}
                    <div className="btn mt-1.5 w-full justify-center gap-1 text-xs">
                      <Printer className="h-3.5 w-3.5" /> Imprimir comanda
                    </div>
                  </div>
                )}

                {statics.map((t) => (
                  <div key={t.ref} className={`card p-3 ${t.late ? 'border-error ring-2 ring-error' : ''}`}>
                    {t.late && (
                      <p className="-mx-3 -mt-3 mb-2 flex items-center justify-center gap-1 rounded-t-[inherit] bg-error px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                        <AlertTriangle className="h-3 w-3" />
                        Retrasado
                      </p>
                    )}
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-heading text-lg font-bold">{t.ref}</span>
                      <span
                        className={`tabular text-sm ${t.late ? 'font-semibold text-error-foreground' : 'text-muted-foreground'}`}
                      >
                        {t.min} min
                      </span>
                    </div>
                    <span className="badge badge-neutral mb-2">{t.station}</span>
                    <ul className="space-y-1">
                      {t.items.map((it) => (
                        <li key={it} className="font-heading text-sm font-semibold">
                          {it}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Mesero

const WAITER_STEPS = [
  'El mozo abre la mesa 3',
  'Carga lo que pidieron y lo manda a cocina',
  'Cocina avisa: el plato está listo para servir',
  'La mesa pide la cuenta — aparece en el mapa',
];

const WAITER_BADGE = [
  { label: 'Libre', tone: 'badge-ok' },
  { label: 'En espera', tone: 'badge-neutral' },
  { label: 'Listo para servir', tone: 'badge-ok' },
  { label: 'Pidió la cuenta', tone: 'badge-warn' },
];

const OTHER_TABLES = [
  { code: '1', label: 'En preparación', tone: 'badge-warn', total: '₲ 64.000' },
  { code: '2', label: 'Libre', tone: 'badge-ok', total: null },
  { code: '4', label: 'Pidió la cuenta', tone: 'badge-warn', total: '₲ 87.000' },
  { code: '5', label: 'Libre', tone: 'badge-ok', total: null },
  { code: '6', label: 'Reservada', tone: 'badge-warn', total: null },
  { code: '7', label: 'En espera', tone: 'badge-neutral', total: '₲ 45.000' },
  { code: '8', label: 'Libre', tone: 'badge-ok', total: null },
];

function DemoWaiter({ step }: { step: number }) {
  const badge = WAITER_BADGE[step]!;
  const hasOrder = step >= 1;

  return (
    <div className="min-w-[760px] p-4">
      {step === 2 && (
        <p className="mb-3 flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm font-semibold text-ok-foreground">
          <Check className="h-4 w-4 shrink-0" />
          Mesa 3: pedido listo para servir
        </p>
      )}

      <div className="mb-3 grid grid-cols-8 gap-2">
        <div className={`card p-3 ${focusRing(true)}`}>
          <p className="mb-1.5 font-heading text-base font-semibold">Mesa 3</p>
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
          {hasOrder && <p className="tabular mt-1.5 text-xs text-muted-foreground">₲ 66.000</p>}
        </div>
        {OTHER_TABLES.map((t) => (
          <div key={t.code} className="card p-3">
            <p className="mb-1.5 font-heading text-base font-semibold">Mesa {t.code}</p>
            <span className={`badge ${t.tone}`}>{t.label}</span>
            {t.total && <p className="tabular mt-1.5 text-xs text-muted-foreground">{t.total}</p>}
          </div>
        ))}
      </div>

      <div className="panel p-4">
        <p className="mb-3 font-heading text-base font-semibold">Mesa 3</p>
        {!hasOrder ? (
          <div className="btn btn-primary btn-sm justify-center">Abrir mesa</div>
        ) : (
          <>
            <ul className="mb-3 space-y-1.5 text-sm">
              <li className="flex justify-between gap-2">
                <span>2× Hamburguesa Clásica</span>
                <span className="tabular text-muted-foreground">27.000 c/u</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>1× Papas Fritas</span>
                <span className="tabular text-muted-foreground">12.000 c/u</span>
              </li>
            </ul>
            <div className="mb-3 flex justify-between border-t border-border pt-2 font-heading font-semibold">
              <span>Total de la mesa</span>
              <span className="tabular">₲ 66.000</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="btn btn-primary btn-sm justify-center">Enviar pedido a cocina</div>
              <div className={`btn btn-sm justify-center ${focusRing(step === 3)}`}>
                {step === 3 ? 'Cuenta solicitada' : 'Solicitar cuenta'}
              </div>
              <div className="btn btn-sm justify-center">Dividir cuenta</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Dueño

const OWNER_STEPS = [
  'El dueño entra y ve el resumen del día',
  'Los avisos lo llevan directo a lo que hay que resolver',
  'El reporte: qué se vendió y qué deja margen',
  'Control: cada descuento y anulación, con responsable',
];

const REVENUE_DAYS = [42, 55, 38, 61, 72, 90, 100];

function OwnerDashboard({ highlightAlerts }: { highlightAlerts: boolean }) {
  return (
    <>
      <div className={`mb-3 rounded-lg border-l-4 border-warn bg-warn/10 p-3 ${focusRing(highlightAlerts)}`}>
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn-foreground" />
          Requiere tu atención
        </p>
        <ul className="space-y-1">
          {[
            { text: '1 delivery sin repartidor asignado', action: 'Asignar' },
            { text: '1 caja abierta de un día anterior sin cerrar', action: 'Cerrar caja' },
            { text: '3 insumos con stock bajo (Queso, Pan, Papas)', action: 'Reponer' },
          ].map((a) => (
            <li key={a.text} className="flex items-center justify-between gap-2 text-xs">
              <span>{a.text}</span>
              <span className="badge badge-warn shrink-0">{a.action}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="card p-3">
          <p className="text-xs text-muted-foreground">Pedidos hoy</p>
          <p className="tabular mt-1 font-heading text-xl font-bold">72</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted-foreground">Ingresos hoy</p>
          <p className="tabular mt-1 font-heading text-xl font-bold">₲ 836.000</p>
          <p className="mt-1 text-[11px] text-ok-foreground">+12% vs ayer</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted-foreground">Mesas</p>
          <p className="tabular mt-1 font-heading text-xl font-bold">20</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="badge badge-error">3 ocupadas</span>
            <span className="badge badge-ok">17 libres</span>
          </div>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted-foreground">Deliveries pendientes</p>
          <p className="tabular mt-1 font-heading text-xl font-bold">3</p>
        </div>
      </div>

      {/* Mini-tendencia. El contenedor NO lleva `items-end`: con eso las
          columnas quedan de altura automática y el `height: %` de cada barra no
          resuelve contra nada — se dibujan en 0 y el gráfico se ve vacío. Con
          stretch (el default) la columna hereda los 8rem y el `flex-1` del
          riel le da una altura definida a la barra. */}
      <div className="card mt-3 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-heading text-sm font-semibold">Ingresos — últimos 7 días</p>
          <span className="text-[11px] text-muted-foreground">Zona horaria del local</span>
        </div>
        <div className="flex h-24 gap-2">
          {REVENUE_DAYS.map((h, i) => {
            const isToday = i === REVENUE_DAYS.length - 1;
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t ${isToday ? 'bg-primary' : 'bg-ok/50'}`}
                    style={{ height: `${h}%` }}
                  />
                </div>
                <span className={`text-[10px] ${isToday ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {14 + i}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Ventas por día: barras HORIZONTALES con el monto al lado, igual que la
 *  pantalla real de Reportes (una fila por día, no columnas verticales). */
const REPORT_DAYS = [
  { day: 'Lun 14', revenue: 352_000, pct: 42 },
  { day: 'Mar 15', revenue: 461_000, pct: 55 },
  { day: 'Mié 16', revenue: 318_000, pct: 38 },
  { day: 'Jue 17', revenue: 511_000, pct: 61 },
  { day: 'Vie 18', revenue: 603_000, pct: 72 },
  { day: 'Sáb 19', revenue: 754_000, pct: 90 },
  { day: 'Dom 20', revenue: 836_000, pct: 100 },
];

function OwnerReports() {
  return (
    <div className="grid grid-cols-[1fr_240px] gap-3">
      <div className="card p-4">
        <p className="mb-1 font-heading text-sm font-semibold">Ventas por día</p>
        <p className="mb-3 text-[11px] text-muted-foreground">Zona horaria del local</p>
        <div className="space-y-1.5">
          {REPORT_DAYS.map((d) => (
            <div key={d.day} className="flex items-center gap-2 text-xs">
              <span className="tabular w-14 shrink-0 text-muted-foreground">{d.day}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${d.pct}%` }} />
              </div>
              <span className="tabular w-20 shrink-0 text-right text-muted-foreground">
                ₲ {d.revenue.toLocaleString('es-PY')}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card p-4">
        <p className="mb-2 font-heading text-sm font-semibold">Lo que más margen deja</p>
        <ul className="space-y-1.5 text-xs">
          {[
            { name: 'Hamburguesa Clásica', qty: 48, margin: '₲ 612.000' },
            { name: 'Papas Fritas', qty: 61, margin: '₲ 427.000' },
            { name: 'Combo Clásico', qty: 22, margin: '₲ 308.000' },
          ].map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {p.name} <span className="text-muted-foreground">×{p.qty}</span>
              </span>
              <span className="tabular shrink-0 font-medium text-ok-foreground">{p.margin}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OwnerControl() {
  return (
    <div className="card p-3">
      <p className="mb-3 flex items-center gap-2 font-heading text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" />
        Descuentos y anulaciones del turno
      </p>
      <ul className="space-y-2 text-xs">
        {[
          { who: 'Ana (cajera)', what: 'Descuento 20%', amount: '₲ 16.000', why: 'Cortesía — demora en cocina' },
          { who: 'Luis (mozo)', what: 'Anulación', amount: '₲ 45.000', why: 'Cliente se retiró antes de servir' },
          { who: 'Ana (cajera)', what: 'Retiro de caja', amount: '₲ 30.000', why: 'Pago a proveedor de hielo' },
        ].map((r) => (
          <li key={r.why} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
            <span className="min-w-0">
              <span className="font-medium">{r.what}</span> · {r.who}
              <span className="block text-muted-foreground">{r.why}</span>
            </span>
            <span className="tabular shrink-0 font-medium">{r.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * El admin real navega con SIDEBAR agrupado (Ventas / Catálogo, y sueltos
 * Clientes, Análisis y Configuración), no con pestañas arriba. Reportes y
 * Control sí son pestañas, pero adentro de Análisis. Se replica esa jerarquía
 * porque es lo que el dueño va a ver cuando entre.
 */
const ADMIN_NAV: { title?: string; items: { label: string; key?: 'dashboard' | 'analisis' }[] }[] = [
  { items: [{ label: 'Dashboard', key: 'dashboard' }] },
  { title: 'VENTAS', items: [{ label: 'Pedidos' }, { label: 'Mesas' }, { label: 'Reservas' }, { label: 'Delivery' }] },
  { title: 'CATÁLOGO', items: [{ label: 'Menú' }, { label: 'Inventario' }, { label: 'Compras' }] },
  { items: [{ label: 'Clientes' }, { label: 'Análisis', key: 'analisis' }, { label: 'Configuración' }] },
];

function DemoOwner({ step }: { step: number }) {
  const section = step <= 1 ? 'dashboard' : 'analisis';
  return (
    <div className="flex min-w-[860px]">
      <aside className="w-44 shrink-0 border-r border-border p-3">
        <p className="mb-3 font-heading text-sm font-semibold">Chillberry</p>
        {ADMIN_NAV.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
            {group.title && (
              <p className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground">
                {group.title}
              </p>
            )}
            {group.items.map((it) => (
              <p
                key={it.label}
                className={`rounded-md px-2 py-1 text-xs ${
                  it.key === section ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground'
                }`}
              >
                {it.label}
              </p>
            ))}
          </div>
        ))}
      </aside>

      <div className="min-w-0 flex-1 p-4">
        <p className="font-heading text-lg font-semibold">
          {section === 'dashboard' ? 'Hola, Alberto' : 'Análisis'}
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          {section === 'dashboard'
            ? 'Este es el resumen de hoy en tu restaurante.'
            : 'Cómo viene el negocio y qué pasó en el turno.'}
        </p>

        {section === 'analisis' && (
          <div className="mb-3 flex gap-1 border-b border-border">
            {[
              { label: 'Reportes', on: step === 2 },
              { label: 'Control', on: step === 3 },
            ].map((t) => (
              <span
                key={t.label}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${
                  t.on ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'
                }`}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}

        {step <= 1 && <OwnerDashboard highlightAlerts={step === 1} />}
        {step === 2 && <OwnerReports />}
        {step === 3 && <OwnerControl />}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Repartidor

const DRIVER_STEPS = [
  'El repartidor se pone Disponible',
  'Le entra una entrega y la acepta',
  'Retira en el local y sale',
  'Cierra con el código que le dicta tu cliente',
];

const DRIVER_BADGE = ['Sin asignar', 'Asignada a vos', 'Retirada — en camino', 'Entregada'];
const DRIVER_TONE = ['badge-neutral', 'badge-warn', 'badge-info', 'badge-ok'];

function DemoDriver({ step }: { step: number }) {
  return (
    <div className="min-w-[380px] p-4">
      <div className="mx-auto max-w-sm space-y-3">
        <span className="flex items-center gap-2 font-heading font-semibold">
          <Bike className="h-4 w-4" /> Repartidor
        </span>

        <div className="grid grid-cols-3 gap-1">
          <span className={`btn btn-sm justify-center ${step >= 0 ? 'btn-primary' : ''}`}>Disponible</span>
          <span className="btn btn-sm justify-center">Ocupado</span>
          <span className="btn btn-sm justify-center">Desconectado</span>
        </div>

        {step === 0 ? (
          <div className="card p-6 text-center text-sm text-muted-foreground">
            Esperando entregas…
          </div>
        ) : (
          <div className={`card p-3 ${focusRing(true)}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="font-heading text-sm font-semibold">Sucursal Centro</span>
              <span className={`badge ${DRIVER_TONE[step]}`}>{DRIVER_BADGE[step]}</span>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Store className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Recoger en: Palma 456
            </p>
            <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Entregar en: Av. España 1234
            </p>
            <p className="tabular mt-2 text-xs text-muted-foreground">
              Total pedido ₲ 66.000 · Fee ₲ 12.000 · ~30 min
            </p>

            {step === 1 && <div className="btn btn-primary btn-sm mt-2 w-full justify-center">Aceptar</div>}
            {step === 2 && <div className="btn btn-primary btn-sm mt-2 w-full justify-center">Marcar recogido</div>}
            {step === 3 && (
              <div className="mt-2 flex gap-2">
                <span className="input tabular flex-1 py-1.5 text-xs">4821</span>
                <span className="btn btn-primary btn-sm shrink-0">Confirmar entrega</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Tu cliente

const CLIENT_STEPS = [
  'Escanea el QR y arma su pedido desde la mesa',
  'Revisa el resumen y confirma',
  'La cocina ya lo está preparando',
  'Sale para su casa y lo sigue en el mapa',
  'Lo recibe y califica la entrega',
];

const CLIENT_MENU = [
  { name: 'Hamburguesa Clásica', price: '₲ 27.000' },
  { name: 'Papas Fritas', price: '₲ 12.000' },
  { name: 'Refresco', price: '₲ 8.000' },
];

function DemoClient({ step }: { step: number }) {
  return (
    <div className="min-w-[380px] p-4">
      <div className="panel mx-auto max-w-sm p-4">
        {step === 0 && (
          <>
            <p className="mb-3 font-heading text-base font-semibold">Carta — Sucursal Centro</p>
            <ul className="space-y-2">
              {CLIENT_MENU.map((m, i) => (
                <li key={m.name} className={`card flex items-center gap-3 p-3 ${focusRing(i === 0)}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}</span>
                    <span className="tabular text-xs text-muted-foreground">{m.price}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="btn btn-sm h-8 w-8 justify-center p-0">
                      <Minus className="h-3.5 w-3.5" />
                    </span>
                    <span className="tabular w-4 text-center text-sm">{i === 0 ? 2 : 0}</span>
                    <span className="btn btn-primary btn-sm h-8 w-8 justify-center p-0">
                      <Plus className="h-3.5 w-3.5" />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 1 && (
          <>
            <p className="mb-3 font-heading text-base font-semibold">Tu pedido</p>
            <ul className="mb-3 space-y-1.5 text-sm">
              <li className="flex justify-between gap-2">
                <span>2× Hamburguesa Clásica</span>
                <span className="tabular text-muted-foreground">₲ 54.000</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>1× Papas Fritas</span>
                <span className="tabular text-muted-foreground">₲ 12.000</span>
              </li>
            </ul>
            <div className="mb-3 flex justify-between border-t border-border pt-2 font-heading font-semibold">
              <span>Total</span>
              <span className="tabular">₲ 66.000</span>
            </div>
            <div className={`btn btn-primary btn-sm w-full justify-center ${focusRing(true)}`}>
              Confirmar pedido
            </div>
          </>
        )}

        {step === 2 && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warn/15">
              <ChefHat className="h-8 w-8 text-warn-foreground" />
            </div>
            <p className="font-heading text-lg font-semibold">En preparación</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Tu pedido entró a cocina. Te avisamos cuando salga.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-info/15">
              <Bike className="h-8 w-8 text-info-foreground" />
            </div>
            <p className="font-heading text-lg font-semibold">Tu pedido está en camino</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Tiempo estimado: <span className="tabular font-semibold text-foreground">~15 min</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Repartidor: <span className="font-medium text-foreground">Diego</span>
            </p>
            <div className="relative mt-4 h-28 overflow-hidden rounded-md border border-border bg-muted">
              <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:22px_22px]" />
              <span className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow" />
            </div>
            <div className="btn btn-sm mt-2 w-full justify-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> Abrir en Google Maps
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-ok/15">
              <Check className="h-8 w-8 text-ok-foreground" />
            </div>
            <p className="font-heading text-lg font-semibold">Entregado</p>
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">¿Cómo estuvo tu entrega?</p>
              <div className="mb-3 flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className={`h-6 w-6 ${s <= 4 ? 'fill-warn text-warn' : 'text-muted-foreground/40'}`} />
                ))}
              </div>
              <div className="input mb-2 py-1.5 text-left text-xs text-muted-foreground">
                Contanos algo más (opcional)
              </div>
              <div className="btn btn-primary btn-sm w-full justify-center">Enviar calificación</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- showcase

const SCENES: {
  key: TabKey;
  label: string;
  icon: typeof ChefHat;
  steps: string[];
  render: (step: number) => React.ReactElement;
}[] = [
  { key: 'cocina', label: 'Cocina', icon: ChefHat, steps: KITCHEN_STEPS, render: (s) => <DemoKitchen step={s} /> },
  { key: 'mesero', label: 'Mesero', icon: Users, steps: WAITER_STEPS, render: (s) => <DemoWaiter step={s} /> },
  { key: 'owner', label: 'Dueño', icon: LayoutDashboard, steps: OWNER_STEPS, render: (s) => <DemoOwner step={s} /> },
  { key: 'repartidor', label: 'Repartidor', icon: Bike, steps: DRIVER_STEPS, render: (s) => <DemoDriver step={s} /> },
  { key: 'cliente', label: 'Tu cliente', icon: MapPin, steps: CLIENT_STEPS, render: (s) => <DemoClient step={s} /> },
];

export function DemoShowcase() {
  const [tab, setTab] = useState<TabKey>('cocina');
  const scene = SCENES.find((s) => s.key === tab)!;

  // Al terminar una escena, el recorrido salta a la siguiente vista (y de la
  // última vuelve a la primera): se ve el sistema entero sin tocar nada.
  const nextView = useCallback(() => {
    setTab((current) => {
      const i = SCENES.findIndex((s) => s.key === current);
      return SCENES[(i + 1) % SCENES.length]!.key;
    });
  }, []);

  const { step, playing, setPlaying, goTo } = useAutoStep(scene.steps.length, tab, nextView);

  return (
    <div>
      <div role="tablist" aria-label="Vistas del producto" className="mb-4 flex flex-wrap justify-center gap-2">
        {SCENES.map((s) => {
          const isActive = s.key === tab;
          return (
            <button
              key={s.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setTab(s.key)}
              className={`btn min-h-[44px] cursor-pointer ${isActive ? 'btn-primary' : ''}`}
            >
              <s.icon className="h-4 w-4" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Narración del paso actual: sin esto el visitante ve cambiar cosas y no
          sabe qué está mirando. `aria-live` para que también se anuncie. */}
      <p key={`${tab}-${step}`} className="demo-enter mb-3 text-center text-base font-medium" aria-live="polite">
        {scene.steps[step]}
      </p>

      <ScreenFrame>
        {/* `min-w-max` es obligatorio: sin él este wrapper mide 100% del marco y
            el hijo (que tiene su ancho de escritorio) se derrama FUERA del
            cuadro en vez de activar el scroll horizontal. `w-full` lo estira
            cuando el marco es más ancho que el contenido, para que las escenas
            angostas (cliente, repartidor) sigan centradas en desktop. */}
        <div key={`${tab}-${step}`} className="demo-enter w-full min-w-max">
          {scene.render(step)}
        </div>
      </ScreenFrame>

      {/* Controles: pausar y saltar a cualquier paso. Contenido que se mueve
          solo tiene que poder frenarse. */}
      <div className="mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pausar la demostración' : 'Reproducir la demostración'}
          className="btn btn-sm min-h-[44px] min-w-[44px] justify-center"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2">
          {scene.steps.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Paso ${i + 1}: ${label}`}
              aria-current={i === step}
              className="flex h-11 w-6 items-center justify-center"
            >
              <span
                className={`block h-2 rounded-full transition-all ${
                  i === step ? 'w-6 bg-primary' : 'w-2 bg-border'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-center text-xs text-muted-foreground sm:hidden">
        Deslizá la pantalla de costado para verla completa
      </p>
    </div>
  );
}
