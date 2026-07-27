import type { Metadata } from 'next';

/**
 * Storefront de un tenant por subdominio (`<sub>.chillberry.app`, reescrito a
 * `/s/[sub]`). Igual que la carta por slug: el page es client, así que la
 * metadata (título + descripción + Open Graph con el nombre y el logo del
 * restaurante) la aporta este layout server con `generateMetadata`, y los datos
 * estructurados (schema.org `Restaurant`) se inyectan acá para Google.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://chillberry.app/api';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chillberry.app';

type StoreBranch = { slug?: string | null; name?: string; address?: string | null };
type StoreMeta = {
  tenantName?: string;
  logoUrl?: string | null;
  branches?: StoreBranch[];
};

async function fetchStore(sub: string): Promise<StoreMeta | null> {
  try {
    const res = await fetch(`${API_BASE}/public/menu/store/${encodeURIComponent(sub)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as StoreMeta;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ sub: string }> }): Promise<Metadata> {
  const { sub } = await params;
  const store = await fetchStore(sub);

  if (!store?.tenantName) {
    return { title: 'Carta online', description: 'Mirá la carta y pedí delivery o retiro online.' };
  }

  const title = `${store.tenantName} — Carta y pedidos online`;
  const description = `Mirá la carta de ${store.tenantName} y pedí delivery o retiro directo, sin apps de por medio.`;
  const image = store.logoUrl || null;

  return {
    title: { absolute: title },
    description,
    openGraph: {
      type: 'website',
      title,
      description,
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

/** schema.org Restaurant de la marca: dirección sólo si hay UNA sola sucursal. */
function buildStoreJsonLd(store: StoreMeta, sub: string): Record<string, unknown> {
  const url = `${SITE_URL}/s/${sub}`;
  const branches = store.branches ?? [];
  const onlyBranch = branches.length === 1 ? branches[0] : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: store.tenantName,
    url,
    hasMenu: url,
    ...(store.logoUrl ? { image: store.logoUrl } : {}),
    ...(onlyBranch?.address
      ? { address: { '@type': 'PostalAddress', streetAddress: onlyBranch.address } }
      : {}),
  };
}

export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sub: string }>;
}) {
  const { sub } = await params;
  const store = await fetchStore(sub);
  const jsonLd = store?.tenantName ? buildStoreJsonLd(store, sub) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
