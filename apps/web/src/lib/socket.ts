import { io, type Socket } from 'socket.io-client';
import { tokens } from './api-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3001';

export function connectKitchenSocket(): Socket {
  return io(`${SOCKET_URL}/kitchen`, {
    auth: { token: tokens.getAccess() },
    transports: ['websocket'],
    autoConnect: true,
  });
}

/** Namespace `/delivery` acepta conexiones anónimas (tracking público) — el
 * token se manda si existe, pero no es obligatorio para conectar. */
export function connectDeliverySocket(): Socket {
  return io(`${SOCKET_URL}/delivery`, {
    auth: { token: tokens.getAccess() ?? undefined },
    transports: ['websocket'],
    autoConnect: true,
  });
}
