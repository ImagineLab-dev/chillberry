import { io, type Socket } from 'socket.io-client';
import { tokens } from './api-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';

export function connectKitchenSocket(): Socket {
  return io(`${SOCKET_URL}/kitchen`, {
    // `auth` como FUNCIÓN, no objeto: el objeto se evalúa UNA vez al conectar y
    // reenvía ese token en cada reconexión. Cuando el access expira (turno de
    // varias horas) y hay un corte de red, la reconexión mandaba el token viejo,
    // el server desconectaba y el KDS quedaba mudo. Como función, lee el token
    // FRESCO de la cookie en cada intento.
    auth: (cb) => cb({ token: tokens.getAccess() }),
    transports: ['websocket'],
    autoConnect: true,
  });
}

/** Namespace `/delivery` acepta conexiones anónimas (tracking público) — el
 * token se manda si existe, pero no es obligatorio para conectar. */
export function connectDeliverySocket(): Socket {
  return io(`${SOCKET_URL}/delivery`, {
    auth: (cb) => cb({ token: tokens.getAccess() ?? undefined }),
    transports: ['websocket'],
    autoConnect: true,
  });
}
