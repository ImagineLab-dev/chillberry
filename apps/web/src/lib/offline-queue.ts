import { api } from './api-client';

const STORAGE_KEY = 'chillberry_kds_queue';

export type PendingAction = { taskId: string; status: string; queuedAt: number };

function read(): PendingAction[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as PendingAction[];
  } catch {
    return [];
  }
}

function write(actions: PendingAction[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
}

/**
 * Cola de acciones pendientes en localStorage — sobrevive a un refresh de
 * página, no solo a un corte de red breve. Simple a propósito (un array
 * chico de {taskId,status}, no IndexedDB/Dexie): el volumen de acciones de
 * cocina en cola nunca es grande, así que no se justifica la complejidad
 * extra de una base de datos embebida para esto.
 */
export const offlineQueue = {
  list: read,
  size: () => read().length,
  enqueue(taskId: string, status: string) {
    const actions = read();
    actions.push({ taskId, status, queuedAt: Date.now() });
    write(actions);
  },
  /** Intenta reenviar cada acción en orden; para en el primer fallo de red
   * (para no reordenar), pero descarta acciones que el server rechaza como
   * inválidas (409/400 — reintentarlas por siempre no tiene sentido). */
  async flush(): Promise<{ synced: number; dropped: number }> {
    const actions = read();
    if (actions.length === 0) return { synced: 0, dropped: 0 };

    let synced = 0;
    let dropped = 0;
    const remaining: PendingAction[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      try {
        await api.patch(`/kitchen/tasks/${action.taskId}/status`, { status: action.status });
        synced++;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 400 || status === 409 || status === 404) {
          dropped++;
        } else {
          // Fallo de red — dejamos esta y el resto en cola, reintentamos más tarde.
          remaining.push(...actions.slice(i));
          write(remaining);
          return { synced, dropped };
        }
      }
    }
    write(remaining);
    return { synced, dropped };
  },
};
