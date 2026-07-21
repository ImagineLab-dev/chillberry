import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GuestOrderLineDto } from './create-guest-order.dto';

/**
 * Pedido self-service desde el link público COMPARTIBLE de la sucursal
 * (`/r/:slug`) — el que se pone en la bio de Instagram/los avisos. A diferencia
 * de `CreateGuestOrderDto` (QR de mesa → siempre DINE_IN), acá el cliente
 * elige entre delivery y retiro, y el pago es al recibir: no hay pasarela.
 *
 * Por eso nombre y teléfono son OBLIGATORIOS (hay que poder contactar al
 * cliente para coordinar la entrega/retiro), mientras que en el QR de mesa son
 * opcionales. La dirección es obligatoria SOLO si eligió delivery.
 */
export class CreatePublicOrderDto {
  @IsIn(['DELIVERY', 'PICKUP'])
  fulfillment!: 'DELIVERY' | 'PICKUP';

  @IsString()
  @Length(2, 120)
  customerName!: string;

  @IsString()
  @Length(6, 30)
  customerPhone!: string;

  /** Dirección de entrega. Requerida si `fulfillment === 'DELIVERY'`; ignorada
   *  para retiro. El cliente la escribe libre — no se matchea contra zonas. */
  @ValidateIf((o: CreatePublicOrderDto) => o.fulfillment === 'DELIVERY')
  @IsString()
  @Length(5, 240)
  address?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  /** Nota general del pedido ("tocar timbre 2 veces"). */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;

  /** Código de cupón que tipeó el cliente. Se valida server-side; si no sirve,
   *  el pedido se rechaza con el motivo (vencido, agotado, compra mínima). */
  @IsOptional()
  @IsString()
  @Length(3, 32)
  couponCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GuestOrderLineDto)
  items!: GuestOrderLineDto[];

  @IsString()
  @Length(1, 4000)
  turnstileToken!: string;
}
