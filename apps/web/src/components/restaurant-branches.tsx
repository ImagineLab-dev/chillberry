'use client';

import { useEffect, useState } from 'react';
import { Globe, Pencil, Plus, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, Skeleton } from '@/components/ui';
import { BranchPublicConfig } from '@/components/branch-public-config';
import { BranchScheduleEditor } from '@/components/branch-schedule-editor';

type Branch = {
  id: string;
  name: string;
  address: string;
  restaurantId: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  coverImageUrl: string | null;
  active: boolean;
  // Carta pública / pedido online (pueden faltar en datos viejos).
  publicSlug: string | null;
  publicOrderingEnabled: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string; // Decimal-as-string
  // Ventana de delivery en minutos desde medianoche (null = sin restricción).
  deliveryStartMinute: number | null;
  deliveryEndMinute: number | null;
};

type EditForm = {
  name: string;
  address: string;
  phone: string;
  lat: string;
  lng: string;
  coverImageUrl: string;
  active: boolean;
};

function toEditForm(b: Branch): EditForm {
  return {
    name: b.name,
    address: b.address,
    phone: b.phone ?? '',
    lat: b.lat !== null ? String(b.lat) : '',
    lng: b.lng !== null ? String(b.lng) : '',
    coverImageUrl: b.coverImageUrl ?? '',
    active: b.active,
  };
}

/**
 * Gestión de las sucursales de UN restaurante. Vive anidado dentro de la card
 * del restaurante en la pantalla de Restaurantes: crear, editar datos básicos,
 * activar/desactivar y configurar la carta pública (reusa BranchPublicConfig y
 * BranchScheduleEditor). El listado se acota con `?restaurantId` para traer sólo
 * las sucursales de este restaurante.
 */
export function RestaurantBranches({ restaurantId }: { restaurantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Alta de sucursal — acotada a este restaurante (no hay selector).
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);

  // Panel de "Pedido online" — independiente del panel de edición básica.
  const [configId, setConfigId] = useState<string | null>(null);

  async function load() {
    const b = await api.get<Branch[]>('/branches', { query: { restaurantId } });
    setBranches(b);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<Branch[]>('/branches', { query: { restaurantId } })
      .then((b) => {
        if (cancelled) return;
        setBranches(b);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as ApiError).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await api.post('/branches', { restaurantId, name, address, phone: phone || undefined });
      setName('');
      setAddress('');
      setPhone('');
      await load();
    } catch (err) {
      setCreateError((err as ApiError).message);
    } finally {
      setCreating(false);
    }
  }

  function onStartEdit(b: Branch) {
    setEditingId(b.id);
    setEditForm(toEditForm(b));
    setEditError(null);
    setCoverUploadError(null);
  }

  function onCancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  }

  async function onCoverImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editForm) return;
    setCoverUploadError(null);
    setCoverUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      setEditForm({ ...editForm, coverImageUrl: url });
    } catch (err) {
      setCoverUploadError((err as ApiError).message);
    } finally {
      setCoverUploading(false);
    }
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editForm) return;
    setEditError(null);
    setSavingId(editingId);
    try {
      const lat = editForm.lat.trim() === '' ? undefined : Number(editForm.lat);
      const lng = editForm.lng.trim() === '' ? undefined : Number(editForm.lng);
      if (lat !== undefined && Number.isNaN(lat)) throw { status: 400, message: 'Latitud inválida' } as ApiError;
      if (lng !== undefined && Number.isNaN(lng)) throw { status: 400, message: 'Longitud inválida' } as ApiError;

      await api.patch(`/branches/${editingId}`, {
        name: editForm.name,
        address: editForm.address,
        phone: editForm.phone || undefined,
        lat,
        lng,
        coverImageUrl: editForm.coverImageUrl || null,
        active: editForm.active,
      });
      setEditingId(null);
      setEditForm(null);
      await load();
    } catch (err) {
      setEditError((err as ApiError).message);
    } finally {
      setSavingId(null);
    }
  }

  async function onToggleActive(b: Branch) {
    setLoadError(null);
    setSavingId(b.id);
    try {
      await api.patch(`/branches/${b.id}`, { active: !b.active });
      await load();
    } catch (err) {
      setLoadError((err as ApiError).message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Alta de sucursal para este restaurante */}
      <form onSubmit={onCreate} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la sucursal"
          required
          className="input w-full sm:w-52"
        />
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Dirección"
          required
          className="input w-full sm:w-52"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Teléfono (opcional)"
          className="input w-full sm:w-44"
        />
        <button className="btn btn-primary" disabled={creating}>
          <Plus className="h-4 w-4" />
          {creating ? 'Creando...' : 'Sumar sucursal'}
        </button>
      </form>
      {createError && <Alert tone="error">{createError}</Alert>}

      {loading && <Skeleton className="h-16 w-full" />}
      {loadError && !loading && <Alert tone="error">{loadError}</Alert>}

      {!loading && !loadError && branches.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Este restaurante todavía no tiene sucursales. Cargá la primera acá arriba.
        </p>
      )}

      {branches.length > 0 && (
        <ul className="space-y-2">
          {branches.map((b) => {
            const isEditing = editingId === b.id;
            const isConfiguring = configId === b.id;
            return (
              <li key={b.id} className="card card-dense px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-heading font-medium text-foreground">{b.name}</span>{' '}
                    <span className="text-muted-foreground">— {b.address}</span>
                    {b.phone && <span className="text-muted-foreground"> · {b.phone}</span>}
                    {b.publicOrderingEnabled && b.publicSlug && (
                      <span className="ml-2 align-middle">
                        <Badge tone="info">Pedido online</Badge>
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {/* El badge es el toggle de estado (comportamiento original). */}
                    <button
                      type="button"
                      onClick={() => onToggleActive(b)}
                      disabled={savingId === b.id}
                      title="Click para cambiar estado"
                      className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Badge tone={b.active ? 'ok' : 'error'} dot>
                        {b.active ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfigId(isConfiguring ? null : b.id)}
                      className="btn btn-sm"
                      aria-expanded={isConfiguring}
                    >
                      {isConfiguring ? <X className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                      {isConfiguring ? 'Cerrar' : 'Pedido online'}
                    </button>
                    <button
                      type="button"
                      onClick={() => (isEditing ? onCancelEdit() : onStartEdit(b))}
                      className="btn btn-sm"
                    >
                      {isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                      {isEditing ? 'Cancelar' : 'Editar'}
                    </button>
                  </div>
                </div>

                {isEditing && editForm && (
                  <form onSubmit={onSaveEdit} className="mt-3 space-y-2 border-t border-border pt-3">
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="Nombre"
                        required
                        className="input w-full sm:w-52"
                      />
                      <input
                        value={editForm.address}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                        placeholder="Dirección"
                        required
                        className="input w-full sm:w-52"
                      />
                      <input
                        value={editForm.phone}
                        onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        placeholder="Teléfono (opcional)"
                        className="input w-full sm:w-44"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        step="any"
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        placeholder="Latitud (opcional)"
                        className="input w-full sm:w-40"
                      />
                      <input
                        type="number"
                        step="any"
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        placeholder="Longitud (opcional)"
                        className="input w-full sm:w-40"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={editForm.active}
                          onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                        />
                        Activa
                      </label>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Portada del menú público (banner que ve el cliente al escanear el QR)
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={onCoverImageChange}
                          className="text-xs"
                        />
                        {coverUploading && <span className="text-xs text-muted-foreground">Subiendo...</span>}
                        {editForm.coverImageUrl && !coverUploading && (
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, coverImageUrl: '' })}
                            className="btn btn-sm"
                          >
                            Quitar portada
                          </button>
                        )}
                      </div>
                      {editForm.coverImageUrl && !coverUploading && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={editForm.coverImageUrl}
                          alt="Portada"
                          className="mt-2 h-20 w-full rounded-md object-cover"
                        />
                      )}
                      {coverUploadError && <p className="mt-1 text-xs text-error-foreground">{coverUploadError}</p>}
                    </div>
                    {editError && <Alert tone="error">{editError}</Alert>}
                    <div className="flex gap-2">
                      <button className="btn btn-primary" disabled={savingId === b.id}>
                        Guardar
                      </button>
                      <button type="button" onClick={onCancelEdit} className="btn">
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                {isConfiguring && (
                  <div className="mt-3 space-y-6 border-t border-border pt-4">
                    <BranchPublicConfig branch={b} onSaved={() => load().catch(() => {})} />
                    <BranchScheduleEditor branchId={b.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
