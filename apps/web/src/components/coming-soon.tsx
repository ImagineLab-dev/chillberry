'use client';

import { useRouter } from 'next/navigation';
import { logout } from '@/lib/auth';

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  const router = useRouter();

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-4 text-center text-foreground">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Este módulo se construye en {phase}.</p>
      <button onClick={onLogout} className="btn mt-4">
        Cerrar sesión
      </button>
    </main>
  );
}
