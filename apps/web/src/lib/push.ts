/**
 * Alta del dispositivo en las notificaciones push.
 *
 * Reemplaza a WhatsApp: es la única forma de avisarle a alguien que cerró la
 * página. Funciona nativo en Android y computadora; en iPhone sólo si el
 * usuario agregó el sitio a su pantalla de inicio, porque Apple lo exige.
 *
 * Nunca lanza: que no se pueda suscribir no puede romper la pantalla donde
 * está la persona.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

/**
 * La clave VAPID viaja en base64url y `PushManager` la quiere en bytes.
 *
 * Devuelve `ArrayBuffer` y no `Uint8Array`: con `Uint8Array<ArrayBufferLike>`,
 * TypeScript no lo acepta como `BufferSource` (el genérico puede ser un
 * `SharedArrayBuffer`, que la API no admite).
 */
function claveABytes(base64: string): ArrayBuffer {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = window.atob(normal);
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0))).buffer;
}

export function pushSoportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** `default` = todavía no se le preguntó; `denied` = dijo que no y no se le vuelve a preguntar. */
export function permisoPush(): NotificationPermission | null {
  return pushSoportado() ? Notification.permission : null;
}

/**
 * Pide permiso, registra el service worker y da de alta el dispositivo.
 *
 * @param ruta Endpoint donde queda registrado. El comensal usa el de su
 *   seguimiento (`push/suscribir/seguimiento/<token>`), donde su identidad sale
 *   del token; el personal usa `push/suscribir` con su sesión.
 * @param conAuth Manda las cookies de sesión (para el personal).
 */
export async function activarPush(ruta: string, conAuth = false): Promise<boolean> {
  if (!pushSoportado()) return false;

  try {
    // Si ya dijo que no, no se insiste: el navegador ni siquiera vuelve a
    // mostrar el cartel y volver a pedirlo sólo gasta tiempo.
    if (Notification.permission === 'denied') return false;

    const permiso =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permiso !== 'granted') return false;

    const res = await fetch(`${API_BASE}/push/clave-publica`);
    const { key } = (await res.json()) as { key: string | null };
    // Sin clave configurada en el servidor no hay push. Se sale en silencio:
    // es un problema de configuración, no algo que el usuario pueda resolver.
    if (!key) return false;

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Reutiliza la suscripción existente si ya hay una: volver a crearla
    // invalidaría la anterior y el servidor quedaría con un destino muerto.
    const suscripcion =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        // Obligatorio en todos los navegadores actuales: no se permiten pushes
        // silenciosos, cada uno tiene que mostrar algo.
        userVisibleOnly: true,
        applicationServerKey: claveABytes(key),
      }));

    const json = suscripcion.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

    const alta = await fetch(`${API_BASE}/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: conAuth ? 'include' : 'same-origin',
      body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }),
    });
    return alta.ok;
  } catch {
    return false;
  }
}
