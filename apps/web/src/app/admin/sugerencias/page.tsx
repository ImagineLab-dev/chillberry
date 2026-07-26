'use client';

import { useState } from 'react';
import { Bug, CircleCheck, Lightbulb, MessageSquarePlus, Send } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui';

type Tipo = 'BUG' | 'SUGGESTION';

/**
 * "Sugerencias y reportes" — el restaurante le habla al equipo de Chillberry:
 * reporta un problema o propone una función. Va a POST /support (avisa por mail
 * a soporte@ y queda en el panel de super-admin). Distinto de Opiniones, que son
 * las reseñas de los comensales sobre el restaurante.
 */
export default function SugerenciasPage() {
  const [tipo, setTipo] = useState<Tipo>('BUG');
  const [message, setMessage] = useState('');
  const [context, setContext] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (message.trim().length < 5) {
      setError('Contanos un poco más (al menos 5 caracteres).');
      return;
    }
    setSending(true);
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const ctx = [context.trim(), ua].filter(Boolean).join(' — ').slice(0, 300);
      await api.post('/support', { type: tipo, message: message.trim(), context: ctx || undefined });
      setSent(true);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="panel flex flex-col items-center p-8 text-center">
          <div className="brand-gradient mb-4 flex h-14 w-14 items-center justify-center rounded-full shadow-glow">
            <CircleCheck className="h-7 w-7 text-primary-foreground" strokeWidth={2.5} aria-hidden="true" />
          </div>
          <h1 className="font-heading text-xl font-semibold text-foreground">¡Gracias! Lo recibimos.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu {tipo === 'BUG' ? 'reporte' : 'sugerencia'} le llegó al equipo de Chillberry. Si hace falta, te
            contactamos. Cada mensaje nos ayuda a mejorar el sistema.
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setMessage('');
              setContext('');
            }}
            className="btn btn-primary mt-6 min-h-[44px]"
          >
            Enviar otro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
          <MessageSquarePlus className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          Sugerencias y reportes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ¿Encontraste un error o se te ocurre algo que mejoraría Chillberry? Contanos — lo lee el equipo de
          desarrollo. (Para las opiniones de tus clientes sobre tu local, andá a{' '}
          <span className="font-medium text-foreground">Clientes → Opiniones</span>.)
        </p>
      </header>

      <form onSubmit={onSubmit} className="panel space-y-5 p-5 sm:p-6">
        <div>
          <span className="label mb-2 block">¿Qué querés contarnos?</span>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTipo('BUG')}
              aria-pressed={tipo === 'BUG'}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition-colors ${
                tipo === 'BUG' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <Bug className="h-4 w-4" />
              Reportar un problema
            </button>
            <button
              type="button"
              onClick={() => setTipo('SUGGESTION')}
              aria-pressed={tipo === 'SUGGESTION'}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition-colors ${
                tipo === 'SUGGESTION' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <Lightbulb className="h-4 w-4" />
              Sugerir una función
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="msg" className="label">
            {tipo === 'BUG' ? 'Contanos qué pasó' : 'Contanos tu idea'}
          </label>
          <textarea
            id="msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder={
              tipo === 'BUG'
                ? 'Ej: al cobrar una mesa con cuenta dividida, el vuelto sale mal…'
                : 'Ej: estaría bueno poder mandar el ticket por WhatsApp al cliente…'
            }
            className="input w-full text-base"
          />
          <p className="text-xs text-muted-foreground">{message.length}/2000</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ctx" className="label">
            ¿En qué pantalla o momento? <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <input
            id="ctx"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={200}
            placeholder="Ej: en la Caja, al cerrar el turno"
            className="input w-full"
          />
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <button disabled={sending} className="btn btn-primary min-h-[44px]">
          <Send className="h-4 w-4" />
          {sending ? 'Enviando…' : 'Enviar al equipo de Chillberry'}
        </button>
      </form>
    </div>
  );
}
