/*
 * Service worker: recibe los avisos push y los muestra.
 *
 * Corre fuera de la página, así que sigue vivo con la pestaña cerrada — que es
 * exactamente el motivo de existir. Sin esto, el comensal que pide y guarda el
 * teléfono en el bolsillo no se entera de nada hasta volver a abrir el sitio.
 *
 * Deliberadamente mínimo: no cachea nada. Un service worker que además cachea
 * es la forma más rápida de servir una versión vieja del sitio sin darse cuenta.
 */

self.addEventListener('push', (event) => {
  let aviso = { titulo: 'Chillberry', cuerpo: 'Tenés una novedad' };
  try {
    if (event.data) aviso = { ...aviso, ...event.data.json() };
  } catch {
    // Payload ilegible: se muestra el aviso genérico. Mejor eso que nada — la
    // persona abre igual y ve el estado real.
  }

  event.waitUntil(
    self.registration.showNotification(aviso.titulo, {
      body: aviso.cuerpo,
      icon: '/icon.svg',
      badge: '/icon.svg',
      // Agrupa por tema: un cambio de estado nuevo reemplaza al anterior en vez
      // de apilarse. Sin esto, cinco pasos del pedido son cinco avisos.
      tag: aviso.etiqueta || 'chillberry',
      renotify: true,
      data: { url: aviso.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    // Si ya hay una pestaña del sitio abierta se reutiliza en vez de abrir otra:
    // abrir una tercera copia del seguimiento no le sirve a nadie.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abiertas) => {
      for (const c of abiertas) {
        if (c.url.includes(destino) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(destino);
    }),
  );
});

// Los servicios de push rotan las suscripciones cada tanto. Cuando pasa, la
// vieja deja de servir y el dispositivo dejaría de recibir avisos en silencio.
//
// No se reintenta el alta desde acá a propósito: el service worker no sabe si
// este dispositivo es de un comensal (que se registra con el token de su
// seguimiento) o del personal (que se registra con su sesión), y elegir mal
// dejaría el aviso yendo a la persona equivocada. La página vuelve a darlo de
// alta sola en la próxima visita, que es cuando esa información existe.
self.addEventListener('pushsubscriptionchange', () => {
  // Sin manejo: `activarPush()` reutiliza o recrea la suscripción al abrir.
});
