import { NextRequest, NextResponse } from 'next/server';
import { decodeJwtPayload, isExpired } from './lib/jwt';

const ROLE_HOME: Record<string, string> = {
  // Staff interno de Smartia: su casa es el panel del SaaS, no el de un
  // restaurante. `/super-admin` redirige a `/super-admin/tenants`.
  SUPER_ADMIN: '/super-admin/tenants',
  OWNER: '/admin/dashboard',
  ADMIN: '/admin/dashboard',
  KITCHEN: '/kitchen',
  WAITER: '/waiter',
  CASHIER: '/pos',
  DRIVER: '/driver',
};

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
//  /encuesta → encuesta de calificación post-visita (link que llega por WhatsApp).
// `/r/` y `/s/` con barra: prefijos de una sola letra, sin la barra abrirían
// cualquier futura ruta top-level que empiece con esa letra.
const PUBLIC_PATHS = ['/login', '/register', '/recuperar', '/track', '/menu', '/r/', '/s/', '/encuesta'];

/**
 * Archivos que App Router genera en la raíz a partir de `app/` (icon.svg,
 * apple-icon, opengraph-image, robots, sitemap...).
 *
 * Antes acá sólo figuraba `/favicon.ico`, así que al agregar `app/icon.svg` el
 * middleware lo mandaba a /login: el navegador pedía el favicon y recibía HTML.
 * El síntoma es engañoso — no da 404, "carga" algo — así que se ve como un
 * favicon que no aparece y nada más.
 */
const ASSETS_RAIZ = /^\/(favicon\.ico|icon\.\w+|apple-icon\.?\w*|opengraph-image\.?\w*|twitter-image\.?\w*|robots\.txt|sitemap\.xml)$/;

// Dominio raíz de la app en producción (ej. 'chillberry.io'). En dev, el host
// es 'localhost:3000' y los subdominios se prueban con '<sub>.localhost:3000'.
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';

// Subdominios que NO son un tenant: la app principal, correo, infra. El resto
// se interpreta como el `publicSubdomain`/`slug` de un restaurante.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'super-admin', 'dashboard',
  'mail', 'smtp', 'ftp', 'ns', 'ns1', 'ns2', 'cdn', 'assets', 'static',
  'status', 'help', 'support', 'blog',
]);

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
  return RESERVED_SUBDOMAINS.has(sub) ? null : sub;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1) Host de subdominio de tenant → storefront público, y NADA más.
  //    El link `<sub>.chillberry.io` sirve sólo la carta compartible; el staff
  //    entra por el dominio principal. Los deep-links públicos (`/r`, `/track`,
  //    `/menu`, `/s`) y los assets de Next pasan tal cual; todo lo demás se
  //    reescribe al storefront del tenant.
  const sub = tenantSubdomain(request.headers.get('host'));
  if (sub) {
    const isPassThrough =
      pathname.startsWith('/_next') ||
      ASSETS_RAIZ.test(pathname) ||
      PUBLIC_PATHS.some(
        (p) => pathname.startsWith(p) && p !== '/login' && p !== '/register' && p !== '/recuperar',
      );
    if (isPassThrough) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/s/${sub}`;
    return NextResponse.rewrite(url);
  }

  if (ASSETS_RAIZ.test(pathname) || PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get('cb_access')?.value;
  const claims = accessToken ? decodeJwtPayload(accessToken) : null;

  // La raíz es la LANDING pública de venta: se muestra a quien no tiene sesión,
  // y con sesión activa se manda al panel que le corresponde (no tiene sentido
  // venderle el producto a alguien que ya lo usa).
  //
  // OJO: la comparación es EXACTA (`=== '/'`) y nunca por prefijo — meter '/'
  // en PUBLIC_PATHS (que usa startsWith) volvería pública TODA la app.
  if (pathname === '/') {
    if (claims && !isExpired(claims)) {
      return NextResponse.redirect(new URL(ROLE_HOME[claims.role] ?? '/login', request.url));
    }
    return NextResponse.next();
  }

  if (!claims || isExpired(claims)) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const rule = ROUTE_ROLES.find((r) => pathname.startsWith(r.prefix));
  if (rule && !rule.roles.includes(claims.role)) {
    return NextResponse.redirect(new URL(ROLE_HOME[claims.role] ?? '/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml|api).*)'],
};
