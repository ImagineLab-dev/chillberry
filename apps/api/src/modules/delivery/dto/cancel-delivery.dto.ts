import { IsIn, IsString, Length } from 'class-validator';

export class CancelDeliveryDto {
  // FAILED = "lo retiré pero no pude entregar" (cliente ausente, dirección
  // errada). Las transiciones del dominio ya lo permiten desde PICKED_UP; sin
  // esto en el DTO era un estado inalcanzable. El resto son cancelaciones.
  @IsIn(['DRIVER_CANCELLED', 'CUSTOMER_CANCELLED', 'RESTAURANT_CANCELLED', 'FAILED'])
  status!: 'DRIVER_CANCELLED' | 'CUSTOMER_CANCELLED' | 'RESTAURANT_CANCELLED' | 'FAILED';

  @IsString()
  @Length(1, 300)
  reason!: string;
}
