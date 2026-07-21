'use client';

import { AyudaSeccion } from '@/components/ayuda-seccion';
import { useEffect, useState } from 'react';
import { Building2, ChevronDown, ChevronUp, Pencil, Plus, Power, Store, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { RestaurantBranches } from '@/components/restaurant-branches';
import { SettingsTabs } from '@/components/settings-tabs';

type Restaurant = { id: string; name: string; active: boolean; logoUrl: string | null; createdAt: string };

export default function RestaurantsPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Carga inicial (GET /restaurants). Sin esto, un GET fallido/lento se veía igual
  // que "no cargaste ningún restaurante" (cuenta vacía), sin forma de reintentar.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Qué restaurante tiene desplegada su sección de sucursales.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load() {
    setRestaurants(await api.get<Restaurant[]>('/restaurants'));
  }

  useEffect(() => {
    load()
      .catch((err) => setLoadError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/restaurants', { name });
      setName('');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  function startEdit(r: Restaurant) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditLogoUrl(r.logoUrl ?? '');
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditLogoUrl('');
    setEditError(null);
  }

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEditError(null);
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      setEditLogoUrl(url);
    } catch (err) {
      setEditError((err as ApiError).message);
    } finally {
      setUploading(false);
    }
  }

  async function onSaveEdit(id: string) {
    setEditError(null);
    setSaving(true);
    try {
      await api.patch(`/restaurants/${id}`, { name: editName, logoUrl: editLogoUrl || undefined });
      await load();
      cancelEdit();
    } catch (err) {
      setEditError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function onToggleActive(r: Restaurant) {
    setEditError(null);
    setTogglingId(r.id);
    try {
      await api.patch(`/restaurants/${r.id}`, { active: !r.active });
      await load();
    } catch (err) {
      setEditError((err as ApiError).message);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Configuración" description="Tus marcas y sucursales." />

      <AyudaSeccion id="restaurants" titulo="Acá empieza todo">
        <p>Un <b>restaurante</b> es tu marca; una <b>sucursal</b> es cada local con su dirección.</p>
        <p>Si tenés un solo local, creás el restaurante y una sucursal adentro. Todo lo demás —la carta, las mesas, la caja— cuelga de la sucursal.</p>
      </AyudaSeccion>

      <SettingsTabs />

      <form onSubmit={onCreate} className="mb-6 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del restaurante"
          required
          className="input w-full sm:w-72"
        />
        <button className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Crear
        </button>
      </form>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}

      {loadError && !loading && (
        <Alert tone="error" className="mb-4">
          {loadError}
        </Alert>
      )}

      <ul className="space-y-3">
        {restaurants.map((r) => (
          <li key={r.id} className="card px-4 py-3 text-sm">
            <div className="flex items-center gap-4">
              {r.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.logoUrl} alt={r.name} className="h-12 w-12 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Store className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-heading font-medium text-foreground">{r.name}</span>
                <Badge tone={r.active ? 'ok' : 'error'} dot>
                  {r.active ? 'Activo' : 'Inactivo'}
                </Badge>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="btn btn-sm"
                  aria-expanded={expandedId === r.id}
                >
                  <Building2 className="h-4 w-4" />
                  Sucursales
                  {expandedId === r.id ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => (editingId === r.id ? cancelEdit() : startEdit(r))}
                  className="btn btn-sm"
                >
                  {editingId === r.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  {editingId === r.id ? 'Cerrar' : 'Editar'}
                </button>
                <button
                  onClick={() => onToggleActive(r)}
                  disabled={togglingId === r.id}
                  className="btn btn-sm"
                  title={r.active ? 'Desactivar restaurante' : 'Reactivar restaurante'}
                >
                  <Power className="h-4 w-4" />
                  {togglingId === r.id ? '...' : r.active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>

            {editingId === r.id && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nombre del restaurante"
                  className="input w-full max-w-sm"
                />

                <div className="flex flex-wrap items-center gap-3">
                  {editLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={editLogoUrl} alt="Logo" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-md bg-muted" />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onLogoChange}
                    disabled={uploading}
                    className="text-sm"
                  />
                  {uploading && <span className="text-muted-foreground">Subiendo...</span>}
                </div>

                {editError && <Alert tone="error">{editError}</Alert>}

                <div className="flex gap-2">
                  <button onClick={() => onSaveEdit(r.id)} disabled={saving || uploading} className="btn btn-primary">
                    Guardar
                  </button>
                  <button onClick={cancelEdit} className="btn">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {expandedId === r.id && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-3 font-heading text-sm font-semibold text-foreground">
                  Sucursales de {r.name}
                </h3>
                <RestaurantBranches restaurantId={r.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {!loading && !loadError && restaurants.length === 0 && (
        <EmptyState
          icon={Store}
          title="Todavía no cargaste ningún restaurante"
          description="Empezá creando tu primer restaurante acá arriba. Después vas a poder sumarle sucursales, mesas y menú."
        />
      )}
    </div>
  );
}
