/**
 * Token DI del proveedor de suscripciones. El `BillingModule` lo resuelve al
 * adapter Mock o al real de dLocal según `BILLING_PROVIDER` (env). En archivo
 * aparte para que módulo y service lo importen sin ciclo.
 */
export const SUBSCRIPTION_PROVIDER = Symbol('SUBSCRIPTION_PROVIDER');
