---
name: Chillberry
description: Sistema operativo de restaurantes en una sola app — claymorphism violeta, medido contra WCAG.
colors:
  brand-violet: "hsl(252 70% 53%)"
  brand-magenta: "hsl(285 70% 45%)"
  lavender-paper: "hsl(260 40% 98%)"
  pure-surface: "hsl(0 0% 100%)"
  ink-violet: "hsl(250 28% 13%)"
  muted-lavender: "hsl(258 30% 95%)"
  muted-ink: "hsl(250 12% 40%)"
  hairline: "hsl(255 26% 91%)"
  field-stroke: "hsl(250 18% 60%)"
  ok: "hsl(152 62% 40%)"
  warn: "hsl(38 92% 45%)"
  info: "hsl(205 85% 40%)"
  error: "hsl(350 75% 47%)"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontWeight: 600
    fontSize: "0.75rem"
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "tabular-nums"
rounded:
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  clay: "1.5rem"
  clay-sm: "0.875rem"
  pill: "9999px"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.brand-violet}"
    textColor: "{colors.pure-surface}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
    typography: "{typography.body}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.pure-surface}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
  panel:
    backgroundColor: "{colors.pure-surface}"
    rounded: "{rounded.clay}"
    padding: "1.5rem"
  card:
    backgroundColor: "{colors.pure-surface}"
    rounded: "{rounded.xl}"
    padding: "1.25rem"
  card-dense:
    backgroundColor: "{colors.pure-surface}"
    rounded: "{rounded.clay-sm}"
    padding: "0.875rem"
  input:
    backgroundColor: "{colors.lavender-paper}"
    textColor: "{colors.ink-violet}"
    rounded: "{rounded.clay-sm}"
    padding: "0.5rem 0.75rem"
  badge-primary:
    textColor: "{colors.brand-violet}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
---

# Design System: Chillberry

## Overview

**Creative North Star: "Arcilla Violeta"**

Cada superficie de Chillberry se siente **modelada**, no dibujada. Las tarjetas casi blancas se **inflan** sobre un fondo lavanda con una sombra tibia y difusa tintada de violeta; los campos de formulario se **hunden** como una huella (sombra interior). El borde es casi invisible a propósito — la profundidad la da la sombra, nunca un contorno duro. Es claymorphism, pero con un violeta de marca saturado (`#5533DB`) que aparece con disciplina, y con números tabulares —mono para los datos, la cara display para las cifras hero grandes— que le dan un aire premium/fintech. Cálido y táctil por el material; serio y confiable por el rigor.

Ese rigor no es decorativo: **cada par texto/fondo está medido contra WCAG AA (4.5:1), no estimado** — y medido en su peor caso (el color compuesto sobre el fondo más oscuro de los dos posibles). El sistema vive en pantallas reales y duras: un KDS que se lee a dos metros en una cocina, una caja que se toca con dedos grasosos en hora pico, y una carta pública que ve el cliente en su celular. Por eso tiene **dos densidades del mismo material** — generosa donde hay aire, contenida donde el contenido aprieta — y nunca una tercera.

Anti-referencia: nada de bordes duros como fuente de estructura, nada de gris neutro (las sombras y los neutros van tintados de violeta, no sucios), y el violeta **nunca** se usa como fondo general — es un acento y un momento hero, no un relleno.

**Key Characteristics:**
- Material de arcilla: superficies infladas (sombra + highlight superior), campos hundidos (sombra inset).
- Violeta de marca disciplinado sobre lavanda-blanco (claro) o tinta violeta (oscuro).
- Números siempre `tabular-nums`; la cara cambia por tamaño: mono JetBrains para datos (precios en listas, contadores, timers, IDs), display Hanken para las cifras hero grandes (métricas de StatCard, totales destacados).
- Contraste medido, no estimado; legibilidad como invariante, no como sugerencia.
- Dos densidades (generosa / contenida), doble tema (claro / oscuro) con alphas de sombra distintos.

## Colors

Un solo acento (violeta) que manda, sobre neutros lavanda cálidos y una familia semántica de cuatro estados; el negro no existe — todo está tintado de violeta.

### Primary
- **Violeta de Marca** (`hsl(252 70% 53%)` / `#5533DB`): el acento. Relleno de botones primarios (con texto blanco, 7.28:1), texto de marca sobre tintes (`text-primary` sobre `bg-primary/15`, 4.72:1 en el peor caso), foco, scrollbar. Su L=53% **no es negociable hacia arriba**: aclararlo rompe en silencio los cuatro sitios donde el violeta va sobre un tinte violeta. En oscuro sube a `hsl(252 90% 76%)` / `#A18BF9` para seguir legible sobre la tinta.

### Secondary
- **Magenta de Marca** (`hsl(285 70% 45%)`): segundo stop del degradé de marca (`linear-gradient(135deg, violeta, magenta)`). Sólo en momentos hero — el fondo del login, la portada de la carta QR, texto de marca (`.brand-text-gradient`). Estructural, nunca fondo general.

### Neutral
- **Papel Lavanda** (`hsl(260 40% 98%)` / `#F7F5FB`): fondo de página. Un blanco casi puro con un susurro de violeta — sobre él flotan las tarjetas. También es el fondo de los inputs (más oscuro que la tarjeta = se lee como hueco). En oscuro: **Tinta Violeta** (`#14101F`).
- **Superficie Pura** (`hsl(0 0% 100%)` / `#FFFFFF`): la tarjeta inflada. En oscuro: `#1E1830` (apenas más clara que el fondo; la separación la hace la sombra negra, no el contraste).
- **Tinta Violeta** (`hsl(250 28% 13%)`): el texto. >15:1 sobre el fondo. En oscuro: `#F6F6F9` (no blanco puro).
- **Lavanda Apagada** (`hsl(258 30% 95%)`) y **Tinta Apagada** (`hsl(250 12% 40%)`): fondo y texto secundarios (muted).
- **Hilo** (`hsl(255 26% 91%)`): el borde de las tarjetas — casi invisible (1.44:1) **a propósito**. Decorativo, nunca lo único que identifica un control.
- **Trazo de Campo** (`hsl(250 18% 60%)`): el único borde funcional — el límite del input, que sí cumple 3:1 (WCAG 1.4.11).

### Semantic
Nombres por lo que **significan**, no por a qué se parecen. Cada color tiene un pleno (`--x`, para puntos/rellenos/bordes) y un `-foreground` (el texto sobre un tinte `bg-x/15` del mismo tono). El `-foreground` NO es un oscurecido fijo: en claro va más oscuro que el tinte, en oscuro más claro, y su luminosidad se ajusta **por tono** (el canal verde pesa 0.7152 en la fórmula de luminancia, el azul 0.0722).
- **OK / Verde** (`hsl(152 62% 40%)`): éxito, estados completados.
- **Warn / Ámbar** (`hsl(38 92% 45%)`): advertencia, pendiente.
- **Info / Celeste** (`hsl(205 85% 40%)`): informativo. Es celeste y **no** violeta a propósito: un info violeta se leía como "botón de marca".
- **Error / Rosa** (`hsl(350 75% 47%)`): destructivo, error.

### Named Rules
**La Regla del Acento Único.** El violeta es acento y momento hero, jamás fondo general. Aparece en botones primarios, foco, texto de marca y degradés hero — no como relleno de superficies.

**La Regla de Medir, no Estimar.** Ningún par texto/fondo se elige "a ojo". `build`, `typecheck` y `lint` son ciegos al contraste — un par ilegible compila perfecto. La única red es medir el color compuesto (tinte sobre su base real) contra WCAG AA. Antes de tocar cualquier color, corré el script de verificación de `globals.css`.

## Typography

**Display Font:** Hanken Grotesk (con `system-ui`, sans-serif)
**Body Font:** Plus Jakarta Sans (con `system-ui`, sans-serif)
**Number Font (datos):** JetBrains Mono (con `ui-monospace`, monospace) — las cifras hero grandes usan la display (Hanken); ver la Regla del Número Tabular.

**Character:** Una grotesca de titulares apretada y con carácter (Hanken, 700, tracking negativo) contra un cuerpo humanista y cómodo (Plus Jakarta) — "editorial-tech". Los datos numéricos viven aparte, en mono tabular: es el detalle que le da el aire fintech y hace que precios y métricas se alineen en columna. Las cifras hero grandes son la excepción por tamaño: van en la display (Hanken), donde la mono se vería frágil.

### Hierarchy
- **Display / Headings** (Hanken Grotesk 700, `letter-spacing: -0.03em`, `line-height` ~1.1): `h1`–`h4`. Apretado y pesado; el carácter editorial del sistema.
- **Body** (Plus Jakarta Sans 400/500, `line-height` 1.5): texto general y etiquetas de formulario (500). Máximo cómodo de lectura 65–75ch.
- **Label** (Plus Jakarta Sans 600, `0.75rem`): badges y micro-etiquetas.
- **Datos numéricos** (JetBrains Mono 500/700, `tabular-nums`, `letter-spacing: -0.01em`): precios en listas/tablas, contadores, timers, IDs, slugs — la cifra como dato que se lee o compara. Clase `.tabular` sola.
- **Cifras hero** (Hanken + `tabular-nums`): los números grandes de StatCards, totales destacados y precios a tamaño display. Clase `.tabular font-heading` — la utility `font-heading` gana la familia y `.tabular` sólo aporta el `tabular-nums`. A tamaño grande la display lee mejor y no compite con la mono.

### Named Rules
**La Regla de las Tres Voces.** Hanken en titulares, Plus Jakarta en cuerpo, JetBrains Mono en los datos numéricos — y cada una en su lugar. (Excepción por tamaño: las cifras hero grandes van en Hanken; ver la Regla del Número Tabular.) Los botones usan la **body**, no la display: Hanken en cada botón se lee como dos fuentes compitiendo.

**La Regla del Número Tabular.** El invariante es `tabular-nums` en toda cifra significativa (dinero, cantidades, tiempos) — alinea columnas y separa el "dato" del "texto". La **cara** depende del tamaño: mono JetBrains para los datos (`.tabular`), display Hanken para las cifras hero grandes (`.tabular font-heading`). Lo que nunca cambia es el `tabular-nums`.

## Layout

Modelo de superficies flotantes: contenedores (`.panel`, `.card`) que flotan sobre el fondo lavanda con sombra clay, no cajas delimitadas por bordes. El ancho se contiene con `max-w-*` centrado; el ritmo de espaciado es la escala default de Tailwind (base 4px), generoso.

**Dos densidades, decisión explícita — elegí una, no inventes una tercera:**
- **Generosa** (radio 20–24px, sombra `clay` amplia e inflada): superficies con pocos elementos donde el clay respira. Login, register, carta QR, dashboard, tracking, repartidor. Es el **default**.
- **Contenida** (radio 14px, sombra `clay-sm` más chica): superficies densas. El KDS muestra 40 comandas en 4 columnas y se lee a 2 metros; el POS y las tablas del admin aprietan. Es **opt-in**: la página densa escribe `card card-dense`.

**Móvil:** los inputs suben a 16px de fuente en móvil (por debajo de 16px iOS hace zoom al enfocar y descuadra la página) y bajan a 14px recién en pantallas sin teclado táctil (≥640px). Los botones de sólo ícono tienen mínimo 44×44px — viven en pantallas que se usan con los dedos.

## Elevation & Depth

**Layered, por sombra — no por borde.** El sistema es claymorphism: la profundidad la crea una sombra suave y muy difusa **tintada de violeta** (`--shadow`), más un highlight interior superior que "infla" la superficie. Los bordes son casi invisibles (1.44:1). Los campos de formulario invierten el gesto: sombra **inset** (hundida). En oscuro las mismas sombras usan negro puro con alphas más altos (una sombra al 0.14 no existe sobre un fondo oscuro) y el highlight superior baja a un susurro (0.07) para no leerse como un stroke blanco.

### Shadow Vocabulary
- **`clay`** (`--shadow-clay`): la sombra amplia e inflada de la escala generosa (`.panel`, `.card`). Tres capas difusas + highlight interior.
- **`clay-sm`** (`--shadow-clay-sm`): más chica y menos difusa, escala contenida (`.card-dense`).
- **`clay-lift`** (`--shadow-clay-lift`): hover de `.card-interactive` — la sombra crece y la tarjeta sube 2px (transform, no margin).
- **`clay-inset`** (`--shadow-clay-inset`): el hueco hundido de los inputs.
- **`clay-primary`** (`--shadow-clay-primary`): glow violeta debajo de los botones de marca.
- **`glow`**: halo de marca para momentos hero (login, CTA de la carta QR).

### Named Rules
**La Regla de la Sombra Cálida.** Las sombras van tintadas de violeta (`--shadow`), nunca gris neutro. Es lo que hace que el clay se sienta cálido y no sucio.

**La Regla del Par.** Radio y sombra van en pareja. Si cambiás un radio de escala (`clay`/`clay-sm`), cambiá también su sombra — o se rompe la lectura del material.

## Motion

**El material también se comporta, no sólo se ve.** El clay tiene la física de algo físico (sombra inflada, campo hundido); el motion le da el comportamiento que esa física promete. Es **"arcilla viva"**: superficies que se **asientan** como objetos al aparecer, objetos que **respiran** cuando su estado está vivo, y valores que **reaccionan** al cambiar. Calmo donde se espera, con criterio donde se opera — nunca decoración.

**La curva de la casa:** `--ease-clay: cubic-bezier(0.22, 1, 0.36, 1)` — un ease-out con un dejo de asentamiento. Es la firma temporal del sistema; toda entrada la usa.

### Vocabulario de motion
- **`demo-enter` / `demo-stagger`**: entrada. Un bloque se asienta al aparecer (fade + `translateY` corto, `--ease-clay`); `demo-stagger` escalona los hijos directos (caen uno atrás de otro). Uso: las categorías de la carta, las StatCards del dashboard, las demos de la landing.
- **`clay-settle`**: una superficie que se asienta al aparecer (fade + `translateY` + un dejo de escala) — como una pieza de arcilla que cae en su lugar. Uso: la tarjeta del tracking.
- **`clay-breathe`**: un objeto **vivo** respira — escala lenta y simétrica + un halo de sombra que florece en el color de su tono (`currentColor`; la Regla de la Sombra llevada a motion). Lento y calmo (3.2s): es presencia, no alarma. Uso: el disco de estado del tracking, **sólo mientras la entrega está en curso**.
- **`clay-tick`**: un valor **reacciona** al cambiar — un pop de escala breve, disparado remontando el nodo con una `key` = el valor. Uso: "A cobrar" y "Vuelto" del POS.

### Named Rules
**La Regla del Motion con Significado.** El movimiento se ata a lo que significa, jamás decora: el disco respira **sólo** con la entrega viva (entregado/cancelado no); el valor tickea **sólo** al cambiar. Si un movimiento no comunica un estado o un cambio real, no va.

**La Regla del Respeto.** Todo el motion queda neutralizado por el bloque universal `prefers-reduced-motion` de `globals.css` — la accesibilidad no se negocia. Cada keyframe se diseña para que su estado 0%/100% sea el reposo, así el fallback estático es correcto.

**La Regla de la Calma Operativa.** En superficies Operate (POS, KDS) el motion no late de fondo — sólo reacciona a acciones (un tick, un asentar). Un movimiento perpetuo en una pantalla de trabajo distrae; en una de espera (tracking), un respiro lento tranquiliza.

## Shapes

Lenguaje de esquinas redondeadas y generosas, en una escala clara: 12px (controles chicos), 16px (alertas), **20px** (`.card`), **24px** (`.panel`, el tope generoso), **14px** (`.card-dense`, el contenido). Los botones y badges son **pill** (`9999px`) — el clay los quiere redondeados del todo; un botón de sólo ícono en pill es un círculo perfecto (un FAB es `btn btn-primary btn-icon btn-lg`, sin clase nueva). Sin ángulos rectos duros salvo dentro de tablas densas.

## Components

### Buttons
- **Shape:** pill (`border-radius: 9999px`). Fuente **body** (Plus Jakarta 500), no la display.
- **Primary:** violeta pleno (`--primary`) + texto blanco + glow violeta debajo (`clay-primary`). `padding: 0.5rem 1rem`. Hover: violeta al 90%.
- **Default (neutro):** superficie blanca + borde hilo + sombra `clay-sm`. Hover: fondo muted.
- **Ghost:** el "no botón" — transparente, sin sombra, texto muted. Hover: fondo muted.
- **Danger:** rosa error pleno + texto blanco.
- **Estados:** foco con `:focus-visible` (ring violeta 2px + offset 2px, nunca `:focus` que molesta al mouse). Al apretar, el botón **se hunde** (`translateY(1px)` + pierde sombra). Disabled: 50% opacidad, sin sombra.
- **Tamaños:** `btn-sm` / (default) / `btn-lg`; `btn-icon` = 44×44px mínimo táctil.

### Cards / Containers
- **Corner:** `.panel` 24px, `.card` 20px, `.card-dense` 14px.
- **Background:** superficie pura (blanco / `#1E1830` en oscuro).
- **Shadow:** `clay` (generosa) o `clay-sm` (contenida) — ver Elevation.
- **Border:** hilo casi invisible (decorativo).
- **Interactive:** `.card-interactive` — hover infla la sombra (`clay-lift`), tiñe el borde de violeta y sube 2px; active vuelve.

### Inputs / Fields
- **Style:** **hundido** — fondo lavanda (más oscuro que la tarjeta), borde funcional (`--input`, 3:1), radio 14px, sombra `clay-inset`. Es lo opuesto a la tarjeta inflada, y eso hace que el clay se lea como material.
- **Focus:** borde violeta + anillo `0 0 0 3px hsl(primary/0.2)` sumado a la sombra inset. Sin `outline` del navegador.
- **Mínimo táctil:** 44px de alto en móvil (16px de fuente para que iOS no haga zoom).

### Badges
- **Style:** pill, `padding: 0.125rem 0.5rem`, texto 600. Un color por estado (`badge-ok/warn/info/error/primary/neutral`), cada uno = tinte al 15% + texto `-foreground` medido + borde al 25%.

### Alerts
- Fila con ícono, radio 16px, tinte al 10% + borde al 30% + texto `-foreground` del estado (`alert-error/warn/ok/info`).

### Signature: la superficie de arcilla
El componente firma no es un widget sino el **material**: cualquier contenedor de página es una superficie inflada (`clay` + highlight superior) y cualquier campo es una superficie hundida (`clay-inset`). Reproducir ese contraste inflado↔hundido es lo que hace que algo "se sienta Chillberry".

## Do's and Don'ts

### Do:
- **Do** medir cada par texto/fondo contra WCAG AA (4.5:1) en su peor caso antes de commitear un color; usá el script de `globals.css`.
- **Do** elegir una de las dos densidades para cada superficie nueva: generosa (`.panel`/`.card`, default) o contenida (`.card-dense`, opt-in en KDS/POS/tablas).
- **Do** dar `tabular-nums` a toda cifra (dinero, cantidades, tiempos): `.tabular` (mono) para datos, `.tabular font-heading` (display) para las cifras hero grandes.
- **Do** mantener el par radio↔sombra (`clay`/`clay-sm`) — si tocás uno, tocá el otro.
- **Do** usar el degradé de marca (violeta→magenta) sólo en momentos hero (login, portada de carta), como estructura, no decoración.
- **Do** dar foco visible con `:focus-visible` (ring violeta), y mínimo táctil 44px en botones de ícono.
- **Do** tintar sombras y neutros de violeta — nada de gris neutro.

### Don't:
- **Don't** usar el violeta como fondo general de una pantalla; es acento y hero, no relleno.
- **Don't** subir la luminosidad del `--primary` en claro (L=53%): rompe en silencio el texto violeta sobre tintes violeta.
- **Don't** identificar un control sólo por el borde (es casi invisible a propósito) — la estructura la da la sombra.
- **Don't** usar la fuente display (Hanken) en botones ni en cuerpo; es sólo para `h1`–`h4`.
- **Don't** inventar una tercera escala de densidad ni una tercera densidad de radio/sombra.
- **Don't** meter texto controlado por el usuario en el mismo tono que un dato del sistema sin el contraste medido.
