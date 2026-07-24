'use client';

import { AyudaSeccion } from '@/components/ayuda-seccion';
import { useEffect, useState } from 'react';
import { MailPlus, Pencil, Power, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { getCurrentUser } from '@/lib/auth';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { SettingsTabs } from '@/components/settings-tabs';
import { ROLE_LABEL } from '@/lib/status-labels';

type StaffUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  active: boolean;
  /** Sucursal donde trabaja. `null` = ve todos los locales (el dueño). */
  branchId: string | null;
  /** true = se creó por invitación y todavía no fijó su contraseña (no puede entrar aún). */
  invitePending: boolean;
  createdAt: string;
};

type Sucursal = { id: string; name: string };

type CurrentUser = { id: string; role: string };

const ROLES = ['ADMIN', 'WAITER', 'KITCHEN', 'CASHIER', 'DRIVER'];

export default function StaffPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('WAITER');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Guard de doble click en el alta: dos POSTs seguidos creaban la cuenta y
  // ademas mostraban "invitacion enviada" + "ya existe" a la vez.
  const [creating, setCreating] = useState(false);
  // Carga inicial del equipo (GET /users). Sin esto, un GET fallido/lento se veía
  // igual que "todavía no cargaste a nadie" (cuenta vacía), sin forma de reintentar.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edición inline: solo una fila editable a la vez.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editBranchId, setEditBranchId] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Solo el propietario puede cambiar roles o tocar la fila de otro propietario
  // (reglas espejadas de UsersService.update en el backend).
  const isOwner = currentUser?.role === 'OWNER';

  async function load() {
    setUsers(await api.get<StaffUser[]>('/users'));
  }

  const nombreSucursal = (id: string | null) => sucursales.find((b) => b.id === id)?.name ?? null;

  useEffect(() => {
    load()
      .catch((err) => setLoadError((err as ApiError).message))
      .finally(() => setLoading(false));
    getCurrentUser()
      .then((me) => setCurrentUser({ id: me.id, role: me.role }))
      .catch(() => {});
    api
      .get<Sucursal[]>('/branches')
      .then(setSucursales)
      .catch(() => {});
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setError(null);
    setAviso(null);
    setCreating(true);
    // Sin contraseña = se le manda una invitación por mail para que la fije él;
    // con contraseña = la cuenta queda lista y el owner le pasa la clave a mano.
    const invita = !password.trim();
    try {
      await api.post('/users', {
        name,
        email,
        // El backend crea la invitación cuando `password` viene ausente.
        password: invita ? undefined : password,
        role,
        // Vacío = sin sucursal, y eso significa que ve TODOS los locales.
        branchId: branchId || undefined,
      });
      const emailCreado = email;
      setName('');
      setEmail('');
      setPassword('');
      setBranchId('');
      await load();
      setAviso(
        invita
          ? `Le enviamos una invitación a ${emailCreado} para que elija su contraseña y entre.`
          : `Cuenta de ${emailCreado} creada y lista para entrar.`,
      );
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u: StaffUser) {
    setError(null);
    setEditingId(u.id);
    setEditName(u.name);
    setEditPhone(u.phone ?? '');
    setEditRole(u.role);
    setEditBranchId(u.branchId ?? '');
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
        // `null` explícito para quitarla: `undefined` sería "no tocar".
        branchId: editBranchId || null,
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

  // Reenviar invitación: rota el token (el link viejo muere) y extiende el
  // vencimiento — para "no me llegó el mail" o invitaciones vencidas (7 días).
  async function onResendInvite(u: StaffUser) {
    setError(null);
    setAviso(null);
    setResendingId(u.id);
    try {
      await api.post(`/users/${u.id}/resend-invite`);
      setAviso(`Invitación reenviada a ${u.email}. El enlace anterior dejó de servir.`);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setResendingId(null);
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

      <AyudaSeccion id="staff" titulo="Cada uno ve lo que necesita">
        <p>El <b>dueño</b> ve todos los locales. El <b>gerente</b>, el mozo, el cajero y la cocina quedan atados a la sucursal que les asignes.</p>
        <p>A quien dejes sin sucursal lo vas a ver marcado en amarillo: ese ve la caja y la facturación de todos tus locales.</p>
      </AyudaSeccion>

      <SettingsTabs />

      {/* autoComplete cortado: este NO es el login del dueño, es el alta de otra
          persona. Sin esto el navegador rellenaba el mail y la contraseña
          guardados del dueño (parecía que el sistema los ponía solo). El
          `new-password` es lo único que Chrome respeta de verdad para no
          autocompletar la clave. */}
      <form onSubmit={onCreate} className="mb-6 flex flex-wrap gap-2" autoComplete="off">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          required
          autoComplete="off"
          className="input w-full sm:w-44"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email del empleado"
          required
          autoComplete="off"
          className="input w-full sm:w-52"
        />
        {/* Contraseña OPCIONAL: en blanco = le llega una invitación al mail y él
            elige su clave (lo más cómodo y seguro). Con clave = queda lista al
            toque. `minLength` sólo actúa si escribís algo. */}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña (opcional)"
          minLength={8}
          autoComplete="new-password"
          className="input w-full sm:w-44"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input w-full sm:w-36" aria-label="Rol">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </select>
        {/* Sucursal: define QUÉ ve. Sin ella el empleado ve y opera sobre todos
            los locales, que es lo correcto sólo para el dueño. */}
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="input w-full sm:w-44"
          aria-label="Sucursal donde trabaja"
        >
          <option value="">Todas las sucursales</option>
          {sucursales.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={creating}>
          <UserPlus className="h-4 w-4" />
          {creating ? 'Creando...' : password.trim() ? 'Crear usuario' : 'Enviar invitación'}
        </button>
      </form>
      <p className="mb-4 -mt-3 text-xs text-muted-foreground">
        Dejá la contraseña en blanco y le llega una invitación por mail para que elija la suya. Si
        preferís, ponésela vos y pasásela a mano.
      </p>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {aviso && (
        <Alert tone="ok" className="mb-4">
          {aviso}
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
                  <Badge tone="info">{ROLE_LABEL[u.role] ?? u.role}</Badge>
                  {/* Dónde trabaja. El dueño maneja todos los locales por
                      definición; para el resto, "Todas las sucursales" es un
                      aviso, no un dato: significa que ve la facturación y la
                      caja de locales donde no trabaja. */}
                  {u.role !== 'OWNER' &&
                    (u.branchId ? (
                      <Badge tone="neutral">{nombreSucursal(u.branchId) ?? 'Sucursal'}</Badge>
                    ) : (
                      <Badge tone="warn">Todas las sucursales</Badge>
                    ))}
                  {/* Invitado que todavía no fijó su clave: no puede entrar aún.
                      Se muestra en vez del estado activo/inactivo para que quede
                      claro que la cuenta está a medias, esperando al empleado. */}
                  {u.invitePending ? (
                    <>
                      <Badge tone="warn" dot>
                        Invitación pendiente
                      </Badge>
                      <button
                        type="button"
                        onClick={() => onResendInvite(u)}
                        disabled={resendingId === u.id}
                        className="btn btn-sm"
                        title="Rota el enlace: el anterior deja de servir"
                      >
                        <MailPlus className="h-4 w-4" />
                        {resendingId === u.id ? 'Enviando...' : 'Reenviar invitación'}
                      </button>
                    </>
                  ) : (
                    <Badge tone={u.active ? 'ok' : 'error'} dot>
                      {u.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  )}
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
                            {ROLE_LABEL[r] ?? r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="input flex w-full items-center text-muted-foreground sm:w-36">{ROLE_LABEL[u.role] ?? u.role}</span>
                    )}
                    <select
                      value={editBranchId}
                      onChange={(e) => setEditBranchId(e.target.value)}
                      className="input w-full sm:w-44"
                      aria-label="Sucursal donde trabaja"
                    >
                      <option value="">Todas las sucursales</option>
                      {sucursales.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
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
