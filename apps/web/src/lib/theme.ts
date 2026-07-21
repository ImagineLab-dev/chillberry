export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'chillberry-theme';

/**
 * Superficies que arrancan en oscuro.
 *
 * El default es por RUTA, no por rol: el KDS es oscuro por el ambiente físico
 * de la cocina, no por quién lo mira. Un OWNER supervisando /kitchen tiene que
 * verlo oscuro igual que el cocinero — con default por rol vería claro, que es
 * justo lo que no queremos.
 *
 * Mantener sincronizado con `THEME_INIT_SCRIPT` (que lo replica a mano).
 */
export const DARK_ROUTES = ['/kitchen', '/driver'];

export const DEFAULT_THEME: Theme = 'light';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** La elección explícita del usuario gana sobre el default de la ruta. */
export function resolveTheme(stored: string | null, pathname: string): Theme {
  if (isTheme(stored)) return stored;
  return DARK_ROUTES.some((r) => pathname.startsWith(r)) ? 'dark' : DEFAULT_THEME;
}

/**
 * Aplica el tema al <html>.
 *
 * `color-scheme` es lo que hace que el chrome nativo — scrollbars, `<select>`,
 * date pickers — siga el tema. Sin esto, el KDS oscuro muestra un `<select>`
 * blanco (era un bug real del sistema anterior).
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/**
 * Script inline y bloqueante para el <head>. Corre ANTES del primer paint, así
 * que la página nunca aparece un frame en el tema equivocado (FOUC).
 *
 * No puede importar nada — se serializa como string dentro de un <script>, así
 * que replica a mano la lógica de `resolveTheme`/`applyTheme` y la lista de
 * `DARK_ROUTES`. Si cambiás una, cambiá la otra.
 */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (t !== 'light' && t !== 'dark') {
      var p = location.pathname;
      t = (${JSON.stringify(DARK_ROUTES)}).some(function(r){ return p.indexOf(r) === 0; }) ? 'dark' : 'light';
    }
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
})();
`;
