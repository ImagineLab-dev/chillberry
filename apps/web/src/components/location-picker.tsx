'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';

export type LatLng = { lat: number; lng: number };

/**
 * Selector de ubicación en un mapa: el cliente arrastra el pin hasta su casa,
 * toca el mapa donde queda, o usa su ubicación real (GPS del celular). Devuelve
 * `{lat,lng}` por `onChange`. A diferencia de `live-map.tsx` (solo muestra),
 * este es INTERACTIVO.
 *
 * Se carga con `dynamic(ssr:false)` desde las páginas — Leaflet necesita
 * `window`. Tiles de OpenStreetMap, sin API key (mismo criterio que el resto
 * de los mapas del proyecto).
 *
 * `value` arranca en null a propósito: el pin aparece en el centro (la sucursal)
 * pero NO cuenta como elegido hasta que el cliente lo mueve o usa su ubicación
 * — así no se manda por error la posición del local como domicilio del cliente.
 */
export default function LocationPicker({
  value,
  center,
  onChange,
  height = 260,
}: {
  value: LatLng | null;
  /** Dónde centrar el mapa cuando todavía no hay `value` (la sucursal). */
  center: LatLng;
  onChange: (v: LatLng) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El callback en una ref: el efecto de montaje corre una sola vez, y sin esto
  // capturaría el `onChange` del primer render y se quedaría viejo.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = value ?? center;
    const map = L.map(containerRef.current).setView([start.lat, start.lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Pin tipo gota, en color de marca. `divIcon` (HTML) en vez del PNG por
    // defecto — mismo motivo que live-map: el bundler rompe los íconos PNG.
    const icon = L.divIcon({
      className: '',
      html:
        '<div style="font-size:0;line-height:0"><svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M15 0C6.7 0 0 6.7 0 15c0 10 15 25 15 25s15-15 15-25C30 6.7 23.3 0 15 0z" fill="hsl(var(--primary))"/>' +
        '<circle cx="15" cy="15" r="6" fill="white"/></svg></div>',
      iconSize: [30, 40],
      iconAnchor: [15, 40],
    });
    const marker = L.marker([start.lat, start.lng], { icon, draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onChangeRef.current({ lat: p.lat, lng: p.lng });
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Montaje único: los cambios de `value`/`center` los maneja el otro efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza el pin cuando `value` cambia desde afuera (geolocalización).
  useEffect(() => {
    if (!markerRef.current || !mapRef.current || !value) return;
    markerRef.current.setLatLng([value.lat, value.lng]);
    mapRef.current.panTo([value.lat, value.lng]);
  }, [value]);

  function usarMiUbicacion() {
    setError(null);
    if (!navigator.geolocation) {
      setError('Tu navegador no permite ubicarte. Arrastrá el pin a mano.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const v = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onChangeRef.current(v);
        mapRef.current?.setView([v.lat, v.lng], 16);
        setLocating(false);
      },
      () => {
        setError('No pudimos acceder a tu ubicación. Arrastrá el pin a mano.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-lg border border-border"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={usarMiUbicacion} disabled={locating} className="btn btn-sm">
          <LocateFixed className="h-4 w-4" aria-hidden="true" />
          {locating ? 'Ubicando…' : 'Usar mi ubicación actual'}
        </button>
        <span className="text-xs text-muted-foreground">
          Arrastrá el pin hasta tu casa o tocá el mapa.
        </span>
      </div>
      {error && <p className="text-xs text-error-foreground">{error}</p>}
    </div>
  );
}
