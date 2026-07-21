'use client';

import { PasswordInput } from '@/components/password-input';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { requestPasswordReset, resetPassword } from '@/lib/auth';
import type { ApiError } from '@/lib/api-client';
import { BerryIcon } from '@/components/berry-icon';
import { Turnstile } from '@/components/turnstile';
import { CodeInput } from '@/components/code-input';
import { Alert } from '@/components/ui';

/**
 * Recuperación de cuenta en dos pasos, los dos en esta misma pantalla.
 *
 * Detalle que no es cosmético: cuando se pide el código, la pantalla dice lo
 * mismo exista o no la cuenta ("si ese correo tiene una cuenta, le llega un
 * código"). El backend ya responde igual en los dos casos — si acá dijéramos
 * "ese correo no existe", tiraríamos por la borda esa protección y cualquiera
 * podría averiguar qué correos son clientes probando de a uno.
 */
export default function RecuperarPage() {
  const router = useRouter();
  const [paso, setPaso] = useState<'email' | 'codigo'>('email');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function onPedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email, turnstileToken);
      setPaso('codigo');
    } catch (err) {
      setError((err as ApiError).message ?? 'No pudimos enviar el código');
    } finally {
      setLoading(false);
    }
  }

  async function onCambiar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await resetPassword(email, codigo, password);
      setListo(true);
    } catch (err) {
      setError((err as ApiError).message ?? 'No pudimos cambiar la contraseña');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <BerryIcon className="mb-3 h-14 w-14" />
          <h1 className="font-heading text-2xl font-semibold">Recuperá tu cuenta</h1>
        </div>

        {listo ? (
          <div className="panel space-y-4 p-6 text-center shadow-glow">
            <Alert tone="ok">Tu contraseña quedó cambiada.</Alert>
            {/* Se avisa explícitamente porque el usuario lo va a notar: cambiar
                la contraseña cierra TODAS las sesiones, incluidas las de la
                tablet de la cocina y el celular de los mozos. */}
            <p className="text-sm text-muted-foreground">
              Por seguridad cerramos todas las sesiones abiertas. Si tenés la caja o la cocina
              abiertas en otros dispositivos, vas a tener que entrar de nuevo ahí también.
            </p>
            <button
              type="button"
              onClick={() => router.replace('/login')}
              className="btn btn-primary btn-lg w-full justify-center"
            >
              Iniciar sesión
            </button>
          </div>
        ) : paso === 'email' ? (
          <form onSubmit={onPedirCodigo} className="panel space-y-4 p-6 shadow-glow">
            {error && <Alert tone="error">{error}</Alert>}

            <p className="text-sm text-muted-foreground">
              Escribí tu correo y te mandamos un código para poner una contraseña nueva.
            </p>

            <div className="space-y-1.5">
              <label className="label" htmlFor="email">
                Correo
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="input w-full"
              />
            </div>

            <div className="flex justify-center">
              <Turnstile onVerify={setTurnstileToken} />
            </div>

            <button
              type="submit"
              disabled={loading || !turnstileToken || !email}
              className="btn btn-primary btn-lg w-full justify-center"
            >
              {loading ? 'Enviando...' : 'Enviarme el código'}
            </button>
          </form>
        ) : (
          <form onSubmit={onCambiar} className="panel space-y-4 p-6 shadow-glow">
            {error && <Alert tone="error">{error}</Alert>}
            {aviso && <Alert tone="ok">{aviso}</Alert>}

            {/* Mismo texto exista o no la cuenta: el backend responde igual en
                los dos casos y la UI no puede delatar la diferencia. */}
            <p className="text-sm text-muted-foreground">
              Si <span className="font-medium text-foreground">{email}</span> tiene una cuenta, le
              llegó un código de 6 dígitos. Vence en 15 minutos.
            </p>

            <CodeInput value={codigo} onChange={setCodigo} disabled={loading} />
            <PasswordInput
              label="Contraseña nueva"
              value={password}
              onChange={setPassword}
              minLength={8}
              autoComplete="new-password"
            />

            <button
              type="submit"
              disabled={loading || codigo.length !== 6 || password.length < 8}
              className="btn btn-primary btn-lg w-full justify-center"
            >
              {loading ? 'Cambiando...' : 'Cambiar contraseña'}
            </button>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setPaso('email');
                  setCodigo('');
                  setError(null);
                }}
                className="btn btn-ghost btn-sm"
              >
                Usar otro correo
              </button>
              <button
                type="button"
                onClick={async () => {
                  setError(null);
                  setLoading(true);
                  try {
                    await requestPasswordReset(email, turnstileToken);
                    setAviso('Te mandamos un código nuevo. El anterior dejó de servir.');
                    setCodigo('');
                  } catch (err) {
                    setError((err as ApiError).message ?? 'No pudimos reenviar el código');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="btn btn-ghost btn-sm"
              >
                Reenviar código
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
