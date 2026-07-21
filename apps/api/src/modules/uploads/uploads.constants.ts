import { join } from 'node:path';

/**
 * Relativo a `process.cwd()`, no a `__dirname` — el proceso siempre arranca
 * con cwd = `apps/api` (tanto en dev vía `nest start` como en producción vía
 * `node dist/main.js` corrido desde ese directorio, y en el Dockerfile el
 * WORKDIR final es justamente la raíz del paquete). Evita el cálculo frágil
 * de "cuántos niveles subir desde dist/modules/uploads/" que cambiaría entre
 * dev/build/Docker.
 */
export const UPLOADS_DIR = join(process.cwd(), 'uploads');
