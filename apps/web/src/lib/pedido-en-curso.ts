/**
 * Recuerda el último pedido con envío que hizo este navegador, para poder
 * volver al seguimiento desde la carta.
 *
 * El problema que resuelve: al confirmar un pedido con delivery, la carta
 * redirige a `/track/<uuid>`. Ese identificador es aleatorio y no se guardaba en
 * ningún lado, así que si el cliente cerraba la pestaña, tocaba "atrás" o el
 * teléfono le mataba el navegador, **perdía el seguimiento para siempre**. Y lo
 * único que le queda a mano es el link de la carta (el del QR, el que le
 * mandaron por WhatsApp) — que es justamente donde tiene que poder volver.
 *
 * Se guarda por sucursal: un mismo teléfono puede estar pidiendo en dos lugares.
 */

const PREFIJO = 'chillberry:pedido:';

/**
 * Pasadas estas horas se descarta solo. Sin esto, un pedido que quedó a medias
 * (el restaurante nunca lo cerró, se canceló fuera del sistema) le seguiría
 * mostrando "tenés un pedido en camino" para siempre.
 */
const VIGENCIA_HORAS = 6;

export interface PedidoEnCurso {
  /** El `trackingToken`, que es lo que abre el seguimiento — no el id. */
  token: string;
  /** ISO. Para descartarlo cuando ya pasó demasiado tiempo. */
  creado: string;
}

function clave(slug: string) {
  return `${PREFIJO}${slug}`;
}

export function guardarPedidoEnCurso(slug: string, token: string): void {
  if (typeof window === 'undefined') return;
  try {
    const dato: PedidoEnCurso = { token, creado: new Date().toISOString() };
    window.localStorage.setItem(clave(slug), JSON.stringify(dato));
  } catch {
    // Modo incógnito o almacenamiento lleno: no es motivo para romper el
    // pedido, sólo se pierde el atajo para volver.
  }
}

export function leerPedidoEnCurso(slug: string): PedidoEnCurso | null {
  if (typeof window === 'undefined') return null;
  try {
    const crudo = window.localStorage.getItem(clave(slug));
    if (!crudo) return null;

    const dato = JSON.parse(crudo) as PedidoEnCurso;
    if (!dato?.token || !dato?.creado) return null;

    const horas = (Date.now() - new Date(dato.creado).getTime()) / 3_600_000;
    if (!Number.isFinite(horas) || horas > VIGENCIA_HORAS) {
      olvidarPedidoEnCurso(slug);
      return null;
    }
    return dato;
  } catch {
    return null;
  }
}

export function olvidarPedidoEnCurso(slug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(clave(slug));
  } catch {
    // Ídem: no hay nada que hacer y no vale romper la pantalla por esto.
  }
}
