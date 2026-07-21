import type { NextFunction, Request, Response } from 'express';
import { tenantContext } from './tenant-context';

/** Registrado como el PRIMER `app.use` en main.ts — abre el store de ALS
 * para toda la cadena downstream (guards, controllers, services). */
export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  tenantContext.run(() => next());
}
