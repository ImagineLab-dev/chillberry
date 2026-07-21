import { AsyncLocalStorage } from 'node:async_hooks';

type Store = { tenantId?: string };

const als = new AsyncLocalStorage<Store>();

/**
 * Contexto de tenant vía AsyncLocalStorage — NO request-scoped DI.
 *
 * Se probó primero con un provider REQUEST-scoped (`TenantPrismaService`
 * inyectando `@Inject(REQUEST)`), pero eso hace que el CONTROLLER que lo
 * consume también se vuelva request-scoped, y Nest resuelve el árbol de
 * DI request-scoped de un controller para construir su handler ANTES de
 * correr los guards globales — confirmado corriendo la app: `request.user`
 * llegaba `undefined` al constructor de `TenantPrismaService` incluso con
 * `@UseGuards(JwtAuthGuard, RolesGuard)` explícito en el controller.
 *
 * ALS no tiene ese problema: el middleware de abajo abre el store al
 * principio de la request (antes de guards), y el guard solo MUTA el
 * store ya abierto una vez que Passport valida el JWT — no depende del
 * orden de resolución de DI de Nest.
 */
export const tenantContext = {
  run<T>(fn: () => T): T {
    return als.run({}, fn);
  },
  setTenantId(tenantId: string) {
    const store = als.getStore();
    if (store) store.tenantId = tenantId;
  },
  getTenantId(): string | undefined {
    return als.getStore()?.tenantId;
  },
};
