'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_BRAND_COLOR, isValidHexColor } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { Palette } from 'lucide-react';
import {
  CARTA_FONTS,
  CARTA_HEADER_STYLES,
  CARTA_LAYOUTS,
  DEFAULT_CARTA_THEME,
  type CartaFont,
  type CartaHeaderStyle,
  type CartaLayout,
  type CartaTheme,
} from '@/lib/carta-theme';
import { CartaDesignPreview, type PreviewProduct } from '@/components/carta-design-preview';
import { ImageUploader } from '@/components/image-uploader';

// Sólo los campos que este editor necesita del branch. El resto del record que
// devuelve GET /branches se ignora.
type Branch = {
  id: string;
  name: string;
  publicSlug: string | null;
  coverImageUrl: string | null;
  cartaTheme: CartaTheme | null;
};

type TenantSettings = { brandColor: string | null; countryCode: string };

// Sólo lo que consume el preview de la carta pública.
type PublicMenu = {
  brandColor: string | null;
  countryCode: string;
  restaurantLogoUrl: string | null;
  categories: {
    items: { id: string; name: string; description: string | null; price: string; imageUrl: string | null }[];
  }[];
};

// Muestra cuando la sucursal todavía no tiene enlace público (no hay productos
// reales que traer). Precios en guaraníes, coherentes con el default PY.
const SAMPLE_PRODUCTS: PreviewProduct[] = [
  {
    id: 's1',
    name: 'Milanesa napolitana',
    description: 'Con papas fritas, jamón, queso y salsa de tomate.',
    price: 45000,
    imageUrl: null,
  },
  {
    id: 's2',
    name: 'Hamburguesa completa',
    description: 'Doble medallón, cheddar, panceta y salsa de la casa.',
    price: 38000,
    imageUrl: null,
  },
  {
    id: 's3',
    name: 'Flan casero',
    description: 'Con dulce de leche y crema.',
    price: 18000,
    imageUrl: null,
  },
];

export default function CartaDesignPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');

  // Campos editables del tema (todos opcionales → vacío = default).
  const [primaryColor, setPrimaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [font, setFont] = useState<CartaFont>(DEFAULT_CARTA_THEME.font);
  const [layout, setLayout] = useState<CartaLayout>(DEFAULT_CARTA_THEME.layout);
  const [showImages, setShowImages] = useState(DEFAULT_CARTA_THEME.showImages);
  const [showDescriptions, setShowDescriptions] = useState(DEFAULT_CARTA_THEME.showDescriptions);
  const [headerStyle, setHeaderStyle] = useState<CartaHeaderStyle>(DEFAULT_CARTA_THEME.headerStyle);
  const [logoUrl, setLogoUrl] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState(''); // vive en el branch, no en cartaTheme

  // Datos reales de la carta pública para previsualizar productos verdaderos.
  const [menu, setMenu] = useState<PublicMenu | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedId) ?? null,
    [branches, selectedId],
  );
  const selectedSlug = selectedBranch?.publicSlug ?? null;

  useEffect(() => {
    Promise.all([
      api.get<Branch[]>('/branches'),
      api.get<TenantSettings>('/tenant-settings').catch(() => null),
    ])
      .then(([b, t]) => {
        setBranches(b);
        setTenant(t);
        if (b[0]) setSelectedId(b[0].id);
      })
      .catch((err) => setLoadError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, []);

  // Al cambiar de sucursal, sembrar el formulario con SU tema guardado. Keyed en
  // selectedId a propósito: no queremos re-sembrar (pisar ediciones) cuando la
  // lista de branches se actualiza tras guardar.
  useEffect(() => {
    if (!selectedBranch) return;
    const t = selectedBranch.cartaTheme ?? {};
    setPrimaryColor(t.primaryColor ?? '');
    setAccentColor(t.accentColor ?? '');
    setFont(t.font ?? DEFAULT_CARTA_THEME.font);
    setLayout(t.layout ?? DEFAULT_CARTA_THEME.layout);
    setShowImages(t.showImages ?? DEFAULT_CARTA_THEME.showImages);
    setShowDescriptions(t.showDescriptions ?? DEFAULT_CARTA_THEME.showDescriptions);
    setHeaderStyle(t.headerStyle ?? DEFAULT_CARTA_THEME.headerStyle);
    setLogoUrl(t.logoUrl ?? '');
    setCoverImageUrl(selectedBranch.coverImageUrl ?? '');
    setSaveError(null);
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Traer la carta pública real (para previsualizar productos verdaderos) sólo
  // si la sucursal tiene enlace. Keyed en el slug para no refetchear de más.
  useEffect(() => {
    setMenu(null);
    if (!selectedSlug) return;
    let cancelled = false;
    api
      .get<PublicMenu>(`/public/menu/branch/${selectedSlug}`, { publicEndpoint: true })
      .then((m) => {
        if (!cancelled) setMenu(m);
      })
      .catch(() => {
        // Sin carta pública accesible: el preview cae a los productos de muestra.
        if (!cancelled) setMenu(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  // Tema pendiente: sólo se incluyen las claves que difieren del default, así un
  // branch que sólo eligió un color queda como `{ primaryColor }` y no arrastra
  // valores redundantes. Si queda sin claves, se guarda `null` (usar defaults).
  const pendingTheme = useMemo<CartaTheme>(() => {
    const t: CartaTheme = {};
    const pc = primaryColor.trim();
    const ac = accentColor.trim();
    if (pc) t.primaryColor = pc;
    if (ac) t.accentColor = ac;
    if (font !== DEFAULT_CARTA_THEME.font) t.font = font;
    if (layout !== DEFAULT_CARTA_THEME.layout) t.layout = layout;
    if (showImages !== DEFAULT_CARTA_THEME.showImages) t.showImages = showImages;
    if (showDescriptions !== DEFAULT_CARTA_THEME.showDescriptions) t.showDescriptions = showDescriptions;
    if (headerStyle !== DEFAULT_CARTA_THEME.headerStyle) t.headerStyle = headerStyle;
    if (logoUrl.trim()) t.logoUrl = logoUrl.trim();
    return t;
  }, [primaryColor, accentColor, font, layout, showImages, showDescriptions, headerStyle, logoUrl]);

  const isEmptyTheme = Object.keys(pendingTheme).length === 0;

  // Fuente de verdad del preview: cuando hay carta pública usamos SUS valores
  // (color de marca y moneda reales); si no, los del tenant.
  const previewBrandColor = menu?.brandColor ?? tenant?.brandColor ?? null;
  const previewCountryCode = menu?.countryCode ?? tenant?.countryCode ?? 'PY';
  const previewLogo = menu?.restaurantLogoUrl ?? null;
  const swatchBrand = previewBrandColor && isValidHexColor(previewBrandColor) ? previewBrandColor : DEFAULT_BRAND_COLOR;

  const previewProducts = useMemo<PreviewProduct[]>(() => {
    const real = (menu?.categories.flatMap((c) => c.items) ?? [])
      .slice(0, 4)
      .map((i) => ({ id: i.id, name: i.name, description: i.description, price: i.price, imageUrl: i.imageUrl }));
    return real.length > 0 ? real : SAMPLE_PRODUCTS;
  }, [menu]);

  const primaryInvalid = primaryColor.trim() !== '' && !isValidHexColor(primaryColor.trim());
  const accentInvalid = accentColor.trim() !== '' && !isValidHexColor(accentColor.trim());
  const canSave = !!selectedBranch && !saving && !primaryInvalid && !accentInvalid;

  async function onSave() {
    if (!selectedBranch) return;
    setSaveError(null);
    setNotice(null);
    setSaving(true);
    const nextTheme = isEmptyTheme ? null : pendingTheme;
    const nextCover = coverImageUrl.trim() || null;
    try {
      await api.patch(`/branches/${selectedBranch.id}`, { cartaTheme: nextTheme, coverImageUrl: nextCover });
      setBranches((prev) =>
        prev.map((b) => (b.id === selectedBranch.id ? { ...b, cartaTheme: nextTheme, coverImageUrl: nextCover } : b)),
      );
      setNotice('Diseño guardado. Así se va a ver la carta pública de esta sucursal.');
    } catch (err) {
      setSaveError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    if (!selectedBranch) return;
    setSaveError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.patch(`/branches/${selectedBranch.id}`, { cartaTheme: null });
      setBranches((prev) => prev.map((b) => (b.id === selectedBranch.id ? { ...b, cartaTheme: null } : b)));
      // El reset toca sólo el tema (no la portada del branch): volvemos los
      // controles del tema a sus defaults.
      setPrimaryColor('');
      setAccentColor('');
      setFont(DEFAULT_CARTA_THEME.font);
      setLayout(DEFAULT_CARTA_THEME.layout);
      setShowImages(DEFAULT_CARTA_THEME.showImages);
      setShowDescriptions(DEFAULT_CARTA_THEME.showDescriptions);
      setHeaderStyle(DEFAULT_CARTA_THEME.headerStyle);
      setLogoUrl('');
      setNotice('Diseño restablecido a los valores por defecto.');
    } catch (err) {
      setSaveError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Diseño de carta"
        description="Personalizá cómo se ve la carta pública de cada sucursal: colores, tipografía, layout y portada. El preview se actualiza en vivo."
      />

      {loadError && (
        <Alert tone="error" className="mb-4 max-w-xl">
          {loadError}
        </Alert>
      )}

      {loading && <Skeleton className="h-96 max-w-xl" />}

      {!loading && !loadError && branches.length === 0 && (
        <EmptyState
          icon={Palette}
          title="Todavía no hay sucursales"
          description="Creá una sucursal en la sección Sucursales y volvé para diseñar su carta."
        />
      )}

      {!loading && branches.length > 0 && (
        <>
          <div className="mb-6 max-w-sm space-y-1.5">
            <label htmlFor="carta-branch" className="label">
              Sucursal
            </label>
            <select
              id="carta-branch"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="input w-full"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {selectedBranch && !selectedBranch.publicSlug && (
              <p className="text-xs text-muted-foreground">
                Esta sucursal todavía no tiene enlace público, así que el preview usa productos de ejemplo. Igual podés
                dejar el diseño listo.
              </p>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ---- Controles ---- */}
            <div className="panel space-y-6 p-5">
              {saveError && <Alert tone="error">{saveError}</Alert>}
              {notice && <Alert tone="ok">{notice}</Alert>}

              {/* Color principal */}
              <div className="space-y-2">
                <label className="label" htmlFor="carta-primary">
                  Color principal
                </label>
                <p className="text-xs text-muted-foreground">
                  Es el color de los botones y acentos de la carta. Si lo dejás vacío usa el color de la marca.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    id="carta-primary"
                    type="color"
                    value={primaryColor || swatchBrand}
                    onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                    className="h-11 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
                    aria-label="Elegir color principal"
                  />
                  <input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                    placeholder="Usa el color de la marca"
                    className="input tabular w-44"
                    aria-label="Color principal en hexadecimal"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {primaryColor && (
                    <button type="button" onClick={() => setPrimaryColor('')} className="btn btn-sm min-h-[44px]">
                      Usar marca
                    </button>
                  )}
                </div>
                {primaryInvalid && <p className="text-xs text-error-foreground">Poné un color hex válido, ej. #6C4FE0.</p>}
              </div>

              {/* Color de acento */}
              <div className="space-y-2 border-t border-border pt-4">
                <label className="label" htmlFor="carta-accent">
                  Color de acento
                </label>
                <p className="text-xs text-muted-foreground">
                  Un segundo color para títulos y detalles. Opcional.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    id="carta-accent"
                    type="color"
                    value={accentColor || swatchBrand}
                    onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                    className="h-11 w-14 cursor-pointer rounded-md border border-border bg-transparent p-1"
                    aria-label="Elegir color de acento"
                  />
                  <input
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                    placeholder="Sin acento"
                    className="input tabular w-44"
                    aria-label="Color de acento en hexadecimal"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {accentColor && (
                    <button type="button" onClick={() => setAccentColor('')} className="btn btn-sm min-h-[44px]">
                      Quitar acento
                    </button>
                  )}
                </div>
                {accentInvalid && <p className="text-xs text-error-foreground">Poné un color hex válido, ej. #00838F.</p>}
              </div>

              {/* Letra */}
              <div className="space-y-1.5 border-t border-border pt-4">
                <label className="label" htmlFor="carta-font">
                  Letra
                </label>
                <select
                  id="carta-font"
                  value={font}
                  onChange={(e) => setFont(e.target.value as CartaFont)}
                  className="input w-full"
                >
                  {(Object.keys(CARTA_FONTS) as CartaFont[]).map((k) => (
                    <option key={k} value={k}>
                      {CARTA_FONTS[k].label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Layout */}
              <div className="space-y-1.5 border-t border-border pt-4">
                <span className="label">Layout</span>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Layout de la carta">
                  {(Object.keys(CARTA_LAYOUTS) as CartaLayout[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLayout(k)}
                      aria-pressed={layout === k}
                      className={`btn min-h-[44px] ${layout === k ? 'btn-primary' : ''}`}
                    >
                      {CARTA_LAYOUTS[k]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visibilidad */}
              <div className="space-y-2 border-t border-border pt-4">
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="label">Mostrar fotos</span>
                  <input
                    type="checkbox"
                    checked={showImages}
                    onChange={(e) => setShowImages(e.target.checked)}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
                    aria-label="Mostrar fotos de los productos"
                  />
                </label>
                <label className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="label">Mostrar descripciones</span>
                  <input
                    type="checkbox"
                    checked={showDescriptions}
                    onChange={(e) => setShowDescriptions(e.target.checked)}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
                    aria-label="Mostrar descripciones de los productos"
                  />
                </label>
              </div>

              {/* Portada */}
              <div className="space-y-3 border-t border-border pt-4">
                <div className="space-y-1.5">
                  <label className="label" htmlFor="carta-header">
                    Portada
                  </label>
                  <select
                    id="carta-header"
                    value={headerStyle}
                    onChange={(e) => setHeaderStyle(e.target.value as CartaHeaderStyle)}
                    className="input w-full"
                  >
                    {(Object.keys(CARTA_HEADER_STYLES) as CartaHeaderStyle[]).map((k) => (
                      <option key={k} value={k}>
                        {CARTA_HEADER_STYLES[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <ImageUploader
                  label="Portada"
                  value={coverImageUrl}
                  onChange={setCoverImageUrl}
                  recommendation="1600 × 600 px · proporción 3:1 (banner ancho)"
                  help='La foto de fondo del encabezado. Se usa cuando la portada es "Foto de portada".'
                  previewClass="aspect-[3/1]"
                />

                <ImageUploader
                  label="Logo"
                  value={logoUrl}
                  onChange={setLogoUrl}
                  recommendation="512 × 512 px · cuadrado (1:1), fondo transparente (PNG)"
                  help="Si lo dejás vacío usa el logo del restaurante."
                  previewClass="aspect-square"
                />
              </div>

              {/* Acciones */}
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <button type="button" onClick={onSave} disabled={!canSave} className="btn btn-primary min-h-[44px]">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  disabled={!selectedBranch || saving}
                  className="btn min-h-[44px]"
                >
                  Restablecer
                </button>
              </div>
            </div>

            {/* ---- Preview ---- */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <p className="mb-3 text-sm font-medium text-muted-foreground">Vista previa</p>
              <CartaDesignPreview
                theme={pendingTheme}
                brandColor={previewBrandColor}
                branchName={selectedBranch?.name ?? ''}
                coverImageUrl={coverImageUrl.trim() || null}
                restaurantLogoUrl={previewLogo}
                countryCode={previewCountryCode}
                products={previewProducts}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
