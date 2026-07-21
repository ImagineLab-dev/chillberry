/**
 * Plantilla de los mails transaccionales de Chillberry.
 *
 * Tres decisiones que importan más que el diseño:
 *
 * 1. **El logo va INCRUSTADO como SVG, no como imagen remota.** Si el logo se
 *    cargara desde un servidor, cada apertura del mail dispararía una petición
 *    que revela IP, cliente de correo y momento exacto de lectura — y si la URL
 *    llevara un identificador, se filtraría a cada intermediario que toque el
 *    mensaje. Incrustado no se pide nada a nadie: el mail se ve completo aunque
 *    el cliente bloquee imágenes (que es lo que hacen Gmail y Outlook por
 *    defecto con remitentes nuevos).
 *
 * 2. **El código NO viaja en ningún enlace.** Un código en una URL termina en el
 *    historial del navegador, en el `Referer` de la primera página que se abra
 *    después, y en los logs de cualquier proxy. Va sólo como texto para copiar.
 *
 * 3. **Nada de datos internos en el HTML.** Ni ids de tenant, ni endpoints de la
 *    API, ni el correo del destinatario repetido en atributos. Quien mire el
 *    código fuente del mail no encuentra nada que no esté ya a la vista.
 *
 * El HTML es de tablas y estilos en línea a propósito: los clientes de correo no
 * soportan flexbox, grid ni hojas de estilo externas.
 */

/** Violeta de marca (`--primary` en claro). En el mail va en hex: los clientes no resuelven variables CSS. */
const VIOLETA = '#5533DB';
const TEXTO = '#1B1633';
const TENUE = '#6B6785';
const BORDE = '#E7E4F5';
const FONDO = '#F5F3FC';

/**
 * El logo, aplanado a hex desde `BerryIcon`. Sin `<defs>` con ids: varios
 * clientes de correo reescriben o descartan los gradientes con referencias, así
 * que se usan colores planos que se ven igual en todos.
 */
const LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M16.5 15C15.7 11.3 15 8.2 18 5.3" fill="none" stroke="#5C8F74" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/>
  <path d="M20 15.8C19.2 12.2 18.4 8.8 18 5.3" fill="none" stroke="#5C8F74" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/>
  <path d="M18 5.3C19.8 3.3 23 3.4 24.6 5.5C22.9 7.7 19.5 8.1 18 5.3Z" fill="#3FBF87"/>
  <circle cx="13" cy="21.3" r="7" fill="#5533DB"/>
  <circle cx="20.5" cy="22" r="6.4" fill="#A63FD1"/>
  <ellipse cx="10.6" cy="18.5" rx="1.9" ry="1.3" fill="#FFFFFF" opacity="0.3"/>
  <ellipse cx="18.4" cy="19.4" rx="1.5" ry="1" fill="#FFFFFF" opacity="0.25"/>
</svg>`;

export interface MailCodigoInput {
  /** Encabezado grande. Ej: "Creá tu cuenta". */
  titulo: string;
  /** Frase corta debajo del título. */
  bajada: string;
  /** El código de 6 dígitos. */
  codigo: string;
  /** Minutos de vigencia, para decirlo explícito. */
  vigenciaMinutos: number;
  /** Qué hacer si no fue el usuario quien lo pidió. */
  siNoFuiste: string;
}

/**
 * Mail con el código. Devuelve las dos versiones: los clientes que no muestran
 * HTML (o el usuario que lo tiene desactivado) reciben el texto plano, que no es
 * un descarte — es la versión que le llega a mucha gente.
 */
export function mailDeCodigo(input: MailCodigoInput): { html: string; text: string } {
  const { titulo, bajada, codigo, vigenciaMinutos, siNoFuiste } = input;

  const text =
    `${titulo}\n\n${bajada}\n\n` +
    `Tu código es: ${codigo}\n\n` +
    `Vence en ${vigenciaMinutos} minutos.\n\n` +
    `${siNoFuiste}\n\n` +
    `Chillberry — el sistema de tu restaurante\n` +
    `Este correo se envió automáticamente. No hace falta responderlo.`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${FONDO};">
  <!-- Preencabezado: lo que se lee en la bandeja antes de abrir. Se oculta en el
       cuerpo para que no aparezca dos veces. NO lleva el código: la vista previa
       de la bandeja es visible en la pantalla bloqueada del teléfono. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapar(bajada)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FONDO};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:16px;border:1px solid ${BORDE};">

          <tr>
            <td style="padding:32px 32px 8px 32px;" align="center">
              ${LOGO_SVG}
              <div style="margin-top:10px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;color:${TEXTO};letter-spacing:-0.2px;">
                Chillberry
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 0 32px;" align="center">
              <h1 style="margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:${TEXTO};">
                ${escapar(titulo)}
              </h1>
              <p style="margin:10px 0 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${TENUE};">
                ${escapar(bajada)}
              </p>
            </td>
          </tr>

          <!-- El código: grande, monoespaciado y espaciado para poder leerlo de
               un vistazo y copiarlo sin equivocarse. -->
          <tr>
            <td style="padding:24px 32px 8px 32px;" align="center">
              <div style="background:${FONDO};border:1px solid ${BORDE};border-radius:12px;padding:18px 12px;">
                <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:${VIOLETA};">
                  ${escapar(codigo)}
                </div>
              </div>
              <p style="margin:12px 0 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${TENUE};">
                Vence en ${vigenciaMinutos} minutos.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 32px 28px 32px;">
              <div style="border-top:1px solid ${BORDE};padding-top:16px;">
                <p style="margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:${TENUE};">
                  ${escapar(siNoFuiste)}
                </p>
              </div>
            </td>
          </tr>

        </table>

        <p style="margin:20px 0 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${TENUE};">
          Chillberry — el sistema de tu restaurante<br>
          Este correo se envió automáticamente. No hace falta responderlo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

/**
 * Escapa el contenido antes de meterlo en el HTML. Acá entran datos que vienen
 * del formulario de registro (el nombre del local, el del dueño): sin esto,
 * alguien podría registrar un negocio llamado `<script>…` y meter markup en un
 * mail que después se abre en otro contexto.
 */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
