import {
  Bike,
  BookOpen,
  CalendarClock,
  Contact,
  Globe,
  QrCode,
  Store,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Centro de ayuda de Chillberry — guías paso a paso, en texto (sin video). El
 * contenido vive acá como datos para que sea fácil de mantener y de buscar; la
 * página `/admin/ayuda` lo renderiza. Escrito para dueños/encargados que recién
 * empiezan y no son técnicos: cada guía dice QUÉ hacer y DÓNDE, en orden.
 */

/** Un bloque de contenido dentro de un artículo. */
export type HelpBlock =
  | { type: 'p'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'tip'; text: string };

export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  blocks: HelpBlock[];
};

export type HelpCategory = {
  id: string;
  title: string;
  icon: LucideIcon;
  articles: HelpArticle[];
};

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    icon: BookOpen,
    articles: [
      {
        slug: 'que-es-chillberry',
        title: '¿Qué es Chillberry y por dónde empiezo?',
        summary: 'Un recorrido de 2 minutos por todo lo que hace el sistema.',
        blocks: [
          {
            type: 'p',
            text: 'Chillberry es el sistema para manejar tu restaurante de punta a punta: la carta, los pedidos (en el local, para retirar y con envío a domicilio), la caja, la cocina, los repartidores, las reservas, tus clientes y el cobro. Todo desde el mismo lugar.',
          },
          { type: 'heading', text: 'El orden recomendado para arrancar' },
          {
            type: 'steps',
            items: [
              'Cargá los datos de tu restaurante y tu(s) sucursal(es) — nombre, dirección, teléfono y horarios.',
              'Armá tu carta: categorías, productos y precios.',
              'Activá tu link público para que la gente vea la carta y pida online.',
              'Invitá a tu equipo (mozos, cajeros, cocina) y asignales su sucursal.',
              'Empezá a operar: abrí la caja, tomá pedidos y mirá cómo salen en la cocina.',
            ],
          },
          {
            type: 'tip',
            text: 'No tenés que hacer todo el primer día. Con la carta cargada y el link activo ya podés recibir pedidos.',
          },
        ],
      },
      {
        slug: 'instalar-app-pwa',
        title: 'Instalá Chillberry como app (celular o compu)',
        summary: 'Se instala como una app, sin pasar por ninguna tienda.',
        blocks: [
          {
            type: 'p',
            text: 'Chillberry es una app web instalable (PWA): la podés instalar en cualquier dispositivo directamente desde el navegador, sin App Store ni Play Store. Se abre a pantalla completa, como una app normal, y queda con su ícono en la pantalla de inicio.',
          },
          {
            type: 'p',
            text: 'Es ideal para las terminales: dejá la Caja instalada en una tablet, la Cocina en una pantalla del pase y el Mesero en el teléfono de cada mozo. Cada uno abre su puesto de un toque, sin las barras del navegador.',
          },
          { type: 'heading', text: 'En Android (Chrome)' },
          {
            type: 'steps',
            items: [
              'Abrí chillberry.app en Chrome e iniciá sesión.',
              'Tocá el menú (los tres puntos, arriba a la derecha).',
              'Elegí "Instalar app" o "Agregar a pantalla de inicio".',
            ],
          },
          { type: 'heading', text: 'En iPhone / iPad (Safari)' },
          {
            type: 'steps',
            items: [
              'Abrí chillberry.app en Safari e iniciá sesión.',
              'Tocá el botón Compartir (el cuadrado con la flecha hacia arriba).',
              'Bajá en el menú y elegí "Agregar a inicio".',
            ],
          },
          { type: 'heading', text: 'En la computadora (Chrome o Edge)' },
          {
            type: 'steps',
            items: [
              'Abrí chillberry.app.',
              'En la barra de direcciones aparece un ícono de instalar (una pantallita con una flecha). Tocalo, o buscá "Instalar Chillberry" en el menú del navegador.',
              'Confirmá. Queda como una ventana propia, sin las barras del navegador.',
            ],
          },
          {
            type: 'tip',
            text: 'Instalala en el dispositivo de cada puesto: la Caja en la tablet del cajero, la Cocina en la pantalla del pase, el Mesero en el teléfono del mozo. Además, con la app instalada llegan mejor los avisos al teléfono.',
          },
        ],
      },
      {
        slug: 'restaurante-y-sucursal',
        title: 'Configurar tu restaurante y sucursales',
        summary: 'Datos del local, dirección en el mapa y horarios de atención.',
        blocks: [
          {
            type: 'p',
            text: 'Un restaurante puede tener una o varias sucursales. Cada sucursal tiene su propia dirección, teléfono, horarios, carta pública y caja. Se configuran en Configuración → Restaurantes.',
          },
          { type: 'heading', text: 'Cargar una sucursal' },
          {
            type: 'steps',
            items: [
              'Entrá a Configuración → Restaurantes.',
              'En el restaurante, escribí el nombre, la dirección y el teléfono de la sucursal y tocá "Sumar sucursal".',
              'Tocá "Editar" en la sucursal y abrí "Ubicación en el mapa" para fijar dónde queda. Esto habilita el envío por distancia y que el sistema elija al repartidor más cercano.',
              'Guardá.',
            ],
          },
          {
            type: 'tip',
            text: 'Fijar la ubicación en el mapa es importante si vas a hacer delivery: sin coordenadas no se puede calcular bien la distancia ni rutear al repartidor.',
          },
          { type: 'heading', text: 'Horarios de atención' },
          {
            type: 'p',
            text: 'Dentro de "Carta online" de cada sucursal está el editor de horarios. Cargá los días y las franjas en que abrís. Cuando estás cerrado, la carta se puede ver pero no deja pedir, con un aviso claro para el cliente.',
          },
        ],
      },
      {
        slug: 'invitar-equipo',
        title: 'Invitar a tu equipo y asignar roles',
        summary: 'Mozos, cajeros, cocina y encargados — cada uno con su acceso.',
        blocks: [
          {
            type: 'p',
            text: 'Cada persona de tu equipo entra con su propia cuenta. Los roles definen qué puede hacer y ver: el dueño ve todo; el resto queda atado a su sucursal.',
          },
          { type: 'heading', text: 'Roles disponibles' },
          {
            type: 'list',
            items: [
              'Dueño (Owner): acceso total a todos los locales y a la facturación.',
              'Encargado (Admin): gestiona un local (carta, pedidos, reportes).',
              'Mozo: toma pedidos y abre mesas en su sucursal.',
              'Cajero: cobra y hace el cierre de caja en su sucursal.',
              'Cocina: ve las comandas en la pantalla de cocina (KDS).',
              'Repartidor (Driver): recibe y entrega los pedidos de delivery.',
            ],
          },
          { type: 'heading', text: 'Cómo invitar a alguien' },
          {
            type: 'steps',
            items: [
              'Entrá a Configuración → Equipo.',
              'Cargá el nombre, el email y el rol de la persona. Podés dejarlo sin contraseña: le llega una invitación por mail para que ponga la suya.',
              'Asignale la sucursal donde trabaja.',
              'Listo: cuando acepte la invitación, entra con su cuenta.',
            ],
          },
          {
            type: 'tip',
            text: 'Asignar la sucursal a cada empleado importa: un cajero "sin sucursal" ve la caja y la facturación de TODOS los locales. Los que están sin asignar aparecen marcados en amarillo.',
          },
        ],
      },
    ],
  },
  {
    id: 'carta',
    title: 'Tu carta',
    icon: UtensilsCrossed,
    articles: [
      {
        slug: 'cargar-productos',
        title: 'Cargar categorías y productos',
        summary: 'Armá tu menú con categorías, fotos y precios.',
        blocks: [
          {
            type: 'p',
            text: 'La carta se arma en Menú. Primero creás las categorías (Entradas, Hamburguesas, Bebidas…) y después los productos dentro de cada una.',
          },
          {
            type: 'steps',
            items: [
              'Entrá a Menú.',
              'Creá una categoría con su nombre. Podés reordenarlas: el orden es el que ve el cliente.',
              'Dentro de la categoría, agregá cada producto: nombre, descripción, precio y, si querés, una foto.',
              'Guardá. El producto ya aparece en la carta pública y en la caja.',
            ],
          },
          {
            type: 'tip',
            text: 'Una buena foto y una descripción corta suben las ventas. La descripción es opcional, pero ayuda a que el cliente se decida.',
          },
        ],
      },
      {
        slug: 'precio-delivery',
        title: 'Precio distinto para delivery',
        summary: 'Cobrá diferente en el salón y en el envío a domicilio.',
        blocks: [
          {
            type: 'p',
            text: 'Cada producto puede tener un precio de delivery distinto al de salón. Sirve para cubrir el costo del envío o las comisiones sin cambiar el precio de la mesa.',
          },
          {
            type: 'steps',
            items: [
              'Editá el producto en Menú.',
              'Cargá el "Precio delivery". Si lo dejás vacío, se usa el precio normal.',
              'En el pedido online, cuando el cliente elige envío, se aplica ese precio automáticamente — tanto en la tarjeta como en el total.',
            ],
          },
        ],
      },
      {
        slug: 'opciones-y-combos',
        title: 'Opciones, agregados y combos',
        summary: 'Punto de la carne, extras, tamaños y combos a precio fijo.',
        blocks: [
          {
            type: 'p',
            text: 'Las opciones (o "agregados") dejan que el cliente personalice un producto: el punto de la carne, extra queso, el tamaño, la guarnición. Se agrupan y cada grupo puede ser obligatorio o no, y permitir elegir uno o varios.',
          },
          {
            type: 'steps',
            items: [
              'Editá el producto y entrá a sus grupos de opciones.',
              'Creá un grupo (ej. "Punto de la carne") y marcá si es obligatorio y cuántas opciones se pueden elegir.',
              'Agregá las opciones (Jugosa, A punto, Cocida) con su costo extra si suman precio (ej. +queso $500).',
            ],
          },
          { type: 'heading', text: 'Combos' },
          {
            type: 'p',
            text: 'Un combo es un producto que agrupa a otros a un precio fijo (ej. "Hamburguesa + papas + gaseosa"). Se vende como un ítem más; en la carta se muestra qué trae con "Incluye: …".',
          },
        ],
      },
      {
        slug: 'agotado-y-diseno',
        title: 'Marcar agotado y diseñar la carta',
        summary: 'Sacar un plato por hoy sin borrarlo, y personalizar los colores.',
        blocks: [
          {
            type: 'heading', text: 'Agotado por hoy ("86")' },
          {
            type: 'p',
            text: 'Si te quedaste sin un plato, marcalo como agotado en vez de borrarlo. Aparece deshabilitado en la carta y no se puede pedir; al día siguiente lo reactivás con un clic. No perdés el producto ni su configuración.',
          },
          { type: 'heading', text: 'Diseño de la carta' },
          {
            type: 'p',
            text: 'En Diseño de carta personalizás cómo se ve tu carta pública: el color de marca, la tipografía, si mostrás fotos y descripciones, el estilo de la portada (foto, color o degradé) y el logo. El sistema elige automáticamente el color del texto para que siempre se lea bien.',
          },
        ],
      },
    ],
  },
  {
    id: 'online',
    title: 'Vender online',
    icon: Globe,
    articles: [
      {
        slug: 'link-publico',
        title: 'Tu link público para compartir',
        summary: 'El enlace que va en tu bio de Instagram o WhatsApp.',
        blocks: [
          {
            type: 'p',
            text: 'Cada sucursal tiene un link público donde la gente ve tu carta y hace pedidos. Es el que ponés en la bio de Instagram, en el estado de WhatsApp o le mandás a tus clientes.',
          },
          {
            type: 'steps',
            items: [
              'Entrá a Configuración → Restaurantes y, en la sucursal, tocá "Carta online".',
              'Elegí un enlace fácil de recordar (ej. mi-restaurante-centro). Queda como tunombre.chillberry.app o chillberry.app/r/mi-restaurante-centro.',
              'Activá "Recibir pedidos online" si querés que además de ver la carta puedan pedir.',
              'Copiá el link y compartilo.',
            ],
          },
        ],
      },
      {
        slug: 'pagina-de-botones',
        title: 'Página de botones (estilo Linktree)',
        summary: 'Que tu link muestre botones: carta, WhatsApp, redes, cómo llegar.',
        blocks: [
          {
            type: 'p',
            text: 'En vez de abrir la carta directo, tu link puede mostrar una página con botones — como un Linktree — para que el cliente elija: ver la carta y pedir, escribirte por WhatsApp, seguirte en Instagram, ver cómo llegar. Es opcional y viene apagado.',
          },
          {
            type: 'steps',
            items: [
              'Entrá a Configuración → Restaurantes → tu sucursal → "Carta online".',
              'Bajá a "Página de botones (Linktree)" y activá "Mostrar la página de botones en tu link".',
              'Usá las flechas para ordenar los botones, la casilla para mostrar u ocultar cada uno, y el campo para renombrarlos.',
              'Agregá tus links propios (Instagram, Facebook, TikTok, web, menú PDF) con "Agregar link".',
              'Guardá y tocá "Ver mi página" para verla.',
            ],
          },
          {
            type: 'tip',
            text: 'Los botones de WhatsApp y "Cómo llegar" sólo aparecen si cargaste el teléfono y la ubicación de la sucursal. Si no los ves, completá esos datos en "Editar".',
          },
          {
            type: 'p',
            text: 'La página usa el mismo diseño (colores y logo) que tu carta, así que no tenés que configurarla aparte. Si dejás el hub apagado, tu link sigue abriendo la carta directo, como siempre.',
          },
        ],
      },
      {
        slug: 'delivery-y-retiro',
        title: 'Recibir pedidos: delivery y retiro',
        summary: 'Elegí qué tipos de pedido tomás y desde qué horario.',
        blocks: [
          {
            type: 'p',
            text: 'Desde "Carta online" de la sucursal decidís cómo recibís pedidos: envío a domicilio, retiro en el local, o los dos. El cliente elige en el checkout y paga al recibir o al retirar (no hay pasarela de pago del comensal por ahora).',
          },
          {
            type: 'list',
            items: [
              'Recibir pedidos online: interruptor maestro. Apagado, la carta se ve pero no deja pedir.',
              'Acepta envío a domicilio: habilita el delivery.',
              'Acepta retiro en el local: habilita el "take away".',
            ],
          },
          { type: 'heading', text: 'Horario de delivery' },
          {
            type: 'p',
            text: 'Podés cortar el delivery antes de cerrar el local (ej. abrís hasta las 23:00 pero dejás de tomar envíos a las 22:00). Se configura en "Horario para tomar envíos". Dejalo vacío para no limitar.',
          },
        ],
      },
      {
        slug: 'costo-de-envio',
        title: 'Costo de envío y zonas',
        summary: 'Tarifa fija, por zona o por distancia, y pedido mínimo.',
        blocks: [
          {
            type: 'p',
            text: 'El envío se puede cobrar de tres formas. La más simple es una tarifa fija (un monto para todos). También podés cobrar por distancia (una base más un valor por kilómetro hasta la casa del cliente) o definir una zona con su tarifa y pedido mínimo.',
          },
          {
            type: 'steps',
            items: [
              'Tarifa fija: cargá el "Costo de envío" en "Carta online". Poné 0 si el envío es gratis.',
              'Por distancia o zona: se configura desde el tablero de Delivery. El cliente ve el costo real al fijar su ubicación en el mapa, antes de confirmar.',
            ],
          },
          {
            type: 'tip',
            text: 'El costo definitivo siempre lo calcula el sistema al crear el pedido, con la ubicación real del cliente. Así no hay sorpresas ni cobros mal calculados.',
          },
        ],
      },
    ],
  },
  {
    id: 'local',
    title: 'En el local',
    icon: Store,
    articles: [
      {
        slug: 'mesas-y-qr',
        title: 'Mesas y códigos QR',
        summary: 'Que el cliente pida desde su mesa escaneando un QR.',
        blocks: [
          {
            type: 'p',
            text: 'Cada mesa tiene un código QR. El cliente lo escanea, ve la carta y arma su pedido desde el celular; el pedido entra directo a la cocina, sin que el mozo tenga que cargarlo.',
          },
          {
            type: 'steps',
            items: [
              'Entrá a Mesas y creá tus mesas (con su número o nombre).',
              'Imprimí el QR de cada mesa y ponelo en el lugar.',
              'Cuando alguien escanea y pide, la mesa se marca ocupada y la comanda aparece en la cocina.',
            ],
          },
        ],
      },
      {
        slug: 'caja-pos',
        title: 'La caja (POS): abrir, cobrar y cerrar',
        summary: 'El día a día del cajero, paso a paso.',
        blocks: [
          {
            type: 'p',
            text: 'La Caja es la terminal donde se cobra. Se abre desde el botón "Abrir terminal → Caja". Trabaja a pantalla completa.',
          },
          { type: 'heading', text: 'Abrir la caja' },
          {
            type: 'p',
            text: 'Al empezar el turno se abre la caja cargando el monto de efectivo inicial (el fondo con el que arrancás, para dar vuelto). Ese número es el punto de partida del arqueo del cierre.',
          },
          { type: 'heading', text: 'Cobrar un pedido' },
          {
            type: 'steps',
            items: [
              'Elegí el pedido o la mesa a cobrar.',
              'Seleccioná el medio de pago (efectivo, tarjeta) o dividí la cuenta.',
              'Confirmá. El pedido queda pagado y, si la mesa no tiene otro pedido abierto, se libera.',
            ],
          },
          {
            type: 'p',
            text: 'Podés dividir la cuenta en partes, aplicar un descuento, hacer un reembolso (topeado a lo cobrado en efectivo) y registrar propinas.',
          },
          { type: 'heading', text: 'Cerrar la caja' },
          {
            type: 'p',
            text: 'Al final del turno hacés el cierre: el sistema muestra lo que debería haber (ventas por medio de pago, propinas, reembolsos) para compararlo con lo que contás en la gaveta.',
          },
        ],
      },
      {
        slug: 'cocina-kds',
        title: 'La pantalla de cocina (KDS)',
        summary: 'Las comandas ordenadas para que la cocina no pierda ninguna.',
        blocks: [
          {
            type: 'p',
            text: 'La Cocina (KDS) muestra las comandas a medida que entran, vengan de un mozo, de un QR de mesa o de un pedido online. Se abre desde "Abrir terminal → Cocina".',
          },
          {
            type: 'steps',
            items: [
              'Cada comanda aparece con sus productos y las notas ("sin cebolla", "bien cocido").',
              'La cocina va marcando el avance: aceptada, en preparación, lista.',
              'Cuando está lista, el mozo o el cliente se enteran del cambio de estado.',
            ],
          },
          {
            type: 'tip',
            text: 'Si tenés varias estaciones (parrilla, barra), las comandas se pueden separar por estación para que cada una vea sólo lo suyo.',
          },
        ],
      },
      {
        slug: 'mozo',
        title: 'La terminal del mozo',
        summary: 'Abrir mesas y cargar pedidos desde el salón.',
        blocks: [
          {
            type: 'p',
            text: 'El Mozo abre mesas, carga los pedidos de los comensales y los manda a la cocina. Se abre desde "Abrir terminal → Mesero".',
          },
          {
            type: 'steps',
            items: [
              'Elegí la mesa y abrila.',
              'Agregá los productos, con sus opciones y notas.',
              'Enviá a cocina. La comanda aparece en el KDS al instante.',
              'Podés seguir sumando pedidos a la misma mesa; se acumulan en su cuenta.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery',
    icon: Bike,
    articles: [
      {
        slug: 'como-funciona-delivery',
        title: 'Cómo funciona el reparto',
        summary: 'Del pedido online al repartidor y al seguimiento del cliente.',
        blocks: [
          {
            type: 'p',
            text: 'Cuando entra un pedido con envío, se crea automáticamente en el tablero de Delivery y se asigna a un repartidor. El cliente sigue su pedido en un mapa en vivo, sin instalar nada.',
          },
          {
            type: 'steps',
            items: [
              'El pedido online con envío entra al tablero de Delivery.',
              'El sistema propone al repartidor más cercano (por eso importa tener la ubicación de la sucursal cargada).',
              'El repartidor recibe el pedido en su terminal, lo retira y lo entrega.',
              'Al entregar, ingresa un código de 6 dígitos que le da el cliente, confirmando la entrega.',
            ],
          },
        ],
      },
      {
        slug: 'repartidores',
        title: 'Repartidores y seguimiento',
        summary: 'Sumar repartidores y qué ve el cliente.',
        blocks: [
          {
            type: 'p',
            text: 'Los repartidores son usuarios con rol Repartidor (Driver). Al crear uno, se le arma su perfil automáticamente. Entran a su propia terminal, donde ven sólo los pedidos que tienen que llevar.',
          },
          {
            type: 'p',
            text: 'El cliente recibe un link de seguimiento propio y seguro (no expone datos internos). Ahí ve al repartidor moverse en el mapa y el estado de su pedido en tiempo real.',
          },
        ],
      },
    ],
  },
  {
    id: 'reservas',
    title: 'Reservas',
    icon: CalendarClock,
    articles: [
      {
        slug: 'gestionar-reservas',
        title: 'Tomar y gestionar reservas',
        summary: 'Anotá las reservas de mesa y su estado.',
        blocks: [
          {
            type: 'p',
            text: 'En Reservas anotás las reservas de mesa: nombre, teléfono, cantidad de personas, fecha y hora. Podés ir cambiando su estado (confirmada, sentada, cancelada) a lo largo del día.',
          },
          {
            type: 'steps',
            items: [
              'Entrá a Reservas.',
              'Cargá una reserva nueva con los datos del cliente y el horario.',
              'A medida que avanza el día, actualizá el estado.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'clientes',
    title: 'Clientes y marketing',
    icon: Contact,
    articles: [
      {
        slug: 'clientes-cupones-opiniones',
        title: 'Clientes, cupones y opiniones',
        summary: 'Tu base de clientes, descuentos y reseñas.',
        blocks: [
          {
            type: 'heading', text: 'Base de clientes' },
          {
            type: 'p',
            text: 'Cada pedido con teléfono va sumando tu base de clientes. Desde Clientes ves quién te compra y con qué frecuencia.',
          },
          { type: 'heading', text: 'Cupones' },
          {
            type: 'p',
            text: 'Creá códigos de descuento (por ejemplo, un porcentaje o un monto fijo) para campañas. El cliente lo escribe en el checkout y el sistema lo valida: si está vencido, agotado o no aplica, el pedido avisa el motivo. Podés limitar un cupón a un solo uso.',
          },
          { type: 'heading', text: 'Opiniones' },
          {
            type: 'p',
            text: 'Después de un pedido podés pedirle al cliente que deje su opinión. Las reseñas se juntan en Opiniones para que veas cómo venís.',
          },
        ],
      },
    ],
  },
  {
    id: 'cuenta',
    title: 'Tu cuenta',
    icon: Wallet,
    articles: [
      {
        slug: 'facturacion-y-planes',
        title: 'Facturación y planes',
        summary: 'Tu suscripción, los límites del plan y cómo cambiarlo.',
        blocks: [
          {
            type: 'p',
            text: 'Tu suscripción a Chillberry se maneja en Configuración → Facturación. Cada plan define límites (por ejemplo, cuántas sucursales y cuántos usuarios podés tener) y qué funciones incluye.',
          },
          {
            type: 'steps',
            items: [
              'Entrá a Configuración → Facturación para ver tu plan actual y su estado.',
              'Para cambiar de plan, elegí el nuevo. Un upgrade pasa por el cobro; se aplica cuando el pago se aprueba.',
              'Para bajar de plan, primero tenés que estar dentro de los límites del plan más chico (menos sucursales o usuarios de los que permite).',
            ],
          },
          {
            type: 'tip',
            text: 'Si tu suscripción vence, el sistema pasa a solo lectura: podés seguir viendo todo, pero no cargar pedidos ni operar hasta regularizar el pago. La carta pública también deja de tomar pedidos.',
          },
        ],
      },
      {
        slug: 'reportes',
        title: 'Reportes y control',
        summary: 'Ventas, márgenes y control interno.',
        blocks: [
          {
            type: 'p',
            text: 'En Análisis → Reportes ves tus ventas y márgenes. En Control tenés herramientas de control interno para revisar movimientos y detectar diferencias.',
          },
          {
            type: 'tip',
            text: 'Revisar los reportes por sucursal y por medio de pago, cada cierre, es la mejor forma de detectar temprano una diferencia de caja.',
          },
        ],
      },
    ],
  },
];

/** Todos los artículos en una lista plana — cómodo para buscar y para deep-links. */
export const ALL_ARTICLES: (HelpArticle & { categoryId: string; categoryTitle: string })[] =
  HELP_CATEGORIES.flatMap((c) =>
    c.articles.map((a) => ({ ...a, categoryId: c.id, categoryTitle: c.title })),
  );

/** Texto plano de un artículo (título + resumen + cuerpo) para el buscador. */
export function articleSearchText(a: HelpArticle): string {
  const parts: string[] = [a.title, a.summary];
  for (const b of a.blocks) {
    if (b.type === 'p' || b.type === 'heading' || b.type === 'tip') parts.push(b.text);
    else parts.push(...b.items);
  }
  return parts.join(' ').toLowerCase();
}
