import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  BarChart3,
  Bike,
  Check,
  ChefHat,
  ChevronDown,
  Clock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Star,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import { BerryIcon } from '@/components/berry-icon';
import { DemoShowcase } from '@/components/landing/demo-showcase';
import { CommissionCalculator } from '@/components/landing/commission-calculator';

export const metadata: Metadata = {
  title: 'Chillberry — El sistema completo para tu restaurante',
  description:
    'Pedidos, cocina, caja, delivery y carta con QR en un solo lugar. Probalo gratis: sin instalar nada, funciona desde cualquier teléfono o tablet.',
};

const FEATURES = [
  {
    icon: ChefHat,
    title: 'La comanda llega sola a cocina',
    body: 'El mozo carga el pedido y aparece al instante en la pantalla de cocina, separado por estación. Se acabaron los papeles perdidos y el "¿esto ya salió?". Y si se corta internet, la cocina sigue trabajando y sincroniza sola cuando vuelve.',
  },
  {
    icon: QrCode,
    title: 'Tu carta con QR, sin comisiones',
    body: 'El comensal escanea, ve tu carta con fotos y pide desde la mesa. También tenés un link para compartir en Instagram o WhatsApp con delivery y retiro.',
  },
  {
    icon: Wallet,
    title: 'Caja que cierra cuadrada',
    body: 'Cobros divididos, propinas, descuentos y arqueo de caja. Cada anulación y cada descuento queda registrado con quién lo hizo y por qué.',
  },
  {
    icon: Bike,
    title: 'Delivery con seguimiento en vivo',
    body: 'Asigna el repartidor más cercano automáticamente y tu cliente sigue el pedido en un mapa, sin instalar ninguna app.',
  },
  {
    icon: BarChart3,
    title: 'Sabés qué te deja plata',
    body: 'No solo cuánto vendiste: qué producto deja más margen, a qué hora es tu pico y cuánto factura cada mozo. Con stock que baja solo al vender.',
  },
  {
    icon: ShieldCheck,
    title: 'Control de lo que no se ve',
    body: 'Anulaciones, descuentos y movimientos de caja, con responsable y motivo. La respuesta a "¿cómo sé que no me roban?".',
  },
];

// Antes/después: el patrón que más convierte en landings de producto, pero sólo
// sirve si el "antes" es reconocible. Cada línea es un dolor concreto de un
// servicio, no una generalidad — y cada "después" corresponde a algo que el
// producto realmente hace hoy.
const BEFORE = [
  'La comanda va en papel y se pierde entre el salón y la cocina',
  '"¿Esta mesa ya pagó?" — y hay que preguntarle a tres personas',
  'Los pedidos entran por WhatsApp y alguien los copia a mano',
  'La caja no cuadra y no sabés en qué momento se descuadró',
  'Te enterás de que no hay stock cuando el plato ya se vendió',
  'El reporte del mes es una planilla que alguien arma el lunes',
];

const AFTER = [
  'El mozo carga el pedido y aparece en cocina, separado por estación',
  'Cada mesa muestra su cuenta en vivo: lo pagado y lo que falta',
  'El pedido entra solo desde tu carta con QR o tu link público',
  'Cada descuento y anulación queda con responsable, motivo y hora',
  'El stock baja solo al vender y ves qué está por acabarse',
  'Los reportes ya están hechos: por día, por hora, por mozo y por producto',
];

const STEPS = [
  {
    title: 'Creá tu cuenta y cargá tu carta',
    body: 'No hace falta la carta entera para empezar: con tus 10 platos más vendidos ya podés operar.',
  },
  {
    title: 'Imprimí el QR de tus mesas',
    body: 'Cada mesa tiene su código. Y te llevás un link público para pegar en Instagram o WhatsApp con delivery y retiro.',
  },
  {
    title: 'Abrí cocina y caja',
    body: 'Una tablet en la cocina, el celular del mozo y la compu de la caja. Todo en el navegador, sin instalar nada.',
  },
];

// Las objeciones reales que frenan la compra. Las respuestas dicen la verdad,
// incluida la incómoda (necesita internet): una landing que esconde eso pierde
// al cliente en el primer día de uso, no en la venta.
const FAQS = [
  {
    q: '¿Tengo que instalar algo o comprar equipos?',
    a: 'No. Chillberry corre en el navegador de lo que ya tenés: el celular del mozo, una tablet en la cocina y la computadora de la caja. Una tablet vieja alcanza para la pantalla de cocina.',
  },
  {
    q: '¿Cobran comisión por cada venta?',
    a: 'No. Pagás el plan por mes y listo, vendas 10 pedidos o 10.000. Tu carta con QR y tu link público son tuyos.',
  },
  {
    q: '¿Y si se me corta internet?',
    a: 'La pantalla de cocina sigue funcionando: el cocinero puede marcar los platos igual y las acciones quedan en una cola que se sincroniza sola cuando vuelve la conexión, con un cartel que avisa cuántas hay pendientes. El resto del sistema sí necesita internet para cargar pedidos nuevos, así que si tu conexión es inestable conviene tener los datos del celular como respaldo.',
  },
  {
    q: '¿Mis mozos van a saber usarlo?',
    a: 'La pantalla del mozo tiene tres cosas: sus mesas, la carta para cargar el pedido y el botón de pedir la cuenta. Nada más. La cocina es una sola pantalla con las comandas y un botón por plato.',
  },
  {
    q: '¿Sirve si tengo más de un local?',
    a: 'Sí. Cada sucursal tiene su carta, sus mesas, su caja y su stock. El dueño ve cada una por separado o todo consolidado, desde el mismo usuario.',
  },
  {
    q: '¿Cómo sé que no me roban?',
    a: 'Cada descuento, cada anulación y cada movimiento de caja queda registrado con quién lo hizo, cuándo y por qué. Hay una pantalla de Control dedicada a eso, y el arqueo te muestra la diferencia entre lo declarado y lo cobrado.',
  },
  {
    q: '¿Puedo sacar mis datos?',
    a: 'Sí. Los reportes se descargan en CSV para abrirlos en Excel y se imprimen en PDF. Tu información está aislada de la de cualquier otro restaurante.',
  },
  {
    q: '¿Cuánto tarda en estar andando?',
    a: 'Lo que más lleva es cargar la carta. Con la carta lista, el QR de las mesas y la pantalla de cocina quedan funcionando esa misma tarde.',
  },
];

const PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    price: 29,
    tagline: 'Para el local que arranca',
    branches: '1 sucursal',
    users: 'Hasta 5 usuarios',
    highlighted: false,
  },
  {
    code: 'PRO',
    name: 'Pro',
    price: 79,
    tagline: 'El que eligen la mayoría',
    branches: 'Hasta 3 sucursales',
    users: 'Hasta 15 usuarios',
    highlighted: true,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    price: 199,
    tagline: 'Para cadenas',
    branches: 'Hasta 10 sucursales',
    users: 'Hasta 50 usuarios',
    highlighted: false,
  },
];

// Todos los planes incluyen el producto completo; lo que cambia es la escala.
const PLAN_INCLUDES = [
  'Pedidos, mesas y reservas',
  'Pantalla de cocina (KDS)',
  'Caja y arqueo',
  'Delivery con seguimiento',
  'Carta con QR y link público',
  'Reportes y control interno',
  'Avisos por WhatsApp',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---------------------------------------------------------- nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2">
            <BerryIcon className="h-7 w-7 shrink-0" />
            <span className="font-heading text-lg font-semibold tracking-tight">Chillberry</span>
          </span>
          {/* Los anclas quedan en desktop: en móvil compiten con el CTA y el
              usuario ya tiene la barra fija de abajo. */}
          <div className="hidden items-center gap-5 text-sm text-muted-foreground lg:flex">
            <a href="#demo" className="hover:text-foreground">
              Cómo funciona
            </a>
            <a href="#precios" className="hover:text-foreground">
              Precios
            </a>
            <a href="#faq" className="hover:text-foreground">
              Preguntas
            </a>
          </div>
          {/* En 375px el logo + dos botones con texto largo no entran y la
              página termina scrolleando de costado. En móvil el CTA principal ya
              vive en la barra fija de abajo, así que acá queda sólo el acceso
              para el que ya es cliente. */}
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost min-h-[44px]">
              <span className="sm:hidden">Entrar</span>
              <span className="hidden sm:inline">Iniciar sesión</span>
            </Link>
            <Link href="/register" className="btn btn-primary hidden min-h-[44px] sm:inline-flex">
              Crear cuenta gratis
            </Link>
          </div>
        </nav>
      </header>

      {/* --------------------------------------------------------- hero */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-14 text-center sm:pt-20">
        <span className="badge badge-primary mb-5">Para restaurantes, cafés y food trucks</span>
        <h1 className="mx-auto max-w-3xl font-heading text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {/* `block` para que la frase destacada arranque siempre en su propia
              línea. Si se deja fluir, el quiebre cae donde entre y el "en"
              queda huérfano al final del primer renglón. */}
          Todo tu restaurante, <span className="block text-primary">en una sola pantalla</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Pedidos, cocina, caja, delivery y carta con QR trabajando juntos. Sin papeles, sin planillas y sin pagar
          comisión por cada venta.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className="btn btn-primary btn-lg min-h-[44px]">
            Crear cuenta gratis
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#demo" className="btn btn-lg min-h-[44px]">
            Ver cómo funciona
          </a>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Sin tarjeta de crédito · Funciona en cualquier teléfono, tablet o computadora
        </p>

        <ul className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Smartphone className="h-4 w-4 text-primary" /> Nada que instalar
          </li>
          <li className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-primary" /> Listo en una tarde
          </li>
          <li className="flex items-center gap-1.5">
            <UtensilsCrossed className="h-4 w-4 text-primary" /> Varias sucursales
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------ antes / después */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-10 text-center">
            <h2 className="font-heading text-3xl font-bold tracking-tight">Un sábado a las nueve de la noche</h2>
            <p className="mt-3 text-base text-muted-foreground">
              El problema no es que falte software. Es que el salón, la cocina y la caja no se hablan.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="card p-6">
              <h3 className="mb-4 font-heading text-lg font-semibold text-muted-foreground">Como se trabaja hoy</h3>
              <ul className="space-y-3">
                {BEFORE.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-error-foreground" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            <div className="card p-6 ring-2 ring-primary">
              <h3 className="mb-4 font-heading text-lg font-semibold">Con Chillberry</h3>
              <ul className="space-y-3">
                {AFTER.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok-foreground" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- demo */}
      <section id="demo" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12">
        <div className="mb-6 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight">Mirá cómo lo ve cada uno</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Cada persona de tu equipo ve solo lo que necesita — y tu cliente también.
          </p>
        </div>
        <DemoShowcase />
      </section>

      {/* ----------------------------------------------------- features */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-10 text-center">
            <h2 className="font-heading text-3xl font-bold tracking-tight">Lo que resuelve, en concreto</h2>
            <p className="mt-3 text-base text-muted-foreground">
              No es un software más: es el día a día de tu local, ordenado.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card p-5">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <f.icon className="h-5 w-5 text-primary" />
                </span>
                <h3 className="mb-2 font-heading text-lg font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------- costo de no cambiar */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight">
            ¿Cuánto te cuesta vender por las apps?
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground">
            Poné tus números. La cuenta la hacés vos — nosotros no cobramos comisión por venta, ni una sola vez.
          </p>
        </div>
        <CommissionCalculator planMonthlyUsd={PLANS.find((p) => p.highlighted)?.price ?? PLANS[0]!.price} />
      </section>

      {/* --------------------------------------------------------- pasos */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-10 text-center">
            <h2 className="font-heading text-3xl font-bold tracking-tight">Estás andando en una tarde</h2>
            <p className="mt-3 text-base text-muted-foreground">
              Sin técnico, sin cableado y sin cerrar el local un día para migrar.
            </p>
          </div>
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="card p-6">
                <span
                  className="tabular mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary font-heading font-bold text-primary-foreground"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <h3 className="mb-2 font-heading text-lg font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------- precios */}
      <section id="precios" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight">Precios claros, sin comisión por venta</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Todos los planes incluyen el producto completo. Lo único que cambia es cuántas sucursales y usuarios.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.code}
              className={`card flex flex-col p-6 ${p.highlighted ? 'ring-2 ring-primary' : ''}`}
            >
              {p.highlighted && <span className="badge badge-primary mb-3 self-start">Más elegido</span>}
              <h3 className="font-heading text-xl font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
              <p className="mt-4">
                <span className="tabular font-heading text-4xl font-bold">${p.price}</span>
                <span className="text-sm text-muted-foreground"> USD/mes</span>
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                <li className="flex items-start gap-2 font-medium">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok-foreground" />
                  {p.branches}
                </li>
                <li className="flex items-start gap-2 font-medium">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok-foreground" />
                  {p.users}
                </li>
                {PLAN_INCLUDES.map((inc) => (
                  <li key={inc} className="flex items-start gap-2 text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok-foreground" />
                    {inc}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={`btn mt-6 min-h-[44px] w-full justify-center ${p.highlighted ? 'btn-primary' : ''}`}
              >
                Empezar con {p.name}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- faq */}
      <section id="faq" className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
          <div className="mb-8 text-center">
            <h2 className="font-heading text-3xl font-bold tracking-tight">Lo que todos preguntan</h2>
          </div>
          {/* <details> nativo: accesible por teclado y funciona aunque el JS no
              cargue — en una landing eso importa más que la animación. */}
          <div className="space-y-3">
            {FAQS.map((item) => (
              <details key={item.q} className="card group p-0">
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 p-4 font-heading font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="border-t border-border px-4 py-4 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- cta final */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <Star className="mx-auto mb-4 h-8 w-8 text-primary" />
          <h2 className="font-heading text-3xl font-bold tracking-tight">Probalo con tu propia carta</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Creá tu cuenta, cargá tus productos y en una tarde tenés el QR de tus mesas funcionando.
          </p>
          <Link href="/register" className="btn btn-primary btn-lg mt-7 min-h-[44px]">
            Crear cuenta gratis
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------- footer */}
      {/* pb extra en móvil: la barra fija de abajo taparía la última línea. */}
      <footer className="border-t border-border pb-20 sm:pb-0">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <BerryIcon className="h-5 w-5 shrink-0" />
            <span className="font-heading font-semibold text-foreground">Chillberry</span>
            <span>· Software para restaurantes</span>
          </span>
          <span className="flex items-center gap-4">
            <Link href="/login" className="hover:text-foreground">
              Iniciar sesión
            </Link>
            <a href="#precios" className="hover:text-foreground">
              Precios
            </a>
          </span>
        </div>
      </footer>

      {/* ------------------------------------------- cta fijo (sólo móvil) */}
      {/* En desktop el CTA del nav queda siempre a la vista; en móvil no, y el
          recorrido es largo. pb con safe-area para no quedar bajo el gesto de
          home de iOS. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <Link href="/register" className="btn btn-primary btn-lg min-h-[44px] w-full justify-center">
          Crear cuenta gratis
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
