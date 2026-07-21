'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** 'driver' (violeta, se mueve), 'branch' (gris) o 'destino' (verde, la casa del cliente). */
  kind?: 'driver' | 'branch' | 'destino';
};

/**
 * Mapa en vivo con Leaflet + tiles de OpenStreetMap (sin API key). Usa
 * `L.divIcon` (un puntito CSS) en vez del marker por defecto, así se evita el
 * bug conocido de los íconos PNG rotos por el bundler. Se carga con
 * `dynamic(ssr:false)` desde las páginas — Leaflet necesita `window`, no puede
 * renderizar en el servidor. Al cambiar `points`, mueve los marcadores
 * existentes (transición suave) en vez de recrearlos.
 *
 * Si recibe `route`, dibuja además el camino por las calles que calculó el
 * motor de ruteo (ver RoutingAdapter en la API). Sin ruta el mapa sigue
 * funcionando: muestra los puntos y ya.
 */
export default function LiveMap({
  points,
  route,
  height = 320,
}: {
  points: MapPoint[];
  /** Camino por las calles, en orden. Sin esto el mapa muestra sólo los puntos. */
  route?: Array<[number, number]> | null;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const routeRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = points[0];
    const map = L.map(containerRef.current, { attributionControl: true }).setView(
      start ? [start.lat, start.lng] : [-25.28, -57.63], // Asunción como fallback
      start ? 14 : 11,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      routeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      const existing = markersRef.current[p.id];
      if (existing) {
        existing.setLatLng([p.lat, p.lng]);
        existing.setTooltipContent(p.label);
      } else {
        const color =
          p.kind === 'branch' ? '#71717a' : p.kind === 'destino' ? '#3FBF87' : 'var(--primary, #5533DB)';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.25)"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        markersRef.current[p.id] = L.marker([p.lat, p.lng], { icon }).addTo(map).bindTooltip(p.label);
      }
    }
    // Sacar marcadores que ya no están.
    for (const id of Object.keys(markersRef.current)) {
      if (!seen.has(id)) {
        markersRef.current[id]!.remove();
        delete markersRef.current[id];
      }
    }

    // La ruta se actualiza en su sitio en vez de recrearse: recrear la capa en
    // cada refresco hace parpadear la línea sobre el mapa.
    if (route?.length) {
      if (routeRef.current) {
        routeRef.current.setLatLngs(route);
      } else {
        routeRef.current = L.polyline(route, {
          color: 'var(--primary, #5533DB)',
          weight: 5,
          opacity: 0.75,
          // Redondeado: en los giros cerrados una unión en punta deja un pico
          // que se lee como un error de dibujo.
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(map);
      }
    } else if (routeRef.current) {
      routeRef.current.remove();
      routeRef.current = null;
    }

    // Encuadrar. Si hay ruta se encuadra ELLA, no los puntos: el camino puede
    // rodear y salirse del rectángulo que forman origen y destino, y se vería
    // cortado justo en la parte que al cliente le interesa.
    if (route?.length) {
      map.fitBounds(L.latLngBounds(route).pad(0.15));
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.25));
    } else if (points.length === 1) {
      map.panTo([points[0]!.lat, points[0]!.lng]);
    }
  }, [points, route]);

  return <div ref={containerRef} style={{ height }} className="w-full overflow-hidden rounded-md" />;
}
