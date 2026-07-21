'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, MapPin, Store as StoreIcon } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { brandTokens, isValidHexColor } from '@chillberry/domain';
import { Badge, EmptyState, Skeleton } from '@/components/ui';

type StoreBranch = {
  slug: string;
  name: string;
  address: string;
  coverImageUrl: string | null;
  canOrder: boolean;
  isOpenNow: boolean;
};

type Store = {
  tenantName: string;
  logoUrl: string | null;
  brandColor: string | null;
  branches: StoreBranch[];
};

/**
 * "Storefront" de un restaurante servido por su subdominio
 * (`<sub>.chillberry.io`). El middleware reescribe la raíz del subdominio a esta
 * ruta. Muestra las sucursales publicadas: si hay una sola redirige directo a su
 * carta `/r/:slug`; si hay varias, un selector. Cada sucursal linkea a su carta,
 * donde vive el pedido de delivery/retiro.
 */
export default function StorefrontPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = use(params);
  const router = useRouter();
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Store>(`/public/menu/store/${sub}`, { publicEndpoint: true })
      .then(setStore)
      .catch((err) => setError((err as ApiError).message));
  }, [sub]);

  // Una sola sucursal publicada: no tiene sentido un selector de un ítem, va
  // directo a su carta. `replace` para que "atrás" no vuelva a este limbo.
  const only = store && store.branches.length === 1 ? store.branches[0] : null;
  useEffect(() => {
    if (only) router.replace(`/r/${only.slug}`);
  }, [only, router]);

  const brandStyle = useMemo(() => {
    if (!store?.brandColor || !isValidHexColor(store.brandColor)) return undefined;
    const t = brandTokens(store.brandColor);
    return {
      '--primary': t.primary,
      '--primary-foreground': t.primaryForeground,
    } as React.CSSProperties;
  }, [store]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <EmptyState
          icon={StoreIcon}
          title="No encontramos este restaurante"
          description="Revisá el enlace — puede que haya cambiado o que todavía no esté publicado."
        />
      </main>
    );
  }

  if (!store || only) {
    return (
      <main className="min-h-screen bg-background p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-16" style={brandStyle}>
      <header className="brand-gradient px-4 py-10 text-center text-primary-foreground">
        {store.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={store.logoUrl}
            alt={store.tenantName}
            className="mx-auto mb-3 h-16 w-16 rounded-full object-cover ring-2 ring-white/40"
          />
        ) : (
          <StoreIcon className="mx-auto mb-3 h-12 w-12" />
        )}
        <h1 className="font-heading text-2xl font-semibold">{store.tenantName}</h1>
        <p className="mt-1 text-sm opacity-90">Elegí la sucursal para hacer tu pedido</p>
      </header>

      <div className="mx-auto -mt-6 max-w-2xl space-y-3 px-4">
        {store.branches.map((b) => (
          <Link
            key={b.slug}
            href={`/r/${b.slug}`}
            className="card flex items-center justify-between gap-3 p-4 transition-colors hover:border-primary"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-heading font-semibold text-foreground">{b.name}</span>
                <Badge tone={b.isOpenNow ? 'ok' : 'error'} dot>
                  {b.isOpenNow ? 'Abierto' : 'Cerrado'}
                </Badge>
              </div>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{b.address}</span>
              </p>
              {!b.canOrder && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  Solo para ver la carta
                </p>
              )}
            </div>
            <span className="btn btn-primary btn-sm shrink-0">Ver carta</span>
          </Link>
        ))}

        {store.branches.length === 0 && (
          <EmptyState
            icon={StoreIcon}
            title="Todavía no hay sucursales publicadas"
            description="Este restaurante aún no habilitó ninguna sucursal para pedidos online."
          />
        )}
      </div>
    </main>
  );
}
