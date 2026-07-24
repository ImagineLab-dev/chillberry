import { IsLatitude, IsLongitude } from 'class-validator';

/**
 * Coordenadas del cliente para previsualizar el costo de envío en el checkout
 * público (`/r/:slug`). No crea nada: sólo calcula cuánto saldría el envío a
 * ese punto, para que el cliente lo vea antes de confirmar (clave en
 * BY_DISTANCE, donde el fee depende de la distancia a la sucursal).
 */
export class DeliveryFeePreviewDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;
}
