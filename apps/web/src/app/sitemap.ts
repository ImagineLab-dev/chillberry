import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chillberry.app';

/**
 * Sitemap del sitio de MARKETING (la landing + registro). Las cartas públicas
 * de cada restaurante (`/r/:slug`) no se listan acá a propósito: son de cada
 * cliente y se descubren por el link que ellos comparten (con su propio OG, ver
 * su `generateMetadata`). Si algún día se quiere indexarlas, hace falta un
 * endpoint público que liste los slugs activos y mapearlos acá.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
