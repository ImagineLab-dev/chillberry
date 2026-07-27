import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/toast';

// Self-hosted por next/font: sin request a Google, con preload y size-adjust
// (evita el salto de layout al cargar la fuente).
//
// Sistema tipográfico (rediseño): display grotesque con pesos altos para el
// carácter "editorial-tech", cuerpo humanista legible, y una mono para todo dato
// numérico (precios, métricas, timers, IDs) — la alineación tabular es lo que le
// da el aire premium/fintech.
const heading = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-heading',
  display: 'swap',
});

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

// Dominio público — necesario para que las URLs de Open Graph, canonical y las
// imágenes OG se resuelvan absolutas (Next avisa si falta y rompe los previews).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chillberry.app';

const SITE_TITLE = 'Chillberry — El sistema completo para tu restaurante';
const SITE_DESCRIPTION =
  'Pedidos, cocina, caja, delivery y carta con QR trabajando juntos, en cualquier teléfono o tablet. Sin comisión por venta y sin instalar nada. Probalo gratis.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // La home usa `absolute` (ver page.tsx); el resto de las páginas que ponen
    // `title: 'X'` quedan como "X · Chillberry".
    default: SITE_TITLE,
    template: '%s · Chillberry',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'Chillberry',
  keywords: [
    'software para restaurantes',
    'sistema de gestión gastronómica',
    'carta con QR',
    'menú digital',
    'punto de venta restaurante',
    'POS gastronómico',
    'delivery propio',
    'comanda a cocina',
  ],
  authors: [{ name: 'Chillberry' }],
  // El manifest es lo que le falta a iOS para recibir avisos push. Safari sólo
  // expone `PushManager` cuando el sitio está agregado a la pantalla de inicio
  // como app, y eso requiere un manifest con `display: standalone`. Sin él, en
  // iPhone el botón "Avisame cuando esté listo" ni se muestra — y como se sacó
  // WhatsApp, ese público quedaba sin ningún canal de aviso.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Chillberry', statusBarStyle: 'default' },
  // Íconos para instalar como app. iOS NO lee el manifest para el ícono de la
  // pantalla de inicio: necesita `apple-touch-icon` sí o sí (sin él usa una
  // captura recortada). Chrome/Android toma los PNG del manifest.
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Preview al compartir el link (WhatsApp/Instagram/Facebook) y tarjeta de X.
  // La imagen sale sola de `app/opengraph-image.png`. Las páginas públicas de
  // cada restaurante pisan esto con su nombre/foto (ver sus `generateMetadata`).
  openGraph: {
    type: 'website',
    siteName: 'Chillberry',
    locale: 'es_AR',
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // `viewport-fit=cover`: en iPhone con notch, la app instalada usa toda la
  // pantalla y las barras fijas leen `env(safe-area-inset-*)` para no quedar
  // tapadas por el notch ni la barra de inicio.
  viewportFit: 'cover',
  // Tinta la barra del navegador móvil según el tema — que combine con la página
  // en vez de quedar blanca de fábrica.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F5FB' },
    { media: '(prefers-color-scheme: dark)', color: '#14101F' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT muta className y style del
    // <html> antes de que React hidrate, así que el markup del servidor no
    // coincide a propósito.
    <html
      lang="es"
      className={`${heading.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Bloqueante y antes del primer paint: sin esto la página aparece un
            frame en el tema equivocado al recargar. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
