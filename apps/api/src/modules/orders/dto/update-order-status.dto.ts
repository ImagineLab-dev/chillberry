import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ORDER_STATUS, type OrderStatus } from '@chillberry/domain';

export class UpdateOrderStatusDto {
  @IsEnum(ORDER_STATUS)
  status!: OrderStatus;

  /**
   * Motivo — OBLIGATORIO al cancelar (se valida en el service, no acá, porque
   * solo aplica a CANCELLED). Una anulación sin motivo es indistinguible de un
   * robo cuando el dueño audita el turno.
   */
  @IsOptional()
  @IsString()
  @Length(3, 300)
  reason?: string;
}
