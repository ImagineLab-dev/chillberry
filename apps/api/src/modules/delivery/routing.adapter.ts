import { Injectable } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import { logger } from '../../common/logging/logger';

/** Un punto geográfico. */
export interface Punto {
  lat: number;
  lng: number;
}

/** Ruta calculada entre dos puntos, siguiendo las calles. */
export interface Ruta {
  /** Vértices del camino, en orden, listos para dibujar. */
  coords: Array<[number, number]>;
  /** Distancia real por calle, en metros (no en línea recta). */
  distanciaM: number;
  /** Duración estimada por el motor de ruteo, en segundos. */
  duracionS: number;
}

/** Cuánto esperamos al servicio antes de rendirnos y seguir sin ruta. */
const TIMEOUT_MS = 4000;

/**
 * Ruteo por calles para el seguimiento de entregas.
 *
 * Habla dos motores, ambos con la misma interfaz hacia afuera:
 *
 * - **OSRM** (por defecto): pensado para una instancia PROPIA. Sin API key, sin
 *   cuota y sin límite de consultas. Es la opción recomendada.
 * - **OpenRouteService**: servicio de terceros con plan gratuito de 2.000
 *   consultas por día. Requiere `ORS_API_KEY`.
 *
 * > NO apuntes `ROUTING_BASE_URL` al demo público `router.project-osrm.org`.
 * > Su política lo restringe a desarrollo: responde bien, así que es tentador,
 * > pero usarlo en producción termina en bloqueo sin aviso — y ese día tus
 * > clientes dejan de ver a su repartidor.
 *
 * Sin motor configurado queda en modo sandbox: devuelve `null` y el seguimiento
 * funciona igual, con los dos puntos y sin línea. Mismo criterio que los avisos y
 * el cobro: que falte una integración degrada la experiencia, no rompe nada.
 *
 * NUNCA lanza. Si el motor está caído o lento, se loguea y se sigue sin ruta:
 * un cliente esperando su comida no puede ver un error porque un servicio
 * auxiliar tuvo un mal momento.
 */
@Injectable()
export class RoutingAdapter {
  get configurado(): boolean {
    const env = loadEnv();
    return env.ROUTING_PROVIDER === 'osrm' ? Boolean(env.ROUTING_BASE_URL) : Boolean(env.ORS_API_KEY);
  }

  async obtenerRuta(desde: Punto, hasta: Punto): Promise<Ruta | null> {
    if (!this.configurado) {
      logger.debug({ desde, hasta }, '[sandbox] Ruteo sin configurar — seguimiento sin línea');
      return null;
    }

    // Corte por tiempo: preferimos el mapa sin línea a demorar la respuesta
    // del seguimiento, que el cliente está recargando cada pocos segundos.
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    try {
      const env = loadEnv();
      const ruta =
        env.ROUTING_PROVIDER === 'osrm'
          ? await this.viaOsrm(desde, hasta, controlador.signal)
          : await this.viaOrs(desde, hasta, controlador.signal);
      return ruta;
    } catch (err) {
      const abortado = (err as Error).name === 'AbortError';
      logger.warn(
        { err: abortado ? `sin respuesta en ${TIMEOUT_MS}ms` : (err as Error).message },
        'Falló el cálculo de ruta — se sigue sin ruta',
      );
      return null;
    } finally {
      clearTimeout(corte);
    }
  }

  /** OSRM: GET sin autenticación, coordenadas en la propia URL como lng,lat. */
  private async viaOsrm(desde: Punto, hasta: Punto, signal: AbortSignal): Promise<Ruta | null> {
    const base = loadEnv().ROUTING_BASE_URL!.replace(/\/$/, '');
    // `overview=full` + `geometries=geojson` devuelve la polilínea completa ya
    // decodificada; sin eso viene simplificada o codificada en polyline6.
    const url =
      `${base}/route/v1/driving/${desde.lng},${desde.lat};${hasta.lng},${hasta.lat}` +
      `?overview=full&geometries=geojson`;

    const res = await fetch(url, { signal });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'OSRM no disponible — se sigue sin ruta');
      return null;
    }

    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        geometry?: { coordinates?: Array<[number, number]> };
        distance?: number;
        duration?: number;
      }>;
    };

    // `NoRoute` es una respuesta legítima: no hay camino manejable entre esos
    // dos puntos (dirección mal geocodificada, isla, zona sin mapear).
    if (data.code !== 'Ok' || !data.routes?.length) {
      logger.warn({ code: data.code }, 'OSRM no encontró ruta — se sigue sin ruta');
      return null;
    }

    const r = data.routes[0]!;
    const crudas = r.geometry?.coordinates;
    if (!crudas?.length) return null;

    return {
      // De [lng, lat] de GeoJSON a [lat, lng], que es lo que espera Leaflet.
      coords: crudas.map(([lng, lat]) => [lat, lng] as [number, number]),
      distanciaM: Math.round(r.distance ?? 0),
      duracionS: Math.round(r.duration ?? 0),
    };
  }

  /** OpenRouteService: POST con la key en el header. */
  private async viaOrs(desde: Punto, hasta: Punto, signal: AbortSignal): Promise<Ruta | null> {
    const env = loadEnv();
    const res = await fetch(`${env.ROUTING_BASE_URL}/v2/directions/driving-car/geojson`, {
      method: 'POST',
      signal,
      headers: { Authorization: env.ORS_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[desde.lng, desde.lat], [hasta.lng, hasta.lat]] }),
    });

    if (!res.ok) {
      // 429 es lo único que no se arregla reintentando: se acabó la cuota.
      const detalle = res.status === 429 ? 'cuota diaria agotada' : `HTTP ${res.status}`;
      logger.warn({ status: res.status, detalle }, 'Ruteo no disponible — se sigue sin ruta');
      return null;
    }

    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: Array<[number, number]> };
        properties?: { summary?: { distance?: number; duration?: number } };
      }>;
    };

    const feature = data.features?.[0];
    const crudas = feature?.geometry?.coordinates;
    if (!crudas?.length) return null;

    return {
      coords: crudas.map(([lng, lat]) => [lat, lng] as [number, number]),
      distanciaM: Math.round(feature?.properties?.summary?.distance ?? 0),
      duracionS: Math.round(feature?.properties?.summary?.duration ?? 0),
    };
  }
}
