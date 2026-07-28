/**
 * UUID v4 para claves de idempotencia. `crypto.randomUUID()` NO existe en
 * contextos no-seguros ni en iOS Safari < 15.4 (aunque sea https): ahí tiraba un
 * TypeError que dejaba el botón de confirmar trabado en "Enviando…". El fallback
 * genera un UUID v4 válido (el backend lo valida con `@IsUUID`) con Math.random
 * — no es criptográfico, pero para deduplicar un doble-submit alcanza.
 */
export function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
