import { describe, expect, it } from 'vitest';
import { stripConfirmationCode } from '../../src/modules/delivery/delivery.service';

/**
 * Los dos secretos del CLIENTE que nunca pueden llegar al repartidor:
 *
 * - `confirmationCode`: se lo dicta el cliente al recibir. Si el repartidor lo
 *   lee, puede marcar entregas sin haber pasado por la casa.
 * - `trackingToken`: abre el link de seguimiento, y desde ahí se califica. Si
 *   el repartidor lo lee, vuelve a poder ponerse 5/5 a sí mismo.
 *
 * Que la UI no los pinte no alcanza: están en el JSON, a un F12 de distancia.
 */
describe('stripConfirmationCode', () => {
  const delivery = {
    id: 'del-1',
    status: 'PICKED_UP',
    addressLine: 'Av. España 1234',
    confirmationCode: '4821',
    trackingToken: 'a3f1c9e27b8d4056a1f3c9e27b8d4056',
    driverId: 'drv-1',
  };

  it('saca el código de confirmación', () => {
    expect(stripConfirmationCode(delivery)).not.toHaveProperty('confirmationCode');
  });

  it('saca el token de seguimiento', () => {
    expect(stripConfirmationCode(delivery)).not.toHaveProperty('trackingToken');
  });

  it('no queda ninguno de los dos en el JSON serializado', () => {
    // Se comprueba sobre el texto y no sobre las claves: es exactamente lo que
    // ve alguien mirando la respuesta en las herramientas del navegador.
    const json = JSON.stringify(stripConfirmationCode(delivery));
    expect(json).not.toContain('4821');
    expect(json).not.toContain('a3f1c9e27b8d4056a1f3c9e27b8d4056');
  });

  it('deja intacto lo que la pantalla del repartidor sí necesita', () => {
    const safe = stripConfirmationCode(delivery);
    expect(safe).toMatchObject({
      id: 'del-1',
      status: 'PICKED_UP',
      addressLine: 'Av. España 1234',
      driverId: 'drv-1',
    });
  });

  it('no rompe si el delivery no trae los secretos', () => {
    expect(() => stripConfirmationCode({ id: 'del-2' })).not.toThrow();
  });
});
