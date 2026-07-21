'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Circle, X } from 'lucide-react';
import { api } from '@/lib/api-client';

/**
 * Primeros pasos para dejar el restaurante andando.
 *
 * El estado se CALCULA de los datos reales, no de un flag de "ya vio el
 * onboarding". Así el panel dice lo que de verdad falta: si alguien borra su
 * única sucursal, el paso vuelve a aparecer. Un flag mentiría.
 *
 * Se oculta solo al completar todo, y se puede cerrar antes. El cierre se
 * guarda en el navegador, no en la cuenta: es una preferencia de quien mira,
 * y no vale gastarse un endpoint ni una columna en eso.
 */

const CLAVE_CERRADO = 'chillberry:primeros-pasos-cerrado';

interface Paso {
  titulo: string;
  detalle: string;
  href: string;
  hecho: boolean;
}

export function PrimerosPasos() {
  const [pasos, setPasos] = useState<Paso[] | null>(null);
  const [cerrado, setCerrado] = useState(true);

  useEffect(() => {
    try {
      setCerrado(window.localStorage.getItem(CLAVE_CERRADO) === '1');
    } catch {
      setCerrado(false);
    }

    // Se piden todos juntos y se toleran fallos individuales: un endpoint caído
    // no puede tumbar el panel entero. Lo que no se pudo leer cuenta como
    // "todavía no hecho", que es el lado seguro — a lo sumo sugiere un paso ya
    // cumplido, nunca oculta uno pendiente.
    Promise.all([
      api.get<unknown[]>('/restaurants').catch(() => []),
      api.get<unknown[]>('/branches').catch(() => []),
      api.get<unknown[]>('/users').catch(() => []),
    ]).then(async ([restaurantes, sucursales, usuarios]) => {
      const primeraSucursal = (sucursales as Array<{ id: string }>)[0];

      // La carta y las mesas cuelgan de una sucursal: sin ella no hay nada que
      // preguntar todavía.
      const [platos, mesas] = primeraSucursal
        ? await Promise.all([
            api.get<unknown[]>(`/menu/items?branchId=${primeraSucursal.id}`).catch(() => []),
            api.get<unknown[]>(`/tables?branchId=${primeraSucursal.id}`).catch(() => []),
          ])
        : [[], []];

      setPasos([
        {
          titulo: 'Creá tu restaurante',
          detalle: 'El nombre con el que te conocen tus clientes.',
          href: '/admin/restaurants',
          hecho: restaurantes.length > 0,
        },
        {
          titulo: 'Agregá tu primera sucursal',
          detalle: 'La dirección del local. Si tenés varios, cargá uno por ahora.',
          href: '/admin/restaurants',
          hecho: sucursales.length > 0,
        },
        {
          titulo: 'Cargá tu carta',
          detalle: 'Los platos y sus precios. Es lo que ven tus clientes al escanear el QR.',
          href: '/admin/menu',
          hecho: platos.length > 0,
        },
        {
          titulo: 'Armá tu salón',
          detalle: 'Las mesas del local. Cada una lleva su propio QR para pedir.',
          href: '/admin/tables',
          hecho: mesas.length > 0,
        },
        {
          titulo: 'Sumá a tu equipo',
          detalle: 'Mozos, cocina y caja, cada uno con su sucursal y lo que puede ver.',
          href: '/admin/staff',
          // El dueño ya cuenta como usuario, así que el paso se cumple recién
          // cuando hay alguien más.
          hecho: usuarios.length > 1,
        },
      ]);
    });
  }, []);

  if (!pasos || cerrado) return null;

  const hechos = pasos.filter((p) => p.hecho).length;
  if (hechos === pasos.length) return null;

  const siguiente = pasos.find((p) => !p.hecho);

  function cerrar() {
    setCerrado(true);
    try {
      window.localStorage.setItem(CLAVE_CERRADO, '1');
    } catch {
      // Modo incógnito: se cierra igual, sólo que vuelve en la próxima visita.
    }
  }

  return (
    <section className="panel mb-6 p-5" aria-labelledby="primeros-pasos-titulo">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="primeros-pasos-titulo" className="font-heading text-lg font-semibold">
            Primeros pasos
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {hechos} de {pasos.length} listos
            {siguiente && <> · seguí con &ldquo;{siguiente.titulo}&rdquo;</>}
          </p>
        </div>
        <button
          type="button"
          onClick={cerrar}
          className="btn-icon min-h-[44px] min-w-[44px] shrink-0"
          aria-label="Ocultar los primeros pasos"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Barra de avance. `aria-hidden` porque el texto de arriba ya dice
          "X de Y": repetirlo en audio es ruido. */}
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${(hechos / pasos.length) * 100}%` }}
        />
      </div>

      <ol className="space-y-1">
        {pasos.map((p) => (
          <li key={p.titulo}>
            <Link
              href={p.href}
              className={`flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted ${
                p.hecho ? 'text-muted-foreground' : ''
              }`}
            >
              {p.hecho ? (
                <Check className="h-5 w-5 shrink-0 text-ok-foreground" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block font-medium ${p.hecho ? 'line-through' : ''}`}>{p.titulo}</span>
                {!p.hecho && <span className="block text-sm text-muted-foreground">{p.detalle}</span>}
              </span>
              {!p.hecho && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="sr-only">{p.hecho ? '(listo)' : '(pendiente)'}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
