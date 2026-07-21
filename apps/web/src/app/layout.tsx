import type { Metadata } from 'next';
import { Space_Grotesk, DM_Sans } from 'next/font/google';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/toast';

// Self-hosted por next/font: sin request a Google, con preload y size-adjust
// (evita el salto de layout al cargar la fuente).
const heading = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
  display: 'swap',
});

const body = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Chillberry',
  description: 'Plataforma SaaS para restaurantes',
  // El manifest es lo que le falta a iOS para recibir avisos push. Safari sólo
  // expone `PushManager` cuando el sitio está agregado a la pantalla de inicio
  // como app, y eso requiere un manifest con `display: standalone`. Sin él, en
  // iPhone el botón "Avisame cuando esté listo" ni se muestra — y como se sacó
  // WhatsApp, ese público quedaba sin ningún canal de aviso.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Chillberry', statusBarStyle: 'default' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT muta className y style del
    // <html> antes de que React hidrate, así que el markup del servidor no
    // coincide a propósito.
    <html lang="es" className={`${heading.variable} ${body.variable}`} suppressHydrationWarning>
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
