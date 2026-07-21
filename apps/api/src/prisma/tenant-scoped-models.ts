/**
 * Modelos que llevan `tenantId` directo y deben quedar automáticamente
 * scopeados por el Prisma Client Extension de `TenantPrismaService`.
 *
 * R7: cuando agregues un modelo operativo nuevo en fases futuras (KitchenTask,
 * Payment, Delivery, Subscription, ...) sumalo acá — si no, el extension no lo
 * protege y cualquier query manual sin filtro de tenant queda expuesta.
 */
export const TENANT_SCOPED_MODELS = [
  'User',
  'Restaurant',
  'Branch',
  'BranchHours',
  'BranchClosure',
  'Table',
  'Reservation',
  'MenuCategory',
  'MenuItem',
  'Customer',
  'Ingredient',
  'RecipeComponent',
  'StockMovement',
  'ComboComponent',
  'ModifierGroup',
  'ModifierOption',
  'Order',
  'OrderItem',
  'KitchenStation',
  'KitchenTask',
  'TableTransferLog',
  'TableMergeLog',
  'BillSplit',
  'Payment',
  // OJO: `PaymentWebhookEvent` a propósito NO está acá. Los webhooks llegan
  // sin JWT (@Public, sin request autenticada), así que no hay tenantId en
  // el contexto de ALS cuando se procesan — usan PrismaService crudo, no
  // TenantPrismaService. Ver payments/webhooks.controller.ts.
  'CashRegisterSession',
  'CashMovement',
  'Discount',
  'Invoice',
  'InvoiceCounter',
  'Driver',
  'DriverDocument',
  'DriverLocation',
  'DeliveryZone',
  'Delivery',
  'DeliveryRoute',
  'DeliveryEvent',
  'DeliveryIncident',
  // Fase 6 (SaaS billing). `Plan` a propósito NO está acá — es un catálogo
  // global compartido por todos los tenants, igual de razón que
  // `PaymentWebhookEvent` está afuera (no es un dato propio de un tenant).
  'Subscription',
  'SubscriptionInvoice',
  // `LoyaltyProgram` SÍ va acá para cerrar una trampa latente: las lecturas por
  // el cliente scopeado (config del programa, JWT) quedan auto-filtradas por
  // tenant, así una query futura sin `where:{tenantId}` explícito no filtra
  // cross-tenant. La acreditación corre sin tenant en el contexto pero usa el
  // cliente CRUDO (`this.prisma`, con `tenantId` explícito), que NO pasa por esta
  // extensión — así que sumarlo acá no la afecta.
  'LoyaltyProgram',
  'LoyaltyAccount',
  'LoyaltyTransaction',
  // Encuesta de calificación post-visita. La lectura/resultados por el dueño va
  // por el cliente scopeado; el cron que las crea/envía usa el cliente CRUDO
  // con tenantId explícito (sin tenant en el ALS), igual que Loyalty.
  'Feedback',
  // Compras: proveedores y órdenes de compra (reposición de inventario).
  'Supplier',
  'PurchaseOrder',
  'PurchaseOrderItem',
  // Marketing: historial de campañas enviadas a segmentos de clientes.
  'MarketingCampaign',
  // Cupones de descuento. El canje desde la carta pública corre SIN tenant en el
  // ALS y usa el cliente CRUDO con tenantId explícito (igual que Loyalty).
  'Coupon',
  'CouponRedemption',
] as const;

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

export function isTenantScopedModel(model: string): model is TenantScopedModel {
  return (TENANT_SCOPED_MODELS as readonly string[]).includes(model);
}
