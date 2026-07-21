'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';

/**
 * Explicación corta al entrar a una sección: qué es esto y cuál es el primer
 * movimiento.
 *
 * Se cierra por sección y se recuerda en el navegador. Quien ya sabe la
 * descarta una vez y no la ve más; quien recién arranca la tiene a mano en
 * cada pantalla nueva.
 *
 * Se renderiza recién después de leer localStorage: pintarla y esconderla un
 * instante después hace un parpadeo horrible en cada carga.
 */
export function AyudaSeccion({
  id,
  titulo,
  children,
}: {
  /** Identificador estable de la sección. Cambiarlo la muestra de nuevo a todos. */
  id: string;
  titulo: string;
  children: React.ReactNode;
}) {
  const clave = `chillberry:ayuda:${id}`;
  const [estado, setEstado] = useState<'cargando' | 'visible' | 'oculta'>('cargando');

  useEffect(() => {
    try {
      setEstado(window.localStorage.getItem(clave) === '1' ? 'oculta' : 'visible');
    } catch {
      setEstado('visible');
    }
  }, [clave]);

  if (estado !== 'visible') return null;

  function cerrar() {
    setEstado('oculta');
    try {
      window.localStorage.setItem(clave, '1');
    } catch {
      // Modo incógnito: se cierra igual, vuelve en la próxima visita.
    }
  }

  return (
    <aside className="alert alert-info mb-4 flex items-start gap-3" aria-label={`Ayuda: ${titulo}`}>
      <Lightbulb className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-heading font-semibold">{titulo}</p>
        <div className="mt-1 space-y-1 text-sm leading-relaxed">{children}</div>
      </div>
      <button
        type="button"
        onClick={cerrar}
        className="btn-icon -mr-1 -mt-1 min-h-[44px] min-w-[44px] shrink-0"
        aria-label="No volver a mostrar esta ayuda"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  );
}
