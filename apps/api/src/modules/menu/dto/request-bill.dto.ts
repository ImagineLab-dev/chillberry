import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Medio de pago que el comensal *prefiere* al pedir la cuenta desde el QR. Es
 * informativo para el staff — el cobro real lo hace la Caja/el mozo como siempre.
 */
export enum BillPayMethod {
  EFECTIVO = 'EFECTIVO',
  TARJETA = 'TARJETA',
  QR = 'QR',
}

/**
 * "Pedir la cuenta" desde el QR de la mesa. Todo opcional: el comensal puede
 * solo pedir la cuenta, o adjuntar propina (%), en cuántas personas divide y/o
 * el medio de pago. No mueve plata: marca los pedidos abiertos de la mesa como
 * "cuenta pedida" (igual que cuando la pide el mozo) y deja una nota para el staff.
 */
export class RequestBillDto {
  /** Propina elegida, en porcentaje (0–100). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  tipPercent?: number;

  /** En cuántas personas se divide la cuenta (1–50). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  splitCount?: number;

  @IsOptional()
  @IsEnum(BillPayMethod)
  payMethod?: BillPayMethod;
}
