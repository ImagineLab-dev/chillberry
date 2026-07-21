import { IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { SUBSCRIPTION_STATUS } from '@chillberry/domain';

/**
 * Solo SUSPENDED/ACTIVE. Los otros estados (`TRIAL`, `PAST_DUE`, `CANCELLED`)
 * los maneja el motor de billing a partir de hechos reales — un trial que
 * vence, un webhook de cobro fallido. Dejarlos acá permitiría a un super admin
 * poner a mano un tenant en PAST_DUE sin que exista ninguna factura impaga,
 * y el próximo webhook lo pisaría igual.
 */
const MANUAL_STATUSES = [SUBSCRIPTION_STATUS.Suspended, SUBSCRIPTION_STATUS.Active] as const;

export class UpdateTenantSubscriptionDto {
  @IsIn(MANUAL_STATUSES)
  status!: (typeof MANUAL_STATUSES)[number];

  /**
   * Obligatorio al SUSPENDER: es la acción que le corta el servicio al
   * restaurante, y sin motivo escrito la auditoría no sirve para investigar
   * después "¿por qué este cliente estuvo caído tres días?". Al reactivar es
   * opcional.
   *
   * La condición cubre los dos casos de una: si se suspende, `reason:
   * undefined` entra a `@IsString` y sale 400; si se manda un `reason` en
   * cualquier caso, se valida el tipo. Reactivar sin motivo saltea todo.
   */
  @ValidateIf(
    (o: UpdateTenantSubscriptionDto) =>
      o.status === SUBSCRIPTION_STATUS.Suspended || o.reason !== undefined,
  )
  @IsString()
  @Length(1, 300)
  reason?: string;
}
