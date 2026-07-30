import type { Metadata } from 'next';
import { safeJsonLd } from '@/lib/safe-jsonld';

/**
 * La carta (`/r/[slug]/page.tsx`) es un componente client (carrito, mapa, etc.),
 * así que NO puede exportar metadata. Este layout server sí: con `generateMetadata`
 * trae el nombre y la foto del restaurante y arma el título, la descripción y el
 * Open Graph propios. Resultado: compartir el link de una carta muestra un preview
 * con el nombre y la foto del local (no el genérico de Chillberry), y Google ve un
 * título por restaurante en vez de un cascarón vacío.
 *
 * Además inyecta datos estructurados (schema.org `Restaurant`) para que Google
 * entienda que es un restaurante con carta, dirección y teléfono → habilita
 * resultados enriquecidos (mapa, horario, "ver menú").
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://chillberry.app/api';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chillberry.app';

type BranchMeta = {
  restaurantName?: string;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string | null;
  branchLat?: number | null;
  branchLng?: number | null;
  countryCode?: string | null;
  branchCoverImageUrl?: string | null;
  restaurantLogoUrl?: string | null;
};

async function fetchBranch(slug: string): Promise<BranchMeta | null> {
  try {
    // Cache 5 min: un crawler que golpea muchas veces no martilla la API, y el
    // dato de metadata (nombre/foto) casi no cambia. Next deduplica esta misma
    // llamada entre `generateMetadata` y el componente en un mismo request.
    const res = await fetch(`${API_BASE}/public/menu/branch/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as BranchMeta;
  } catch {
    return null;
  }
}

/** Nombre mostrado: "Restaurante · Sucursal" salvo que la sucursal se llame igual. */
function displayName(branch: BranchMeta): string {
  return branch.branchName && branch.branchName !== branch.restaurantName
    ? `${branch.restaurantName} · ${branch.branchName}`
    : (branch.restaurantName as string);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const branch = await fetchBranch(slug);

  if (!branch?.restaurantName) {
    return { title: 'Carta online', description: 'Mirá la carta y pedí delivery o retiro online.' };
  }

  const nombre = displayName(branch);
  const title = `${nombre} — Carta y pedidos online`;
  const description = `Mirá la carta de ${branch.restaurantName} y pedí delivery o retiro directo${
    branch.branchAddress ? ` · ${branch.branchAddress}` : ''
  }.`;
  const image = branch.branchCoverImageUrl || branch.restaurantLogoUrl || null;
  const url = `/r/${slug}`;

  return {
    // `absolute`: el título lo lidera el restaurante, sin el sufijo "· Chillberry".
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      // Con foto del local, ese es el preview; sin ella, hereda la imagen OG del
      // sitio (app/opengraph-image.png).
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/** schema.org Restaurant: sólo con datos reales del local (nada inventado). */
function buildRestaurantJsonLd(branch: BranchMeta, slug: string): Record<string, unknown> {
  const url = `${SITE_URL}/r/${slug}`;
  const image = branch.branchCoverImageUrl || branch.restaurantLogoUrl || null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: displayName(branch),
    url,
    hasMenu: url,
    ...(image ? { image } : {}),
    ...(branch.branchPhone ? { telephone: branch.branchPhone } : {}),
    ...(branch.branchAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: branch.branchAddress,
            ...(branch.countryCode ? { addressCountry: branch.countryCode } : {}),
          },
        }
      : {}),
    ...(branch.branchLat != null && branch.branchLng != null
      ? { geo: { '@type': 'GeoCoordinates', latitude: branch.branchLat, longitude: branch.branchLng } }
      : {}),
  };
}

export default async function CartaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const branch = await fetchBranch(slug);
  const jsonLd = branch?.restaurantName ? buildRestaurantJsonLd(branch, slug) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
