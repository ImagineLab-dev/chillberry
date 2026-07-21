'use client';

import { useEffect, useState } from 'react';
import { Pencil, Power, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { getCurrentUser } from '@/lib/auth';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { SettingsTabs } from '@/components/settings-tabs';

type StaffUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
};

type CurrentUser = { id: string; role: string };

const ROLES = ['ADMIN', 'WAITER', 'KITCHEN', 'CASHIER', 'DRIVER'];

export default function StaffPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('WAITER');
  const [error, setError] = useState<string | null>(null);
  // Carga inicial del equipo (GET /users). Sin esto, un GET fallido/lento se veía
  // igual que "todavía no cargaste a nadie" (cuenta vacía), sin forma de reintentar.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edición inline: solo una fila editable a la vez.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Solo el propietario puede cambiar roles o tocar la fila de otro propietario
  // (reglas espejadas de UsersService.update en el backend).
  const isOwner = currentUser?.role === 'OWNER';

  async function load() {
    setUsers(await api.get<StaffUser[]>('/users'));
  }

  useEffect(() => {
    load()
      .catch((err) => setLoadError((err as ApiError).message))
      .finally(() => setLoading(false));
    getCurrentUser()
      .then((me) => setCurrentUser({ id: me.id, role: me.role }))
      .catch(() => {});
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/users', { name, email, password, role });
      setName('');
      setEmail('');
      setPassword('');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  function startEdit(u: StaffUser) {
    setError(null);
    setEditingId(u.id);
    setEditName(u.name);
    setEditPhone(u.phone ?? '');
    setEditRole(u.role);
    setEditPassword('');
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function onSaveEdit(e: React.FormEvent, u: StaffUser) {
    e.preventDefault();
    setError(null);
    setSavingId(u.id);
    try {
      // `role` solo se manda si el que edita es OWNER: si se manda igual
      // (aunque no haya cambiado) para un no-owner, el backend lo rechaza
      // con 403 por la sola presencia del campo — no por el valor.
      await api.patch(`/users/${u.id}`, {
        name: editName,
        phone: editPhone.trim() ? editPhone.trim() : undefined,
        role: isOwner ? editRole : undefined,
        // Solo se manda si el owner/admin escribió una clave nueva (reset).
        password: editPassword.trim() ? editPassword.trim() : undefined,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSavingId(null);
    }
  }

  async function onToggleActive(u: StaffUser) {
    setError(null);
    setTogglingId(u.id);
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setTogglingId(null);
    }
  }

  // Borrado DURO. El backend solo lo permite si el usuario no tiene historial;
  // si lo tiene devuelve 409 con el texto que le mostramos al usuario ("...
  // desactivalo en su lugar"). Confirmamos siempre: es irreversible.
  async function onDelete(u: StaffUser) {
    setError(null);
    if (!window.confirm(`¿Eliminar definitivamente a ${u.name}? Esta acción no se puede deshacer.`)) return;
    setDeletingId(u.id);
    try {
      await api.delete(`/users/${u.id}`);
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Configuración" description="Las cuentas de tu personal y qué puede hacer cada uno." />
      <SettingsTabs />

      <form onSubmit={onCreate} className="mb-6 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          required
          className="input w-full sm:w-44"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="input w-full sm:w-52"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          required
          minLength={8}
          className="input w-full sm:w-44"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input w-full sm:w-36">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">
          <UserPlus className="h-4 w-4" />
          Crear usuario
        </button>
      </form>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}

      {loadError && !loading && (
        <Alert tone="error" className="mb-4">
          {loadError}
        </Alert>
      )}

      <ul className="space-y-2">
        {users.map((u) => {
          const isSelf = currentUser?.id === u.id;
          const isTargetOwner = u.role === 'OWNER';
          // Regla 3: solo un OWNER puede tocar la fila de otro OWNER.
          const canManage = isOwner || !isTargetOwner;
          // Regla 2: nadie se desactiva a sí mismo.
          const canToggleActive = canManage && !isSelf;
          const isEditing = editingId === u.id;
          // Si el rol actual del usuario no está en el select (p. ej. OWNER),
          // lo agregamos como opción para que el value siempre matchee y no
          // se termine mandando un rol distinto al guardar sin querer.
          const roleOptions = ROLES.includes(u.role) ? ROLES : [u.role, ...ROLES];

          return (
            <li key={u.id} className="card px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* `break-words`: el email es un token sin espacios y no corta
                    solo — a 375px se sale de la tarjeta. */}
                <span className="min-w-0 break-words">
                  <span className="font-heading font-medium text-foreground">{u.name}</span>{' '}
                  <span className="text-muted-foreground">({u.email})</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{u.role}</Badge>
                  <Badge tone={u.active ? 'ok' : 'error'} dot>
                    {u.active ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => (isEditing ? cancelEdit() : startEdit(u))}
                        className="btn btn-sm"
                      >
                        {isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                        {isEditing ? 'Cancelar' : 'Editar'}
                      </button>
                      {canToggleActive && (
                        <button
                          type="button"
                          onClick={() => onToggleActive(u)}
                          disabled={togglingId === u.id}
                          className="btn btn-sm"
                          title={u.active ? 'Desactivar cuenta' : 'Reactivar cuenta'}
                        >
                          <Power className="h-4 w-4" />
                          {togglingId === u.id ? '...' : u.active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => onDelete(u)}
                          disabled={deletingId === u.id}
                          className="btn btn-sm btn-danger"
                          title="Eliminar definitivamente (solo si no tiene historial)"
                        >
                          <Trash2 className="h-4 w-4" />
                          {deletingId === u.id ? '...' : 'Eliminar'}
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Solo el propietario puede editar esta cuenta</span>
                  )}
                </div>
              </div>

              {isEditing && (
                <form
                  onSubmit={(e) => onSaveEdit(e, u)}
                  className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
                >
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nombre"
                      required
                      className="input w-full sm:w-44"
                    />
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="Teléfono"
                      className="input w-full sm:w-44"
                    />
                    {isOwner ? (
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        className="input w-full sm:w-36"
                      >
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="input flex w-full items-center text-muted-foreground sm:w-36">{u.role}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="Nueva contraseña (opcional)"
                      minLength={8}
                      autoComplete="new-password"
                      className="input w-full sm:w-64"
                    />
                    <span className="text-xs text-muted-foreground">
                      Dejá en blanco para no cambiarla. Al resetear, se cierran sus sesiones.
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button className="btn btn-primary" disabled={savingId === u.id}>
                      {savingId === u.id ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {!loading && !loadError && users.length === 0 && (
        <EmptyState
          icon={UsersRound}
          title="Todavía no cargaste a nadie del equipo"
          description="Sumá a tus mozos, cocina y caja acá arriba. Cada uno entra con su propio usuario y ve solo lo suyo."
        />
      )}
    </div>
  );
}
