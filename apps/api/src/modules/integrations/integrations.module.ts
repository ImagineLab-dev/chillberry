import { Module } from '@nestjs/common';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { MailAdapter } from './mail/mail.adapter';
import { NotificationsService } from './notifications.service';

/**
 * Fase 7 — Integraciones.
 *
 * - Mail (SMTP): implementado (ver `mail/mail.adapter.ts`) — lo usa el alta
 *   de cuenta y la recuperación de contraseña. Real con SMTP_* configurado,
 *   sandbox (solo log) si no.
 * - WhatsApp: implementado (ver `whatsapp/whatsapp.adapter.ts` +
 *   `NotificationsService`) — real cuando `WHATSAPP_API_TOKEN`/
 *   `WHATSAPP_PHONE_NUMBER_ID` están configurados, sandbox (solo log) si no.
 * - Maps: ya integrado en la Fase 5 (distancia por Haversine en el algoritmo
 *   de asignación, link a Google Maps en `/track` y en la app de repartidor)
 *   — no hace falta un módulo nuevo acá.
 * - Redes sociales / analytics: a propósito quedan como STUBS
 *   DOCUMENTADOS, no implementados, porque construir una integración real
 *   sin un proveedor/cuenta concreto (qué red, qué evento, qué dashboard)
 *   sería inventar un requisito que el plan original no especificó en
 *   detalle. Los puntos de enganche reales serían:
 *     1. Analytics: inyectar el snippet de Google Analytics/Meta Pixel en
 *        `apps/web/src/app/layout.tsx` (o un route group `(public)` si solo
 *        debe correr en el menú público, no en las superficies de staff) y
 *        agregar un `AnalyticsAdapter` (mismo patrón que los demás adapters)
 *        que el checkout/menú público llame en eventos clave (view_item,
 *        add_to_cart, purchase).
 *     2. Redes sociales: agregar Open Graph/Twitter Card meta tags al menú
 *        público (`(public)/menu/[branchSlug]/[tableCode]`) para que
 *        compartir el link muestre nombre/logo/foto del restaurante — no
 *        requiere backend, es metadata de Next.js (`generateMetadata`).
 *   Ninguno de los dos se implementa ahora para no dejar código muerto o
 *   media-funcionalidad sin un proveedor real detrás.
 */
@Module({
  providers: [WhatsAppAdapter, MailAdapter, NotificationsService],
  exports: [NotificationsService, MailAdapter],
})
export class IntegrationsModule {}
