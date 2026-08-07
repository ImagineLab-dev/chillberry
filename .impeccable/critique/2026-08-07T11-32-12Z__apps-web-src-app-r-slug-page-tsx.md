---
target: carta publica /r/[slug]
total_score: 28
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 1
timestamp: 2026-08-07T11-32-12Z
slug: apps-web-src-app-r-slug-page-tsx
---
# Critique — Carta pública de Chillberry (`/r/[slug]`)

Method: dual-agent (A: ab708714b59ada82f · B: ac8ec5db381020fda)
Modo: Persuade/Experience (superficie del comensal, QR-first). La URL `/r/test` abre el hub (link-in-bio); la carta-menú se evaluó de código + renders profundos de A.

## Design Health Score

| # | Heurística | Score | Issue clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 3 | Abierto/Cerrado, contador+total en vivo, "Calculando…", polling. Pero "Confirmar" queda deshabilitado sin decir qué falta. |
| 2 | Correspondencia mundo real | 4 | Voseo, ₲ guaraní, "Se paga al retirar", días abreviados. Impecable. |
| 3 | Control y libertad | 3 | Seguir viendo / volver / borrar línea / reintentar. El backdrop no cierra el sheet al tocar. |
| 4 | Consistencia y estándares | 3 | Convenciones de menú + design system coherente. El verde semántico colisiona con el verde de marca del tenant; el ₲ se parte. |
| 5 | Prevención de errores | 3 | Confirmar bloqueado hasta válido, mínimo de pedido, Turnstile, idempotencia. Previene pero no guía. |
| 6 | Reconocer > recordar | 4 | Chips de categoría, carrito con modificadores, precios omnipresentes, "Incluye:". |
| 7 | Flexibilidad y eficiencia | 3 | Búsqueda, salto a sección, +/− rápido, "Usar mi ubicación". |
| 8 | Estética y minimalismo | 2 | Material lindo, pero el estado por defecto (sin fotos) deja huecos, el hero verde→magenta desentona, el precio se parte. |
| 9 | Recuperación de errores | 3 | Alerts del server, Turnstile se re-emite, cotización con Reintentar. Lo client-side no tiene mensaje. |
| 10 | Ayuda y documentación | n/a | Menú autoexplicativo. |
| **Total** | | **28 / 36** | **Good (78%)** |

## Design Specificity Verdict

**LLM (A):** Se siente diseñada para el SISTEMA Chillberry, con huesos de menú genérico (apropiadamente) y un par de bordes sin terminar. Lo específico e inconfundible es el MATERIAL (tarjetas infladas, inputs hundidos, botones pill con glow, precios mono tabular) + el THEMING POR TENANT a nivel token (el color del local pisa `--primary` con `-foreground` derivado por luminancia). La carta viste la identidad del RESTAURANTE, no la de Chillberry: "Arcilla [color-del-local]". Más pensado que el 95% de los menús white-label. La IA (columna nombre/desc/precio/Agregar, chips sticky, carrito flotante, checkout en sheet) es la convención estándar — correcto para un comensal (ley de Jakob). Baja de "excelente" a "sólida" por falta de pulido en el caso común (menú sin fotos) y el degradé hero off-brand.

**Detector (B):** HTML en vivo y DOM renderizado → 0 antipatrones estructurales/visuales. Fuente `page.tsx` → 6 `design-system-font` (Playfair/Oswald/Nunito, líneas 777 y 1627). Overflow-X: ok en ambos viewports. Tap-targets <44px: 0. Imágenes rotas: 0. Errores de consola: 0. Contraste medido: subtítulo 6.24:1, botón 17.35:1 (AA holgado).

**Falsos positivos (B):** (1) los 6 `design-system-font` son las fuentes de tema seleccionables del tenant para su carta (vía `--carta-font`, con fallback web-safe + eslint-disable documentado) — es un gap de gobernanza, no un bug. (2) El contraste 1.06 del título "Chillberry" es un artefacto del tool (blanco sobre banner con gradiente oscuro; el walk-up ignoró el `background-image`).

## Overall Impression

Una carta honesta y bien construida sobre un material con identidad real. Lo que la frena no es la estructura (correctamente convencional) sino tres bordes sin pulir que aparecen justo en la superficie insignia y en el momento de compromiso: el estado por defecto sin fotos se ve inacabado, el dinero se ve glitcheado (₲ partido), y el checkout tiene un botón mudo. La mayor oportunidad: pulir el valle del checkout (peak-end ya cierra fuerte) y hacer que el theming del hero sea una unidad.

## What's Working

1. **El material claymorphism está on-spec** — tarjetas infladas con sombra violeta-tibia, inputs lavanda hundidos, botones pill con glow, precios JetBrains Mono tabular alineados. Identidad táctil coherente, no un menú genérico reskineado.
2. **Theming por tenant a nivel token con contraste derivado** — el color del local pisa `--primary`/`-foreground` (calculado por luminancia → nunca ilegible) + fuente/layout/header. La página entera toma el color del restaurante sin tocar una clase.
3. **Checkout endurecido que se siente como confianza** — idempotency key, Turnstile que se re-emite tras fallo, preview de envío con Reintentar, recuperación de pedido-en-curso, precio por canal, copy de reaseguro. Detalles operativos = tranquilidad.

## Priority Issues

### [P1] El estado por defecto (menú sin fotos) deja una columna de huecos vacíos
- **Por qué importa:** `showImages` es `true` por defecto → se reserva un slot de 112px que, sin foto, cae a un placeholder casi-blanco con ícono fantasma. En el caso más común (local que fotografió 2 platos), quedan ~38 de 40 tarjetas con el tercio izquierdo vacío. Primera impresión de la superficie insignia; lee como "roto / a medio cargar" y baja la percepción de calidad del local.
- **Fix:** cuando una sección tiene <~30% de ítems con foto, colapsar la columna de imagen y renderizar filas texto-only a ancho completo; o hacer el placeholder deliberadamente branded (tinte `--primary/8` + inicial del plato). El layout elige con/sin fotos por densidad real, no reserva el slot a ciegas.
- **Comando:** /impeccable layout

### [P2] El símbolo ₲ se parte a dos líneas en el total de cada línea del carrito
- **Por qué importa:** `formatMoney` da "₲ 24.000"; a 64px de ancho en mono 16px no entra y el ₲ queda huérfano arriba de "24.000". En cada ítem, desktop y móvil, peor con montos altos. Rompe la promesa "mono tabular = premium" justo donde se muestra el dinero.
- **Fix:** `whitespace-nowrap` + ensanchar (`min-w-[5rem]`) el contenedor del total de línea (el precio de la tarjeta ya lo tiene; acá se olvidó).
- **Comando:** /impeccable polish

### [P2] "Confirmar pedido" queda deshabilitado sin decir qué falta
- **Por qué importa:** hay feedback para ubicación/mínimo/delivery-cerrado, pero nombre/teléfono/dirección vacíos dejan el botón muerto sin pista. En móvil el botón está debajo del mapa, lejos de los campos. Casey (interrumpido) saltea el teléfono, toca Confirmar, no pasa nada → carrito abandonado en el paso de mayor intención.
- **Fix:** renglón arriba del botón con lo que falta ("Faltan: tu teléfono, la ubicación") derivado de `nameOk/phoneOk/addressOk/locationOk`, y/o marcar en rojo los requeridos vacíos al intentar confirmar. Mantener el `disabled` como red, nunca mudo.
- **Comando:** /impeccable clarify

### [P2] El degradé hero se vuelve verde→magenta (discorde) en tenants no-violetas
- **Por qué importa:** `--brand-gradient-to` está hardcodeado en magenta (`285 70% 45%`) y NO entra en `cartaThemeStyle`. Con `--primary` verde, la portada es verde→magenta: dos colores casi no relacionados que se enturbian. Es lo primero que ve el comensal y el "momento hero" se ve off-brand para el local y para Chillberry.
- **Fix:** derivar el segundo stop del primario del tenant (rotar hue ~30–40° o ajustar L/S sobre el mismo `--primary`), o usar `accentColor` del tema, dentro de `cartaThemeStyle`.
- **Comando:** /impeccable colorize

### [P3] Chips de categoría sin estado activo (sin scroll-spy)
- **Por qué importa:** en cartas largas el comensal pierde el "¿dónde estoy?". Bajo, pero es reconocimiento-sobre-recuerdo gratis.
- **Fix:** IntersectionObserver que marque el chip de la sección visible con estado activo (`btn-primary`).
- **Comando:** /impeccable animate

## Persona Red Flags

- **Casey (móvil, una mano, interrumpido):** targets +/−/trash a 44px OK. Pero "Confirmar" deshabilitado y mudo debajo del mapa, y el total con ₲ partido hace ver la columna de plata rota. El carrito persiste, pero al volver no hay "te falta X".
- **Jordan (primera vez):** aterriza en el hub, entra a la carta y ve la mayoría de ítems con slot de foto vacío → "¿se rompió?". El header verde→magenta lee como marca rara. Positivo: badge Abierto/Cerrado, precios claros, layout familiar.
- **Riley (edge cases):** 0 ítems y carta vacía → manejados (EmptyState). Textos largos envuelven sin romper. Sin fotos → el gran fallo (P1). Montos largos → empeoran el wrap del ₲.

## Minor Observations

- El backdrop del carrito (`bg-black/50`) no cierra al tocarlo — convención rota (esperás cerrar tocando afuera).
- Desktop: `max-w-2xl` deja márgenes lavanda enormes en 1280px; podría ser grilla de 2 columnas ≥lg.
- El mapa Leaflet muestra marcadores rojos de POI de OSM encima del zoom — ruido visual.
- Cupón siempre visible: candidato a progressive disclosure ("¿Tenés un cupón?" que expande).
- Gap de gobernanza: las fuentes de tema del tenant (Playfair/Oswald/Nunito) no están documentadas como excepción en DESIGN.md → el detector las marca. Documentar la excepción.

## Questions to Consider

1. Si la mayoría de los locales fotografían pocos platos, ¿`showImages: true` es el default correcto, o el layout debería auto-colapsar la columna por densidad real de fotos?
2. ¿Por qué `--brand-gradient-to` es magenta fijo y no deriva del primario del tenant?
3. Los semánticos son fijos (ok=verde, error=rosa) pero el primario es themeable → un tenant con primario cerca de un hue semántico colisiona (acá "Abierto" y "Agregar" son el mismo verde). ¿Deberían los semánticos desplazarse cuando el primario cae sobre su hue?
4. ¿El checkout debería ser un mega-sheet o partirse en 2 pasos (revisar → datos+entrega) para no violar one-thing-at-a-time en móvil?
