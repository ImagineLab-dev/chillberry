'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { acceptInvite, getCurrentClaims, getInvitation, type Invitation } from '@/lib/auth';
import type { ApiError } from '@/lib/api-client';
import { BerryIcon } from '@/components/berry-icon';
import { PasswordInput } from '@/components/password-input';
import { Alert } from '@/components/ui';
// Fuente única de la "casa" de cada rol (compartida con middleware y login).
import { ROLE_HOME } from '@/lib/role-home';


export default function InvitacionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const [estado, setEstado] = useState<'cargando' | 'ok' | 'invalida' | 'error'>('cargando');
  const [invitacion, setInvitacion] = useState<Invitation | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Contador de reintentos: re-dispara el efecto de verificacion del token.
  const [reintento, setReintento] = useState(0);

  // Antes de mostrar el formulario se confirma que la invitación sigue viva: si
  // ya se usó o el dueño desactivó la cuenta, se avisa en vez de dejar escribir
  // una contraseña que después no va a servir.
  useEffect(() => {
    let vivo = true;
    setEstado('cargando');
    getInvitation(token)
      .then((inv) => {
        if (!vivo) return;
        setInvitacion(inv);
        setEstado('ok');
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        // 401/404 = la invitacion realmente no sirve. CUALQUIER otra cosa
        // (API caida, red, 500) NO es culpa del link: decir "ya no es valida"
        // hacia que el dueno reinvitara al pedo y quemara el token bueno.
        const status = (err as ApiError).status;
        setEstado(status === 401 || status === 404 ? 'invalida' : 'error');
      });
    return () => {
      vivo = false;
    };
  }, [token, reintento]);

  const passwordsNoCoinciden = password2.length > 0 && password !== password2;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError('Las contraseñas no coinciden. Revisalas y probá de nuevo.');
      return;
    }
    setLoading(true);
    try {
      await acceptInvite(token, password);
      // La sesión ya quedó guardada; se enruta según el rol del JWT recién creado.
      const claims = getCurrentClaims();
      router.replace(ROLE_HOME[claims?.role ?? ''] ?? '/admin/dashboard');
    } catch (err) {
      const apiErr = err as ApiError;
      // 401 = el token dejó de ser válido entre que se cargó la pantalla y el
      // envío (alguien más lo usó, o lo reinvitaron). Se refleja en el estado.
      if (apiErr.status === 401) setEstado('invalida');
      else setError(apiErr.message ?? 'No pudimos activar tu cuenta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <BerryIcon className="mb-3 h-14 w-14" />
          <h1 className="font-heading text-2xl font-semibold">
            Sumate al equipo en <span className="brand-text-gradient">Chillberry</span>
          </h1>
        </div>

        {estado === 'cargando' && (
          <div className="panel p-6 text-center text-sm text-muted-foreground shadow-glow">
            Verificando tu invitación…
          </div>
        )}

        {estado === 'error' && (
          <div className="panel space-y-4 p-6 text-center shadow-glow">
            <Alert tone="error">
              No pudimos verificar tu invitación — parece un problema de conexión, no del enlace.
              Esperá un momento y probá de nuevo.
            </Alert>
            <button type="button" onClick={() => setReintento((n) => n + 1)} className="btn btn-primary btn-sm">
              Reintentar
            </button>
          </div>
        )}

        {estado === 'invalida' && (
          <div className="panel space-y-4 p-6 text-center shadow-glow">
            <Alert tone="error">
              Esta invitación ya no es válida. Puede que ya la hayas usado o que la persona que te
              invitó la haya vuelto a enviar. Pedile un enlace nuevo.
            </Alert>
            <Link href="/login" className="btn btn-ghost btn-sm">
              Ir a iniciar sesión
            </Link>
          </div>
        )}

        {estado === 'ok' && invitacion && (
          <form onSubmit={onSubmit} className="panel space-y-4 p-6 shadow-glow">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Hola <span className="font-medium text-foreground">{invitacion.name}</span>, te
                sumaron al equipo de{' '}
                <span className="font-medium text-foreground">{invitacion.tenantName}</span>.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Vas a entrar con <span className="font-medium text-foreground">{invitacion.email}</span>.
                Elegí una contraseña para terminar.
              </p>
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <PasswordInput
              label="Creá tu contraseña"
              value={password}
              onChange={setPassword}
              minLength={8}
              autoComplete="new-password"
            />
            <PasswordInput
              label="Repetí la contraseña"
              value={password2}
              onChange={setPassword2}
              minLength={8}
              autoComplete="new-password"
              error={passwordsNoCoinciden ? 'No coincide con la de arriba' : null}
            />

            <button
              type="submit"
              disabled={loading || passwordsNoCoinciden || !password2}
              className="btn btn-primary btn-lg w-full justify-center"
            >
              {loading ? 'Activando…' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
