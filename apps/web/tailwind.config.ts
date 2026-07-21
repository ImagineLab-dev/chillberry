import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  // El tema se estampa como clase `.dark` en <html> (ver ThemeScript en
  // layout.tsx). NO usar 'media': el usuario elige el tema y el default
  // depende del rol, no del sistema operativo.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // Superficie elevada sobre el fondo (cards, paneles, popovers).
        // En claymorphism es la tarjeta "blanca inflada" sobre el fondo lavanda.
        surface: 'hsl(var(--surface))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        // Paleta semántica. Los nombres dicen QUÉ significan, no a qué se
        // parecen — `ok`/`warn`/`info`/`error` en vez de mint/butter/berry/rose.
        // Cada uno tiene `DEFAULT` (el color pleno: puntos, rellenos, bordes) y
        // `foreground` (el color del TEXTO sobre un tinte del mismo tono).
        //
        // La `foreground` NO es una versión oscura fija: en claro es más oscura
        // que el tinte y en oscuro es más clara. Además su luminosidad se ajusta
        // por tono, porque el canal verde pesa 0.7152 en la fórmula de
        // luminancia y el azul 0.0722 — un valor único para todos los tonos
        // reprueba WCAG en la mitad. Ver globals.css para los valores y sus
        // ratios medidos.
        ok: { DEFAULT: 'hsl(var(--ok))', foreground: 'hsl(var(--ok-foreground))' },
        warn: { DEFAULT: 'hsl(var(--warn))', foreground: 'hsl(var(--warn-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        error: { DEFAULT: 'hsl(var(--error))', foreground: 'hsl(var(--error-foreground))' },
        // Alias de `error` — Tailwind/shadcn lo llaman así por convención y
        // varias páginas ya usan `destructive`.
        destructive: {
          DEFAULT: 'hsl(var(--error))',
          foreground: 'hsl(var(--error-contrast))',
        },
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // ====================================================================
        // DOS ESCALAS DE DENSIDAD (decisión explícita del usuario).
        //
        // GENEROSA — `clay` (24px) y `xl` (20px): superficies con pocos
        //   elementos, donde el clay tiene aire para respirar. Login, register,
        //   menú QR, dashboard, tracking, driver. La usan `.panel` y `.card`.
        //
        // CONTENIDA — `clay-sm` (14px): superficies densas, donde 40 comandas
        //   en 4 columnas a 2 metros de distancia necesitan que el radio no se
        //   coma el contenido. KDS, POS, tablas del admin. La usa `.card-dense`,
        //   que es OPT-IN: una página densa escribe `card card-dense`.
        //
        // Mismo lenguaje visual, menos inflado. Si tocás estos números, tocá
        // también las sombras `clay`/`clay-sm` — van en pareja.
        // ====================================================================
        DEFAULT: '0.75rem', // 12px
        md: '0.75rem', // 12px — controles chicos (26 usos de rounded-md en páginas)
        lg: '1rem', // 16px — alertas, contenedores intermedios
        xl: '1.25rem', // 20px — `.card`, borde inferior de la escala generosa
        clay: '1.5rem', // 24px — `.panel`, tope de la escala generosa
        'clay-sm': '0.875rem', // 14px — `.card-dense`, escala contenida
      },
      boxShadow: {
        // Sombras suaves y MUY difusas: el clay se lee por la sombra, no por el
        // borde. Los bordes quedan casi invisibles a propósito (ver `--border`).
        // La escala xs/sm/md/lg se mantiene por contrato (páginas usan shadow-md
        // y shadow-lg) pero re-templada al lenguaje clay.
        xs: '0 1px 2px 0 hsl(var(--shadow) / 0.06)',
        sm: '0 2px 6px -1px hsl(var(--shadow) / 0.10), 0 1px 3px -1px hsl(var(--shadow) / 0.06)',
        md: '0 6px 14px -3px hsl(var(--shadow) / 0.13), 0 3px 6px -3px hsl(var(--shadow) / 0.08)',
        lg: '0 14px 30px -6px hsl(var(--shadow) / 0.16), 0 6px 12px -6px hsl(var(--shadow) / 0.10)',
        // Halo de marca para momentos hero (login, CTA principal del menú QR).
        glow: '0 0 0 1px hsl(var(--primary) / 0.1), 0 10px 30px -4px hsl(var(--primary) / 0.35)',

        // ---- Clay ----
        // Se definen como variables en globals.css porque cada tema necesita
        // ALPHAS distintos, no sólo un color distinto: en oscuro la sombra negra
        // tiene que pegar más fuerte y el highlight superior casi desaparecer.
        // Un string estático acá no puede expresar eso; una var sí.
        clay: 'var(--shadow-clay)', // escala GENEROSA: inflada y amplia
        'clay-sm': 'var(--shadow-clay-sm)', // escala CONTENIDA: más chica y menos difusa
        'clay-lift': 'var(--shadow-clay-lift)', // hover de `.card-interactive`
        'clay-inset': 'var(--shadow-clay-inset)', // hundido: inputs
        'clay-primary': 'var(--shadow-clay-primary)', // glow violeta bajo los botones de marca
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
        'scale-in': 'scale-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
