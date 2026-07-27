import type { Metadata } from 'next';

/**
 * La carta (`/r/[slug]/page.tsx`) es un componente client (carrito, mapa, etc.),
 * así que NO puede exportar metadata. Este layout server sí: con `generateMetadata`
 * trae el nombre y la foto del restaurante y arma el título, la descripción y el
 * Open Graph propios. Resultado: compartir el link de una carta muestra un preview
 * con el nombre y la foto del local (no el genérico de Chillberry), y Google ve un
 * título por restaurante en vez de un cascarón vacío.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://chillberry.app/api';

type BranchMeta = {
  restaurantName?: string;
  branchName?: string;
  branchAddress?: string;
  branchCoverImageUrl?: string | null;
  restaurantLogoUrl?: string | null;
};

async function fetchBranch(slug: string): Promise<BranchMeta | null> {
  try {
    // Cache 5 min: un crawler que golpea muchas veces no martilla la API, y el
    // dato de metadata (nombre/foto) casi no cambia.
    const res = await fetch(`${API_BASE}/public/menu/branch/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as BranchMeta;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const branch = await fetchBranch(slug);

  if (!branch?.restaurantName) {
    return { title: 'Carta online', description: 'Mirá la carta y pedí delivery o retiro online.' };
  }

  const nombre =
    branch.branchName && branch.branchName !== branch.restaurantName
      ? `${branch.restaurantName} · ${branch.branchName}`
      : branch.restaurantName;
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

export default function CartaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
