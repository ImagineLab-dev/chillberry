/**
 * Verifica que las credenciales SMTP del .env realmente autentiquen.
 *
 *   pnpm --filter @chillberry/api check:smtp
 *   pnpm --filter @chillberry/api check:smtp -- destinatario@dominio.com
 *
 * Sin argumento sólo prueba la conexión y el login (no manda nada). Con un
 * destinatario, además envía un mail de prueba.
 *
 * Existe porque el modo sandbox del adapter enmascara el problema: sin
 * credenciales el mail se loguea y "todo funciona", así que un error de
 * autenticación recién aparece en producción, cuando un cliente real no puede
 * crear su cuenta.
 */
const path = require('path');

// dotenv llega como dependencia de @nestjs/config; en el layout de pnpm hay que
// resolverlo desde ahí y no desde node_modules del paquete.
const dotenv = require(require.resolve('dotenv', { paths: [require.resolve('@nestjs/config')] }));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const nodemailer = require(require.resolve('nodemailer', { paths: [require.resolve('@nestjs/config')] }));

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, MAIL_FROM_NAME } = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
  console.log('SMTP sin configurar: faltan SMTP_HOST, SMTP_USER o SMTP_PASSWORD en apps/api/.env');
  console.log('Mientras falten, el sistema LOGUEA los mails en vez de enviarlos:');
  console.log('nadie puede crear ni recuperar una cuenta.');
  process.exit(1);
}

const puerto = Number(SMTP_PORT ?? 465);

console.log('Servidor :', `${SMTP_HOST}:${puerto}`, puerto === 465 ? '(SSL)' : '(STARTTLS)');
console.log('Usuario  :', SMTP_USER);
// La contraseña NUNCA se imprime. Sólo lo necesario para detectar el error más
// común: que el .env la haya cortado (pasa si empieza con "#" y no va entre
// comillas, porque muchos parsers lo toman como comentario).
console.log('Clave    :', `${SMTP_PASSWORD.length} caracteres leídos`);

const transporte = nodemailer.createTransport({
  host: SMTP_HOST,
  port: puerto,
  secure: puerto === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
});

const destinatario = process.argv[2];

transporte
  .verify()
  .then(async () => {
    console.log('\n✓ Conexión y autenticación: OK');
    if (!destinatario) {
      console.log('  (para enviar un mail de prueba: agregá un destinatario como argumento)');
      return;
    }
    await transporte.sendMail({
      from: `"${MAIL_FROM_NAME ?? 'Chillberry'}" <${MAIL_FROM ?? SMTP_USER}>`,
      to: destinatario,
      subject: 'Prueba de envío de Chillberry',
      text: 'Si estás leyendo esto, el envío de correo del sistema funciona.',
    });
    console.log(`✓ Mail de prueba enviado a ${destinatario}`);
    console.log('  Revisá también la carpeta de spam: si cayó ahí, faltan los registros SPF/DKIM/DMARC (ver docs/DEPLOY.md).');
  })
  .catch((err) => {
    console.log('\n✗ Falló:', err.message);
    const m = String(err.message);
    if (m.includes('535') || /auth/i.test(m)) {
      console.log('\nEs un rechazo de credenciales. En orden de probabilidad:');
      console.log('  1. La casilla se creó hace poco y todavía se está habilitando — esperá unos minutos.');
      console.log('  2. La contraseña no es esa. Comprobalo entrando a webmail.hostinger.com con ese usuario.');
      console.log('  3. El plan de correo del dominio no está activo.');
    } else if (m.includes('ENOTFOUND') || m.includes('ETIMEDOUT')) {
      console.log('\nNo se llegó al servidor: revisá SMTP_HOST y que el puerto no esté bloqueado.');
    }
    process.exit(1);
  });
