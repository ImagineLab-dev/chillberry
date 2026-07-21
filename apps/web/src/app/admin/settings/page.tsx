'use client';

import { useEffect, useState } from 'react';
import { Calculator, Gift } from 'lucide-react';
import {
  DEFAULT_BRAND_COLOR,
  DLOCAL_COUNTRIES,
  brandTokens,
  findDlocalCountry,
  formatMoney,
  isValidHexColor,
} from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { getCurrentUser, type MeResponse } from '@/lib/auth';
import { Alert, PageHeader, Skeleton } from '@/components/ui';
import { SettingsTabs } from '@/components/settings-tabs';

type TenantSettings = {
  id: string;
  name: string;
  countryCode: string;
  currency: string;
  timezone: string;
  brandColor: string | null;
  publicSubdomain: string | null;
};

// earnPer/pointValue son Decimals en la API → llegan como string.
type LoyaltyProgram = { active: boolean; earnPer: string; pointValue: string };

/**
 * Zonas horarias ofrecidas. Los clientes son de LATAM (mismos países que
 * DLocal), así que la lista cubre esos husos; si el tenant ya tiene guardado
 * uno fuera de la lista, se agrega igual para no perderlo (ver TZ_OPTIONS).
 */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Asuncion', label: 'Paraguay — Asunción' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina — Buenos Aires' },
  { value: 'America/Montevideo', label: 'Uruguay — Montevideo' },
  { value: 'America/Sao_Paulo', label: 'Brasil — São Paulo' },
  { value: 'America/Santiago', label: 'Chile — Santiago' },
  { value: 'America/La_Paz', label: 'Bolivia — La Paz' },
  { value: 'America/Lima', label: 'Perú — Lima' },
  { value: 'America/Bogota', label: 'Colombia — Bogotá' },
  { value: 'America/Guayaquil', label: 'Ecuador — Guayaquil' },
  { value: 'America/Caracas', label: 'Venezuela — Caracas' },
  { value: 'America/Panama', label: 'Panamá' },
  { value: 'America/Costa_Rica', label: 'Costa Rica' },
  { value: 'America/Guatemala', label: 'Guatemala' },
  { value: 'America/El_Salvador', label: 'El Salvador' },
  { value: 'America/Tegucigalpa', label: 'Honduras' },
  { value: 'America/Managua', label: 'Nicaragua' },
  { value: 'America/Santo_Domingo', label: 'Rep. Dominicana' },
  { value: 'America/Mexico_City', label: 'México — Ciudad de México' },
  { value: 'America/Cancun', label: 'México — Cancún' },
  { value: 'UTC', label: 'UTC' },
];

/** Presets: cubren el 90% de los casos sin obligar a pelear con un picker. */
const BRAND_PRESETS = [
  { hex: DEFAULT_BRAND_COLOR, name: 'Violeta Chillberry' },
  { hex: '#D81B60', name: 'Frambuesa' },
  { hex: '#C62828', name: 'Rojo' },
  { hex: '#E65100', name: 'Naranja' },
  { hex: '#2E7D32', name: 'Verde' },
  { hex: '#00838F', name: 'Turquesa' },
  { hex: '#1565C0', name: 'Azul' },
  { hex: '#4527A0', name: 'Índigo' },
  { hex: '#5D4037', name: 'Café' },
  { hex: '#37474F', name: 'Grafito' },
];

export default function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Campos del formulario — separados de `settings` para que el preview de
  // moneda reaccione en vivo al cambiar el select, sin depender de que ya
  // se haya guardado.
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [timezone, setTimezone] = useState('');
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [publicSubdomain, setPublicSubdomain] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  // Conversión de precios del menú por tipo de cambio (sección independiente).
  const [convertRate, setConvertRate] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertNotice, setConvertNotice] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

  // Programa de puntos — sección independiente del form de settings, con su
  // propio guardado y sus propios avisos (un guardado no pisa al otro).
  const [loyaltyActive, setLoyaltyActive] = useState(false);
  const [earnPer, setEarnPer] = useState('');
  const [pointValue, setPointValue] = useState('');
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);
  const [loyaltyNotice, setLoyaltyNotice] = useState<string | null>(null);

  const isOwner = me?.role === 'OWNER';

  useEffect(() => {
    getCurrentUser()
      .then(setMe)
      .catch(() => {});
    api
      .get<TenantSettings>('/tenant-settings')
      .then((data) => {
        setSettings(data);
        setName(data.name);
        setCountryCode(data.countryCode);
        setTimezone(data.timezone);
        setBrandColor(data.brandColor ?? DEFAULT_BRAND_COLOR);
        setPublicSubdomain(data.publicSubdomain ?? '');
      })
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
    // El programa de puntos es OWNER/ADMIN; si el rol no puede leerlo, se
    // ignora en silencio (la sección solo se muestra al OWNER de todos modos).
    api
      .get<LoyaltyProgram>('/loyalty/program')
      .then((p) => {
        setLoyaltyActive(p.active);
        setEarnPer(p.earnPer);
        setPointValue(p.pointValue);
      })
      .catch(() => {});
  }, []);

  // País/moneda tal como quedaron guardados (para la vista de solo lectura).
  const savedCountry = settings ? findDlocalCountry(settings.countryCode) : undefined;
  // País/moneda del select en el momento, antes de guardar (preview en vivo).
  const selectedCountry = findDlocalCountry(countryCode);

  // Dominio raíz para el link compartible. En prod se setea vía env; el default
  // es el dominio real, que es lo que el tenant pone en Instagram.
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'chillberry.io';
  const storeUrl = publicSubdomain.trim()
    ? `https://${publicSubdomain.trim().toLowerCase()}.${rootDomain}`
    : '';

  async function onCopyStoreUrl() {
    try {
      await navigator.clipboard?.writeText(storeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin clipboard (http inseguro / permiso denegado): no rompemos nada.
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const updated = await api.patch<TenantSettings>('/tenant-settings', {
        name,
        countryCode,
        timezone,
        brandColor,
        // '' → null: borra el subdominio. Trim + minúsculas para que coincida
        // con el formato que valida el backend.
        publicSubdomain: publicSubdomain.trim() ? publicSubdomain.trim().toLowerCase() : null,
      });
      setSettings(updated);
      setName(updated.name);
      setCountryCode(updated.countryCode);
      setTimezone(updated.timezone);
      setBrandColor(updated.brandColor ?? DEFAULT_BRAND_COLOR);
      setPublicSubdomain(updated.publicSubdomain ?? '');
      setNotice('Cambios guardados.');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function onConvertPrices() {
    const rate = Number(convertRate);
    if (!(rate > 0)) return;
    setConvertError(null);
    setConvertNotice(null);
    setConverting(true);
    try {
      const r = await api.post<{ itemsUpdated: number; optionsUpdated: number }>('/menu/prices/convert', { rate });
      setConvertNotice(`Listo: ${r.itemsUpdated} producto(s) y ${r.optionsUpdated} extra(s) convertidos ×${rate}. Revisá el menú.`);
      setConvertRate('');
    } catch (err) {
      setConvertError((err as ApiError).message);
    } finally {
      setConverting(false);
    }
  }

  async function onSaveLoyalty(e: React.FormEvent) {
    e.preventDefault();
    setLoyaltyError(null);
    setLoyaltyNotice(null);
    setSavingLoyalty(true);
    try {
      const updated = await api.patch<LoyaltyProgram>('/loyalty/program', {
        active: loyaltyActive,
        earnPer: Number(earnPer),
        pointValue: Number(pointValue),
      });
      setLoyaltyActive(updated.active);
      setEarnPer(updated.earnPer);
      setPointValue(updated.pointValue);
      setLoyaltyNotice('Programa de puntos guardado.');
    } catch (err) {
      setLoyaltyError((err as ApiError).message);
    } finally {
      setSavingLoyalty(false);
    }
  }

  return (
    <div>
      <PageHeader title="Configuración" description="Datos generales, equipo y facturación de tu restaurante." />
      <SettingsTabs />

      {error && (
        <Alert tone="error" className="mb-4 max-w-md">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="ok" className="mb-4 max-w-md">
          {notice}
        </Alert>
      )}

      {loading && <Skeleton className="h-48 max-w-md" />}

      {!loading && settings && !isOwner && (
        <div className="card max-w-md space-y-3 p-5">
          <div>
            <p className="text-sm text-muted-foreground">Nombre del restaurante</p>
            <p className="font-heading text-lg font-semibold">{settings.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">País</p>
            <p className="font-heading text-lg font-semibold">
              {savedCountry?.countryName ?? settings.countryCode}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Moneda</p>
            <p className="font-heading text-lg font-semibold">
              {settings.currency} {savedCountry ? `(${savedCountry.currencySymbol})` : ''}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Zona horaria</p>
            <p className="font-heading text-lg font-semibold">{settings.timezone}</p>
          </div>
          <p className="text-xs text-muted-foreground">Solo el propietario puede cambiar estos datos.</p>
        </div>
      )}

      {!loading && settings && isOwner && (
        <>
          <Alert tone="warn" className="mb-4 max-w-md">
            Cambiar el país/moneda no convierte los precios ya cargados en el menú — es solo la referencia de moneda
            que se muestra. Después de cambiarla, conviene revisar los precios del menú.
          </Alert>

          <form onSubmit={onSave} className="panel max-w-md space-y-4 p-5">
            <div className="space-y-1.5">
              <label htmlFor="tenant-name" className="label">
                Nombre del restaurante
              </label>
              <input
                id="tenant-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                className="input w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="tenant-country" className="label">
                País
              </label>
              <select
                id="tenant-country"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="input w-full"
              >
                {DLOCAL_COUNTRIES.map((c) => (
                  <option key={c.countryCode} value={c.countryCode}>
                    {c.countryName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Moneda: {selectedCountry ? `${selectedCountry.currency} (${selectedCountry.currencySymbol})` : '—'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="tenant-timezone" className="label">
                Zona horaria
              </label>
              <select
                id="tenant-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="input w-full"
              >
                {/* Si el tenant tiene guardado un huso fuera de la lista curada,
                    lo agregamos como primera opción para no perderlo al guardar. */}
                {timezone && !TIMEZONES.some((t) => t.value === timezone) && (
                  <option value={timezone}>{timezone}</option>
                )}
                {TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Define el corte de “hoy” en el panel y el reloj de las ventas por hora en los reportes.
              </p>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <label className="label" htmlFor="brand-color">
                Color de tu marca
              </label>
              <p className="text-xs text-muted-foreground">
                Es el color de los botones y acentos de tu carta, la que ve el comensal al escanear el QR.
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                {BRAND_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    onClick={() => setBrandColor(p.hex)}
                    title={p.name}
                    aria-label={`Usar ${p.name}`}
                    aria-pressed={brandColor.toUpperCase() === p.hex.toUpperCase()}
                    style={{ backgroundColor: p.hex }}
                    className={`h-9 w-9 rounded-full transition-transform ${
                      brandColor.toUpperCase() === p.hex.toUpperCase()
                        ? 'ring-2 ring-foreground ring-offset-2 ring-offset-surface'
                        : 'hover:scale-110'
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="brand-color"
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value.toUpperCase())}
                  className="h-11 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
                  aria-label="Elegir un color personalizado"
                />
                <input
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value.toUpperCase())}
                  placeholder="#6C4FE0"
                  className="input tabular w-32"
                  aria-label="Color de marca en hexadecimal"
                />
              </div>

              {/* Preview con los MISMOS tokens que usa la carta: el texto del
                  botón se deriva de la luminancia, así que un amarillo recibe
                  texto negro. El tenant ve el resultado real antes de guardar y
                  no puede dejar su carta ilegible. */}
              {isValidHexColor(brandColor) && (
                <div className="mt-2 rounded-lg bg-muted/50 p-3">
                  <p className="mb-2 text-xs text-muted-foreground">Así se va a ver en tu carta:</p>
                  <span
                    className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: brandColor,
                      color: `hsl(${brandTokens(brandColor).primaryForeground})`,
                    }}
                  >
                    Confirmar pedido
                  </span>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Contraste del texto: {brandTokens(brandColor).contrast.toFixed(1)}:1 — legible.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <label className="label" htmlFor="public-subdomain">
                Enlace de tu carta online
              </label>
              <p className="text-xs text-muted-foreground">
                Tu carta compartible para la bio de Instagram o WhatsApp. Elegí un nombre corto;
                queda como <span className="tabular">tunombre.{rootDomain}</span>.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="public-subdomain"
                  value={publicSubdomain}
                  onChange={(e) => setPublicSubdomain(e.target.value.toLowerCase())}
                  placeholder="hamburgueseria"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  maxLength={40}
                  className="input tabular min-w-0 flex-1"
                  aria-describedby="subdomain-preview"
                />
                <span className="shrink-0 text-sm text-muted-foreground">.{rootDomain}</span>
              </div>
              {storeUrl && (
                <div id="subdomain-preview" className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="tabular break-all text-sm text-primary">{storeUrl}</span>
                  <button type="button" onClick={onCopyStoreUrl} className="btn btn-sm">
                    {copied ? '¡Copiado!' : 'Copiar'}
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Dejalo vacío si no querés subdominio — igual funcionan los enlaces por sucursal.
              </p>
            </div>

            <button disabled={saving || !isValidHexColor(brandColor)} className="btn btn-primary">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </form>

          {/* ---- Convertir precios del menú (al cambiar de moneda) ---- */}
          <div className="panel mt-6 max-w-md space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <h2 className="font-heading text-lg font-semibold">Convertir precios del menú</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Al cambiar de moneda cambia el símbolo, pero los montos no. Multiplicá todos los precios
              (productos, costos y extras) por un tipo de cambio para dejarlos bien.
            </p>

            {convertError && <Alert tone="error">{convertError}</Alert>}
            {convertNotice && <Alert tone="ok">{convertNotice}</Alert>}

            <div className="space-y-1.5">
              <label htmlFor="convert-rate" className="label">
                Tipo de cambio (multiplicador)
              </label>
              <input
                id="convert-rate"
                type="number"
                min={0}
                step="any"
                value={convertRate}
                onChange={(e) => setConvertRate(e.target.value)}
                placeholder="ej: 7300 o 0.00014"
                className="input tabular w-full"
              />
              {Number(convertRate) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Ejemplo: un precio de 10.000 pasa a{' '}
                  <span className="tabular text-foreground">
                    {formatMoney(10000 * Number(convertRate), countryCode)}
                  </span>
                  .
                </p>
              )}
            </div>

            <Alert tone="warn">
              Cambia TODOS los precios del menú de una vez. Es reversible aplicando el cambio inverso
              (ej. si multiplicaste por 2, volvés con 0.5).
            </Alert>

            <button
              type="button"
              onClick={onConvertPrices}
              disabled={converting || !(Number(convertRate) > 0)}
              className="btn btn-primary"
            >
              {converting ? 'Convirtiendo...' : 'Convertir precios'}
            </button>
          </div>

          {/* ---- Programa de puntos (fidelización) ---- */}
          <form onSubmit={onSaveLoyalty} className="panel mt-6 max-w-md space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <h2 className="font-heading text-lg font-semibold">Programa de puntos</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Tus clientes ganan puntos al pagar (identificados por su teléfono) y los canjean como descuento en la caja.
            </p>

            {loyaltyError && <Alert tone="error">{loyaltyError}</Alert>}
            {loyaltyNotice && <Alert tone="ok">{loyaltyNotice}</Alert>}

            <label className="flex items-center justify-between gap-3">
              <span className="label">Activar programa de puntos</span>
              <input
                type="checkbox"
                checked={loyaltyActive}
                onChange={(e) => setLoyaltyActive(e.target.checked)}
                className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
                aria-label="Activar programa de puntos"
              />
            </label>

            <div className="space-y-1.5">
              <label htmlFor="loyalty-earn" className="label">
                Gastar cada … para ganar 1 punto
              </label>
              <input
                id="loyalty-earn"
                type="number"
                min={1}
                step="0.01"
                value={earnPer}
                onChange={(e) => setEarnPer(e.target.value)}
                className="input tabular w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="loyalty-value" className="label">
                Cada punto vale …
              </label>
              <input
                id="loyalty-value"
                type="number"
                min={0.01}
                step="0.01"
                value={pointValue}
                onChange={(e) => setPointValue(e.target.value)}
                className="input tabular w-full"
              />
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              Un cliente que gasta{' '}
              <span className="tabular font-medium text-foreground">
                {formatMoney(Number(earnPer) * 10, countryCode)}
              </span>{' '}
              gana 10 puntos ={' '}
              <span className="tabular font-medium text-foreground">
                {formatMoney(Number(pointValue) * 10, countryCode)}
              </span>{' '}
              de descuento.
            </div>

            <button disabled={savingLoyalty} className="btn btn-primary">
              {savingLoyalty ? 'Guardando...' : 'Guardar programa de puntos'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
