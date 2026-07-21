'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Campo de contraseña con botón para verla.
 *
 * Poder ver lo que uno escribe reduce los errores de tipeo mucho más que
 * obligar a repetir la clave, sobre todo en el teléfono. Arranca oculta —
 * mostrarla es una decisión de quien está frente a la pantalla, que es el único
 * que sabe si hay alguien mirando.
 *
 * El botón NO es `type="button"` por casualidad: dentro de un formulario, un
 * botón sin tipo es `submit`, y al tocar el ojito se enviaría el formulario.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  minLength,
  autoComplete = 'current-password',
  error,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
  autoComplete?: 'current-password' | 'new-password';
  /** Mensaje bajo el campo; también lo anuncian los lectores de pantalla. */
  error?: string | null;
  required?: boolean;
}) {
  const id = useId();
  const idError = `${id}-error`;
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? idError : undefined}
          // Espacio a la derecha para que el texto no pase por debajo del botón.
          className="input w-full pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // 44px: es el mínimo para tocar cómodo con el dedo.
          className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground"
          aria-label={visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
          aria-pressed={visible}
          // Se saca del orden de tabulación: quien navega con teclado quiere
          // pasar del campo al siguiente, no al ojito.
          tabIndex={-1}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {error && (
        <p id={idError} className="text-sm text-error-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
