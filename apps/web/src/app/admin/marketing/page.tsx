'use client';

import { useEffect, useState } from 'react';
import { Download, Megaphone, Send, Users } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, PageHeader, Skeleton } from '@/components/ui';
import { CustomersTabs } from '@/components/customers-tabs';

const FALLBACK_COUNTRY_CODE = 'PY';

type SegmentKey = 'frequent' | 'inactive' | 'new';
type Segment = { key: SegmentKey; label: string; description: string; count: number };
type SegCustomer = { phone: string; name: string | null; orders: number; totalSpent: number; lastVisit: string | null };
type Campaign = { id: string; segment: string; message: string; recipientCount: number; sentAt: string };

const SEGMENT_LABEL: Record<string, string> = {
  frequent: 'Frecuentes',
  inactive: 'Inactivos',
  new: 'Nuevos',
};

/** Escapa un campo para CSV, con guarda contra inyección de fórmulas. */
function csvCell(value: string): string {
  let s = value ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function MarketingPage() {
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Segmento abierto (para ver clientes / mandar campaña).
  const [openKey, setOpenKey] = useState<SegmentKey | null>(null);
  const [openCustomers, setOpenCustomers] = useState<SegCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  function reload() {
    setLoading(true);
    Promise.all([api.get<Segment[]>('/marketing/segments'), api.get<Campaign[]>('/marketing/campaigns')])
      .then(([segs, camps]) => {
        setSegments(segs);
        setCampaigns(camps);
      })
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    api
      .get<{ countryCode: string }>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
  }, []);

  async function openSegment(key: SegmentKey) {
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    setMessage('');
    setCustomersLoading(true);
    try {
      setOpenCustomers(await api.get<SegCustomer[]>(`/marketing/segments/${key}/customers`));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setCustomersLoading(false);
    }
  }

  function exportCsv() {
    if (!openKey) return;
    const header = ['Nombre', 'Teléfono', 'Pedidos', 'Gasto total'];
    const rows = openCustomers.map((c) => [
      csvCell(c.name ?? ''),
      csvCell(c.phone),
      String(c.orders),
      String(c.totalSpent),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-${openKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onSend() {
    if (!openKey || message.trim().length < 3) return;
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const res = await api.post<{ sent: number }>('/marketing/campaigns', { segment: openKey, message: message.trim() });
      setNotice(`Campaña enviada a ${res.sent} cliente(s).`);
      setMessage('');
      reload();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Marketing"
        description="Segmentá tu base de clientes y mandales una campaña por WhatsApp o exportala."
      />
      <CustomersTabs />

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {notice && <Alert tone="ok" className="mb-4">{notice}</Alert>}

      <Alert tone="info" className="mb-6">
        El envío real por WhatsApp necesita una plantilla de marketing aprobada en Meta y la integración
        configurada. Sin eso, el mensaje queda registrado pero no se envía (modo sandbox). El export a CSV
        funciona siempre — podés usarlo para tu propia herramienta de envío.
      </Alert>

      {loading && <Skeleton className="h-40" />}

      {!loading && (
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => openSegment(s.key)}
              className={`card card-interactive p-5 text-left ${openKey === s.key ? 'ring-2 ring-primary' : ''}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {s.label}
                </span>
                <span className="tabular font-heading text-2xl font-semibold text-foreground">{s.count}</span>
              </div>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Panel del segmento abierto: clientes + export + campaña. */}
      {openKey && (
        <div className="panel mb-8 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold">
              {segments.find((s) => s.key === openKey)?.label} · {openCustomers.length} cliente(s)
            </h2>
            <button type="button" onClick={exportCsv} disabled={openCustomers.length === 0} className="btn btn-sm">
              <Download className="h-4 w-4" />
              Exportar CSV
            </button>
          </div>

          {customersLoading ? (
            <Skeleton className="h-24" />
          ) : openCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay clientes en este segmento todavía.</p>
          ) : (
            <>
              <div className="mb-5 max-h-64 overflow-auto">
                <table className="w-full min-w-[20rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Cliente</th>
                      <th className="pb-2 text-right font-medium">Pedidos</th>
                      <th className="pb-2 text-right font-medium">Gasto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openCustomers.map((c) => (
                      <tr key={c.phone} className="border-b border-border/60">
                        <td className="py-2">
                          <span className="font-medium">{c.name ?? 'Sin nombre'}</span>
                          <span className="block text-xs text-muted-foreground">{c.phone}</span>
                        </td>
                        <td className="tabular py-2 text-right">{c.orders}</td>
                        <td className="tabular py-2 text-right">{formatMoney(c.totalSpent, countryCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Campaña por WhatsApp al segmento. */}
              <div className="border-t border-border pt-4">
                <label className="label mb-1.5 block flex items-center gap-2" htmlFor="mkt-msg">
                  <Megaphone className="h-4 w-4 text-muted-foreground" />
                  Mensaje de la campaña
                </label>
                <textarea
                  id="mkt-msg"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ej: ¡Te extrañamos! Volvé esta semana y tenés 15% off con el código VUELVE."
                  maxLength={1000}
                  rows={3}
                  className="input mb-3 w-full resize-none"
                />
                <button
                  type="button"
                  onClick={onSend}
                  disabled={sending || message.trim().length < 3}
                  className="btn btn-primary"
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Enviando...' : `Enviar a ${openCustomers.length} cliente(s)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Historial de campañas. */}
      {campaigns.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold">Campañas enviadas</h2>
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li key={c.id} className="card p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge tone="neutral">{SEGMENT_LABEL[c.segment] ?? c.segment}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {c.recipientCount} destinatario(s) · {new Date(c.sentAt).toLocaleDateString('es-PY')}
                  </span>
                </div>
                <p className="text-muted-foreground">{c.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
