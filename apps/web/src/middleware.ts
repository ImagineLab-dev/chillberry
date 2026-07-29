import { NextRequest, NextResponse } from 'next/server';
import { RESERVED_SUBDOMAINS } from '@chillberry/domain';
import { decodeJwtPayload, isExpired } from './lib/jwt';
import { ROLE_HOME } from './lib/role-home';

// Prefijo de ruta -> roles permitidos. OWNER/ADMIN pueden entrar a todo
// (supervisión), el resto queda limitado a su propia superficie.
//
// SUPER_ADMIN va SOLO en /super-admin y NO se agrega a las demás: no es un
// "OWNER con más permisos" sino staff de otra empresa. Su JWT apunta al tenant
// sistema (vacío), así que /admin le mostraría un panel sin datos — mejor
// mandarlo a su home que dejarlo entrar a una pantalla rota. Y a la inversa,
// OWNER/ADMIN no entran acá: este panel lista a sus competidores.
const ROUTE_ROLES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: '/super-admin', roles: ['SUPER_ADMIN'] },
  { prefix: '/admin', roles: ['OWNER', 'ADMIN'] },
  { prefix: '/kitchen', roles: ['KITCHEN', 'OWNER', 'ADMIN'] },
  { prefix: '/waiter', roles: ['WAITER', 'OWNER', 'ADMIN'] },
  { prefix: '/pos', roles: ['CASHIER', 'OWNER', 'ADMIN'] },
  // Solo DRIVER: la pantalla depende de un perfil de Driver (que owner/admin no
  // tienen), así que dejarlos entrar solo los llevaba a una pantalla vacía/403.
  { prefix: '/driver', roles: ['DRIVER'] },
];

// Rutas sin sesión de staff, siempre públicas:
//  /track  → link de seguimiento que recibe el cliente final de un delivery.
//  /menu   → menú del QR de una mesa (pedido self-service DINE_IN).
//  /r      → carta COMPARTIBLE de una sucursal (bio de Instagram/WhatsApp),
//            el pedido de delivery/retiro. Es un cliente anónimo, igual que /menu.
//  /s      → "storefront" de un tenant por subdominio (varias sucursales).
//  /encuesta → encuesta de calificación post-visita (link que llega por aviso).
//  /invitacion → link del mail para que un empleado invitado fije su contraseña.
//                No hay sesión todavía (recién la crea al aceptar), así que tiene
//                que ser pública o el middleware lo mandaría a /login.
// `/r/` y `/s/` con barra: prefijos de una sola letra, sin la barra abrirían
// cualquier futura ruta top-level que empiece con esa letra.
const PUBLIC_PATHS = ['/login', '/register', '/recuperar', '/track', '/menu', '/r/', '/s/', '/encuesta', '/invitacion'];

/**
 * Archivos que App Router genera en la raíz a partir de `app/` (icon.svg,
 * apple-icon, opengraph-image, robots, sitemap...).
 *
 * Incluye `sw.js`: un service worker que responde con un redirect NO se
 * registra, y sin él no llega un solo aviso push. Falla en silencio — la página
 * carga bien y nadie se entera hasta que alguien reclama que no le avisan.
 *
 * Antes acá sólo figuraba `/favicon.ico`, así que al agregar `app/icon.svg` el
 * middleware lo mandaba a /login: el navegador pedía el favicon y recibía HTML.
 * El síntoma es engañoso — no da 404, "carga" algo — así que se ve como un
 * favicon que no aparece y nada más.
 */
const ASSETS_RAIZ =
  /^\/(favicon\.ico|icon[\w-]*\.\w+|apple-icon\.?\w*|apple-touch-icon\.\w+|opengraph-image\.?\w*|twitter-image\.?\w*|robots\.txt|sitemap\.xml|sw\.js|manifest\.webmanifest)$/;

// Dominio raíz de la app en producción (ej. 'chillberry.app'). En dev, el host
// es 'localhost:3000' y los subdominios se prueban con '<sub>.localhost:3000'.
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';

// Subdominios que NO son un tenant: la lista vive en el domain package,
// COMPARTIDA con el chequeo de escritura (tenant-settings) y el de resolucion
// (public-menu). Antes habia una copia local aca y ya estaba desincronizada
// (le faltaban `chillberry`, `system`, `smartia`, `superadmin`).
const RESERVADOS = new Set<string>(RESERVED_SUBDOMAINS);

/** Devuelve el subdominio de tenant, o null si el host es la app principal. */
function tenantSubdomain(host: string | null): string | null {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0]!; // sin puerto
  const root = ROOT_DOMAIN.split(':')[0]!;
  if (h === root || h === `www.${root}`) return null;
  if (!h.endsWith(`.${root}`)) return null; // dominio ajeno / IP
  const sub = h.slice(0, h.length - root.length - 1);
  // sólo un label (sin puntos): 'a.b.root' no es un tenant válido acá
  if (!sub || sub.includes('.')) return null;
  return RESERVADOS.has(sub) ? null : sub;
}

// Host dedicado del panel interno: `super-admin.<root>`. Es una entrada aparte
// para el staff (NO un tenant: `super-admin` está en RESERVED_SUBDOMAINS), donde
// la RAÍZ del host abre el panel de SUPER_ADMIN en vez de la landing de venta.
// El certificado wildcard y el router `HostRegexp` de Traefik ya lo enrutan al
// front; la API cae cross-origin contra el apex y el CORS ya habilita los
// subdominios de chillberry.app, así que esto es sólo cosmético del front.
function isSuperAdminHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(':')[0]!;
  const root = ROOT_DOMAIN.split(':')[0]!;
  return h === `super-admin.${root}`;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get('host');
  const onSuperAdminHost = isSuperAdminHost(host);

  // 1) Host de subdominio de tenant → storefront público, y NADA más.
  //    El link `<sub>.chillberry.app` sirve sólo la carta compartible; el staff
  //    entra por el dominio principal. Los deep-links públicos (`/r`, `/track`,
  //    `/menu`, `/s`) y los assets de Next pasan tal cual; todo lo demás se
  //    reescribe al storefront del tenant. El host del panel interno NO entra
  //    acá: se maneja aparte más abajo.
  if (!onSuperAdminHost) {
    const sub = tenantSubdomain(host);
    if (sub) {
      const isPassThrough =
        pathname.startsWith('/_next') ||
        ASSETS_RAIZ.test(pathname) ||
        PUBLIC_PATHS.some(
          (p) =>
            pathname.startsWith(p) &&
            p !== '/login' &&
            p !== '/register' &&
            p !== '/recuperar' &&
            p !== '/invitacion',
        );
      if (isPassThrough) return NextResponse.next();
      const url = request.nextUrl.clone();
      url.pathname = `/s/${sub}`;
      return NextResponse.rewrite(url);
    }
  }

  if (ASSETS_RAIZ.test(pathname) || PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // El panel interno vive SÓLO en `super-admin.<root>`. En el apex (o www) se
  // redirige CUALQUIER `/super-admin*` al subdominio dedicado: bookmarks, links
  // viejos, y el super-admin que aterriza acá tras loguearse (su ROLE_HOME es
  // `/super-admin/tenants`, que cae en el apex y de acá salta al subdominio). Así
  // el dominio público no expone el panel interno. En el propio host del panel no
  // corre (gated por !onSuperAdminHost); en subdominios de tenant tampoco llega
  // (esos ya se resolvieron y retornaron arriba). La sesión NO se pierde en el
  // salto: en producción la cookie es de dominio (`.<root>`), compartida.
  if (!onSuperAdminHost && pathname.startsWith('/super-admin')) {
    const url = request.nextUrl.clone();
    url.hostname = `super-admin.${ROOT_DOMAIN.split(':')[0]!}`;
    // Limpiar el puerto: detrás de Traefik `nextUrl` trae el puerto INTERNO del
    // container (3000) y se colaba en el Location público
    // (`super-admin.chillberry.app:3000`, que no está expuesto → no carga). Sin
    // puerto, el navegador usa el 443 de https.
    url.port = '';
    return NextResponse.redirect(url);
  }

  // En `super-admin.<root>` la raíz ES el panel. Se mapea '/' -> '/super-admin'
  // como ruta EFECTIVA para TODO lo que sigue (sesión + rol) y recién si pasa los
  // chequeos se reescribe la respuesta. No es un bypass: la raíz queda protegida
  // exactamente igual que /super-admin en el dominio principal.
  const targetPath = onSuperAdminHost && pathname === '/' ? '/super-admin' : pathname;

  const accessToken = request.cookies.get('cb_access')?.value;
  const claims = accessToken ? decodeJwtPayload(accessToken) : null;

  // La raíz es la LANDING pública de venta: se muestra a quien no tiene sesión,
  // y con sesión activa se manda al panel que le corresponde (no tiene sentido
  // venderle el producto a alguien que ya lo usa). En el host del panel interno
  // la raíz ya se mapeó a /super-admin, así que este branch no aplica ahí.
  //
  // OJO: la comparación es EXACTA (`=== '/'`) y nunca por prefijo — meter '/'
  // en PUBLIC_PATHS (que usa startsWith) volvería pública TODA la app.
  if (targetPath === '/') {
    if (claims && !isExpired(claims)) {
      return NextResponse.redirect(new URL(ROLE_HOME[claims.role] ?? '/login', request.url));
    }
    return NextResponse.next();
  }

  if (!claims || isExpired(claims)) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const rule = ROUTE_ROLES.find((r) => targetPath.startsWith(r.prefix));
  if (rule && !rule.roles.includes(claims.role)) {
    return NextResponse.redirect(new URL(ROLE_HOME[claims.role] ?? '/login', request.url));
  }

  // Pasó sesión + rol: en el host del panel, reescribir la raíz al panel real.
  if (onSuperAdminHost && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/super-admin';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon|apple-touch-icon|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml|sw.js|manifest.webmanifest|api).*)',
  ],
};
