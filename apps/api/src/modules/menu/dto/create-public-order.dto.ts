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
  IsUUID,
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

  /** Coordenadas del domicilio de entrega. OBLIGATORIAS en delivery: el mapa de
   *  reparto, la auto-asignación de repartidor y el cálculo de envío por
   *  distancia/zona las necesitan. En retiro se ignoran. El frontend ya las
   *  exige (el cliente ubica el pin en el mapa); esto lo enforcea server-side. */
  @ValidateIf((o: CreatePublicOrderDto) => o.fulfillment === 'DELIVERY')
  @IsLatitude()
  lat?: number;

  @ValidateIf((o: CreatePublicOrderDto) => o.fulfillment === 'DELIVERY')
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

  /** Clave de idempotencia del cliente para deduplicar el doble-submit (dos POST
   *  iguales devuelven el MISMO pedido). Ver CreateGuestOrderDto. */
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
