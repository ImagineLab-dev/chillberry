'use client';

import { PasswordInput } from '@/components/password-input';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login, getCurrentClaims } from '@/lib/auth';
import type { ApiError } from '@/lib/api-client';
import { BerryIcon } from '@/components/berry-icon';
import { Turnstile } from '@/components/turnstile';
import { Alert } from '@/components/ui';

// Espejo de ROLE_HOME en middleware.ts — si se agrega un rol, va en los dos.
const ROLE_HOME: Record<string, string> = {
  SUPER_ADMIN: '/super-admin/tenants',
  OWNER: '/admin/dashboard',
  ADMIN: '/admin/dashboard',
  KITCHEN: '/kitchen',
  WAITER: '/waiter',
  CASHIER: '/pos',
  DRIVER: '/driver',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password, turnstileToken);
      const claims = getCurrentClaims();
      router.replace((claims && ROLE_HOME[claims.role]) || '/');
    } catch (err) {
      setError((err as ApiError).message ?? 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-slide-up">
        {/* La marca va afuera de la card y centrada: es la primera impresión
            del producto, no un detalle del formulario. */}
        <div className="mb-6 flex flex-col items-center text-center">
          <BerryIcon className="mb-3 h-14 w-14" />
          <h1 className="brand-text-gradient font-heading text-3xl font-semibold">Chillberry</h1>
          <p className="mt-1 text-sm text-muted-foreground">Iniciá sesión para continuar</p>
        </div>

        <form onSubmit={onSubmit} className="panel space-y-4 p-6 shadow-glow">
          {error && <Alert tone="error">{error}</Alert>}

          <div className="space-y-1.5">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
            />
          </div>

          <PasswordInput label="Contraseña" value={password} onChange={setPassword} />

          <div className="flex justify-center">
            <Turnstile onVerify={setTurnstileToken} />
          </div>

          <button type="submit" disabled={loading || !turnstileToken} className="btn btn-primary btn-lg w-full">
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>

          {/* Debajo del botón y no arriba: se busca DESPUÉS de que la
              contraseña falló, no antes de intentarla. */}
          <p className="text-center text-sm">
            <Link href="/recuperar" className="text-muted-foreground hover:text-foreground hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿Todavía no tenés cuenta?{' '}
          <Link href="/register" className="font-semibold text-primary hover:underline">
            Registrá tu restaurante
          </Link>
        </p>
      </div>
    </main>
  );
}
