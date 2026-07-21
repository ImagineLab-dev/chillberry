'use client';

import { useEffect, useRef } from 'react';

/**
 * Campo para el código de 6 dígitos que llega por mail.
 *
 * Es un solo `<input>` y no seis casillas separadas, a propósito: las seis
 * casillas se ven bien en un diseño pero pelean con el autocompletado del
 * teléfono. Con `autoComplete="one-time-code"`, iOS y Android ofrecen el código
 * directamente desde la notificación del mail y lo completan de un toque —
 * repartido en seis inputs eso no funciona, y encima pegar el código con los
 * dedos se vuelve un problema.
 *
 * `inputMode="numeric"` abre el teclado de números: quien está recibiendo el
 * código lo está mirando en otra app, con una mano.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  id = 'codigo',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Se dispara al completar los 6 dígitos, para enviar sin tocar el botón. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const yaDisparado = useRef(false);

  useEffect(() => {
    if (value.length === 6 && !yaDisparado.current) {
      yaDisparado.current = true;
      onComplete?.(value);
    }
    if (value.length < 6) yaDisparado.current = false;
  }, [value, onComplete]);

  return (
    <input
      id={id}
      value={value}
      // Se limpia todo lo que no sea dígito: pegar "123 456" o "código: 123456"
      // desde el mail tiene que funcionar igual.
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoCorrect="off"
      spellCheck={false}
      maxLength={6}
      disabled={disabled}
      placeholder="000000"
      aria-label="Código de 6 dígitos"
      className="input tabular h-16 w-full text-center font-heading text-3xl font-bold tracking-[0.4em] placeholder:text-muted-foreground/30"
    />
  );
}
