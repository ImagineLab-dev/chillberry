'use client';

import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';

type Props = {
  label: string;
  /** URL actual (subida o pegada), o '' si no hay. */
  value: string;
  onChange: (url: string) => void;
  /** Texto de tamaño/proporción recomendados, ej "1600 × 600 px · proporción 3:1". */
  recommendation: string;
  help?: string;
  /** Clase de aspecto de la miniatura de preview (ej `aspect-[3/1]` o `aspect-square`). */
  previewClass?: string;
};

/**
 * Subida de imagen reutilizable: sube el archivo a `/uploads/image` (mismo
 * endpoint que las fotos de producto, devuelve una URL http), muestra preview y
 * el tamaño/proporción recomendados, y deja pegar una URL como alternativa.
 */
export function ImageUploader({
  label,
  value,
  onChange,
  recommendation,
  help,
  previewClass = 'aspect-[3/1]',
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-subir el mismo archivo
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      onChange(url);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="label">{label}</span>
      <p className="text-xs text-muted-foreground">Recomendado: {recommendation}.</p>
      <div className="flex items-start gap-3">
        <div className={`w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-muted ${previewClass}`}>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImagePlus className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <label className="btn btn-sm min-h-[44px] cursor-pointer">
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {uploading ? 'Subiendo...' : value ? 'Cambiar imagen' : 'Subir imagen'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onFile}
              disabled={uploading}
              className="sr-only"
            />
          </label>
          {value && (
            <button type="button" onClick={() => onChange('')} className="btn btn-ghost btn-sm">
              <X className="h-4 w-4" aria-hidden="true" />
              Quitar
            </button>
          )}
          <button type="button" onClick={() => setShowUrl((v) => !v)} className="text-xs text-primary underline">
            {showUrl ? 'ocultar URL' : 'o pegar una URL'}
          </button>
          {showUrl && (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://...jpg"
              className="input w-full text-xs"
            />
          )}
        </div>
      </div>
      {error && <p className="text-xs text-error-foreground">{error}</p>}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
