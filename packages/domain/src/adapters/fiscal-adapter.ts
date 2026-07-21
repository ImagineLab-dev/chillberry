/**
 * Numeración e impuestos varían por país — este contrato aísla esa lógica
 * detrás de un adapter, igual que `payment-provider.adapter.ts` aísla el
 * proveedor de pago. La implementación concreta vive en `apps/api` (necesita
 * DB para la numeración atómica).
 */
export type FiscalNumberResult = {
  series: string;
  number: string;
};

export type TaxComputation = {
  taxTotal: number;
  taxDetails: Record<string, unknown>;
};

export interface FiscalAdapter {
  /** Numeración secuencial atómica por sucursal — nunca puede repetirse ni saltar sin control. */
  nextNumber(branchId: string, series: string): Promise<FiscalNumberResult>;

  computeTax(subtotal: number, countryCode: string): TaxComputation;
}
