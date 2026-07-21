'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { requestSignup, verifySignup } from '@/lib/auth';
import type { ApiError } from '@/lib/api-client';
import { DLOCAL_COUNTRIES, findDlocalCountry } from '@chillberry/domain';
import { BerryIcon } from '@/components/berry-icon';
import { Turnstile } from '@/components/turnstile';
import { Alert, Badge } from '@/components/ui';
import { CodeInput } from '@/components/code-input';

// El backend expone countryCode + currencySymbol pero no un nombre "lindo" de
// la moneda para mostrar al usuario — se mapea acá por código ISO de moneda
// (varios países comparten USD: Ecuador, El Salvador, Panamá).
const CURRENCY_NAMES: Record<string, string> = {
  PYG: 'Guaraníes',
  ARS: 'Pesos argentinos',
  BRL: 'Reales',
  BOB: 'Bolivianos',
  CLP: 'Pesos chilenos',
  COP: 'Pesos colombianos',
  CRC: 'Colones',
  DOP: 'Pesos dominicanos',
  USD: 'Dólares',
  GTQ: 'Quetzales',
  HNL: 'Lempiras',
  MXN: 'Pesos mexicanos',
  PEN: 'Soles',
  UYU: 'Pesos uruguayos',
};

export default function RegisterPage() {
  const router = useRouter();
  const countryFieldId = useId();
  const [tenantName, setTenantName] = useState('');
  const [countryCode, setCountryCode] = useState('PY');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  /**
   * El alta tiene dos pasos y los dos viven en ESTA pantalla, sin navegar.
   * Si el paso del código fuera otra ruta y el usuario recargara o volviera,
   * perdería los datos que ya cargó y tendría que escribir todo de nuevo —
   * justo cuando está esperando un mail y ya está impaciente.
   */
  const [paso, setPaso] = useState<'datos' | 'codigo'>('datos');
  const [codigo, setCodigo] = useState('');
  const [reenviando, setReenviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const selectedCountry = findDlocalCountry(countryCode);
  const currencyName = selectedCountry
    ? (CURRENCY_NAMES[selectedCountry.currency] ?? selectedCountry.currency)
    : '';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestSignup({ tenantName, ownerName, email, password, countryCode, turnstileToken });
      setPaso('codigo');
    } catch (err) {
      setError((err as ApiError).message ?? 'Error al registrar');
    } finally {
      setLoading(false);
    }
  }

  async function onVerificar(codigoAUsar: string) {
    if (codigoAUsar.length !== 6 || loading) return;
    setError(null);
    setAviso(null);
    setLoading(true);
    try {
      await verifySignup(email, codigoAUsar);
      router.replace('/admin/dashboard');
    } catch (err) {
      setError((err as ApiError).message ?? 'No pudimos verificar el código');
      setCodigo('');
    } finally {
      setLoading(false);
    }
  }

  async function onReenviar() {
    setError(null);
    setAviso(null);
    setReenviando(true);
    try {
      await requestSignup({ tenantName, ownerName, email, password, countryCode, turnstileToken });
      setAviso('Te mandamos un código nuevo. El anterior dejó de servir.');
      setCodigo('');
    } catch (err) {
      setError((err as ApiError).message ?? 'No pudimos reenviar el código');
    } finally {
      setReenviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <BerryIcon className="mb-3 h-14 w-14" />
          <h1 className="font-heading text-2xl font-semibold">
            Creá tu restaurante en <span className="brand-text-gradient">Chillberry</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">14 días de prueba, sin tarjeta.</p>
        </div>

        {paso === 'codigo' ? (
          <div className="panel space-y-4 p-6 shadow-glow">
            {error && <Alert tone="error">{error}</Alert>}
            {aviso && <Alert tone="ok">{aviso}</Alert>}

            <div className="text-center">
              <p className="font-heading text-lg font-semibold">Revisá tu correo</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Le mandamos un código de 6 dígitos a{' '}
                <span className="font-medium text-foreground">{email}</span>. Vence en 15 minutos.
              </p>
            </div>

            <CodeInput value={codigo} onChange={setCodigo} onComplete={onVerificar} disabled={loading} />

            <button
              type="button"
              onClick={() => onVerificar(codigo)}
              disabled={loading || codigo.length !== 6}
              className="btn btn-primary btn-lg w-full justify-center"
            >
              {loading ? 'Verificando...' : 'Crear mi restaurante'}
            </button>

            <div className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setPaso('datos');
                  setCodigo('');
                  setError(null);
                  setAviso(null);
                }}
                className="btn btn-ghost btn-sm"
              >
                Cambiar el correo
              </button>
              <button
                type="button"
                onClick={onReenviar}
                disabled={reenviando}
                className="btn btn-ghost btn-sm"
              >
                {reenviando ? 'Enviando...' : 'Reenviar código'}
              </button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              ¿No llegó? Fijate en la carpeta de spam.
            </p>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="panel space-y-4 p-6 shadow-glow">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Nombre del restaurante" value={tenantName} onChange={setTenantName} />

          <div className="space-y-1.5">
            <label className="label" htmlFor={countryFieldId}>
              País
            </label>
            <select
              id={countryFieldId}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              required
              className="input w-full"
            >
              {DLOCAL_COUNTRIES.map((c) => (
                <option key={c.countryCode} value={c.countryCode}>
                  {c.countryName}
                </option>
              ))}
            </select>
            {/* La moneda en vivo: confirma en el acto que elegiste bien el país,
                antes de que sea un problema de facturación. */}
            {selectedCountry && (
              <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
                <Badge tone="primary">{selectedCountry.currencySymbol}</Badge>
                <span className="text-sm text-muted-foreground">
                  Vas a operar en <span className="font-medium text-foreground">{currencyName}</span>
                </span>
              </div>
            )}
          </div>

          <Field label="Tu nombre" value={ownerName} onChange={setOwnerName} />
          <Field label="Email" type="email" value={email} onChange={setEmail} />
          <Field label="Contraseña" type="password" value={password} onChange={setPassword} minLength={8} />

          <div className="flex justify-center">
            <Turnstile onVerify={setTurnstileToken} />
          </div>

          <button type="submit" disabled={loading || !turnstileToken} className="btn btn-primary btn-lg w-full">
            {loading ? 'Enviando código...' : 'Continuar'}
          </button>
        </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  minLength?: number;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label className="label" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        type={props.type ?? 'text'}
        required
        minLength={props.minLength}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="input w-full"
      />
    </div>
  );
}
