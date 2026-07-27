import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chillberry.app';

/**
 * `robots.txt` generado por App Router. Público lo que se comparte (landing,
 * registro, cartas de restaurantes `/r`, `/s`, `/menu`, seguimiento `/track`);
 * bloqueado todo lo de staff (que igual está detrás de login) y la API.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/pos', '/kitchen', '/waiter', '/driver', '/super-admin', '/login', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
