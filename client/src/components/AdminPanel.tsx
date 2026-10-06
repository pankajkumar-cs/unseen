import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, LoaderCircle, RefreshCw, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { requireSupabase } from '../lib/supabase';

type AdminTab = 'overview' | 'users' | 'posts' | 'comments' | 'media' | 'reports' | 'chat-reports' | 'invitations' | 'audit';
type AdminRow = Record<string, unknown>;
type AdminResult = { rows?: AdminRow[]; overview?: Record<string, number>; invitation?: { code: string; id: string }; error?: string };

interface AdminPanelProps {
  onClose: () => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'users', label: 'Accounts' }, { id: 'posts', label: 'Posts' },
  { id: 'comments', label: 'Comments' }, { id: 'media', label: 'Images' }, { id: 'reports', label: 'Reports' }, { id: 'chat-reports', label: 'Chat reports' },
  { id: 'invitations', label: 'Invitations' }, { id: 'audit', label: 'Audit log' },
];

export function AdminPanel({ onClose, onToast }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [overview, setOverview] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const invoke = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await requireSupabase().functions.invoke<AdminResult>('admin', { body: { action, ...args } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data ?? {};
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke(tab);
      setRows(data.rows ?? []);
      setOverview(data.overview ?? {});
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'The admin view could not load.', 'error'); }
    finally { setLoading(false); }
  }, [invoke, onToast, tab]);
  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = async (id: string, action: string, args: Record<string, unknown> = {}) => {
    setBusyId(id);
    try { await invoke(action, { id, reason: reason.trim(), ...args }); onToast('Admin action completed.', 'success'); await refresh(); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : 'The admin action could not be completed.', 'error'); }
    finally { setBusyId(null); }
  };

  const createInvite = async () => {
    setBusyId('new-invite');
    try { const data = await invoke('create-invitation'); setInvite(data.invitation?.code ?? null); onToast('Invitation created. Copy the code now; it is only shown once.', 'success'); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : 'Could not create an invitation.', 'error'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="modal active z-[100]" role="presentation">
      <button type="button" className="modal-bg" aria-label="Close admin tools" onClick={onClose} />
      <section className="modal-card card z-[1] w-full max-w-6xl rounded-t-[28px] p-4 sm:rounded-[28px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="admin-heading">
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><ShieldCheck size={21} /></span><div><p className="text-[11px] font-bold tracking-[.2em] text-unseen-600">PRIVATE MODERATION</p><h2 id="admin-heading" className="font-grotesk text-2xl font-bold">Campus admin</h2></div></div><div className="flex gap-2"><button type="button" onClick={() => void refresh()} disabled={loading} className="chip flex h-10 w-10 items-center justify-center rounded-full" aria-label="Refresh"><RefreshCw size={16} /></button><button type="button" onClick={onClose} className="chip flex h-10 w-10 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></div></div>
        <nav className="scrollbar-hide mt-5 flex gap-2 overflow-x-auto border-b border-soft pb-3" aria-label="Admin sections">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold ${tab === item.id ? 'bg-purple-700 text-white' : 'chip'}`}>{item.label}</button>)}</nav>
        <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-muted">Actions are checked against your active administrator account and recorded.</p>{tab === 'invitations' && <button type="button" onClick={() => void createInvite()} disabled={busyId !== null} className="btn-primary rounded-full px-4 py-2 text-xs font-bold">+ New invitation</button>}</div>
        {invite && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div><p className="text-[10px] font-bold tracking-wider text-emerald-800">NEW INVITATION · COPY IT NOW</p><code className="mt-1 block select-all text-sm font-bold text-emerald-950">{invite}</code></div><button type="button" onClick={() => { void navigator.clipboard.writeText(invite); onToast('Invitation code copied.', 'success'); }} className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white">Copy code</button></div>}
        <label className="mt-4 block text-xs font-semibold text-muted">Action note (optional)<input value={reason} onChange={(event) => setReason(event.target.value.slice(0, 500))} className="input-themed mt-1.5 w-full rounded-xl px-3 py-2.5" placeholder="Add a short moderator note" /></label>
        <div className="mt-4 max-h-[54vh] min-h-56 overflow-y-auto rounded-2xl border border-soft bg-card" aria-busy={loading}>
          {loading ? <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted"><LoaderCircle size={18} className="animate-spin" /> Loading private admin data…</div> : tab === 'overview' ? <Overview values={overview} /> : !rows.length ? <div className="p-8 text-center text-sm text-muted">Nothing in this section right now.</div> : tab === 'media' ? <MediaGrid rows={rows} busyId={busyId} onRemove={(id) => void mutate(id, 'remove-media')} /> : <div className="divide-y divide-[var(--border)]">{rows.map((row, index) => <AdminItem key={String(row.id ?? row.code_digest ?? index)} row={row} tab={tab} busy={busyId === String(row.id ?? '')} onAction={(action, args) => void mutate(String(row.id ?? ''), action, args)} />)}</div>}
        </div>
      </section>
    </div>
  );
}

function MediaGrid({ rows, busyId, onRemove }: { rows: AdminRow[]; busyId: string | null; onRemove: (id: string) => void }) {
  return <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((row) => {
    const id = String(row.id ?? '');
    return <article key={id} className="overflow-hidden rounded-2xl border border-soft bg-card">
      {typeof row.signed_url === 'string' ? <img src={row.signed_url} alt="Campus post submitted for moderation" loading="lazy" className="aspect-[4/3] w-full bg-soft object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-soft text-sm text-muted">Image unavailable</div>}
      <div className="p-3"><p className="truncate text-xs font-bold">{String(row.author_name ?? 'Anonymous Ghost')}</p><p className="mt-1 text-[11px] text-muted">{typeof row.created_at === 'string' ? new Date(row.created_at).toLocaleString() : 'Date unavailable'} · {typeof row.file_size_bytes === 'number' ? `${(row.file_size_bytes / 1024).toFixed(0)} KB` : 'Size unavailable'}</p>
        <button type="button" disabled={busyId === id} onClick={() => { if (window.confirm('Permanently remove this image from the post and campus storage?')) onRemove(id); }} className="chip mt-3 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-rose-700"><Trash2 size={14} /> Remove image</button>
      </div>
    </article>;
  })}</div>;
}

function Overview({ values }: { values: Record<string, number> }) {
  const cards = [['Active accounts', 'activeAccounts'], ['Posts in feed', 'posts'], ['Open reports', 'openReports'], ['Images', 'media'], ['Active chats', 'activeChats'], ['Queue', 'waiting']];
  return <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, key]) => <div key={key} className="rounded-2xl border border-soft bg-soft p-4"><p className="text-xs font-bold tracking-wider text-muted">{label}</p><p className="mt-1 font-grotesk text-3xl font-bold">{(values[key] ?? 0).toLocaleString()}</p></div>)}</div>;
}

function AdminItem({ row, tab, busy, onAction }: { row: AdminRow; tab: AdminTab; busy: boolean; onAction: (action: string, args?: Record<string, unknown>) => void }) {
  const title = String(row.username ?? row.author_name ?? row.question ?? row.reason ?? row.action ?? row.target_id ?? row.id ?? 'Campus record');
  const description = String(row.body ?? row.detail ?? row.reason ?? row.target_type ?? row.display_name ?? '');
  const status = String(row.status ?? row.moderation_status ?? '');
  const stamp = typeof row.created_at === 'string' ? new Date(row.created_at).toLocaleString() : '';
  return <article className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all text-sm font-bold">{title}</h3>{status && <span className="rounded-full bg-soft px-2 py-1 text-[10px] font-bold uppercase text-muted">{status}</span>}</div>{description && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted">{description}</p>}<div className="mt-1 flex flex-wrap gap-2 text-[10px] text-faint">{typeof row.category === 'string' && <span>{row.category}</span>}{typeof row.target_type === 'string' && <span>{row.target_type}</span>}{typeof row.reporter === 'string' && <span>Reporter: {row.reporter}</span>}{typeof row.reported === 'string' && <span>Reported: {row.reported}</span>}{stamp && <time>{stamp}</time>}</div></div>
    {tab === 'chat-reports' && Array.isArray(row.messages) && <details className="min-w-0 basis-full rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-xs"><summary className="cursor-pointer font-bold text-rose-800">Review reported conversation ({row.messages.length} messages)</summary><div className="mt-2 max-h-44 space-y-2 overflow-auto">{row.messages.map((message, index) => { const item = message as Record<string, unknown>; return <p key={index} className="rounded-lg bg-white/80 p-2"><b>{String(item.from ?? 'Anonymous Ghost')}:</b> {String(item.body ?? '')}</p>; })}</div></details>}
    {tab !== 'audit' && <div className="flex shrink-0 flex-wrap gap-2">{tab === 'users' && <><button type="button" disabled={busy} title="Restore account" onClick={() => onAction('set-user-status', { status: 'ACTIVE' })} className="chip flex h-9 w-9 items-center justify-center rounded-full"><Check size={15} /></button><button type="button" disabled={busy} title="Suspend account" onClick={() => onAction('set-user-status', { status: 'SUSPENDED' })} className="chip flex h-9 w-9 items-center justify-center rounded-full"><Ban size={15} /></button><button type="button" disabled={busy} title="Ban account" onClick={() => onAction('set-user-status', { status: 'BANNED' })} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700"><UserRound size={15} /></button><button type="button" disabled={busy} onClick={() => onAction('set-user-role', { role: row.role === 'ADMIN' ? 'USER' : 'ADMIN' })} className="chip rounded-full px-3 py-2 text-xs font-bold">{row.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}</button><button type="button" disabled={busy} onClick={() => { if (window.prompt('Type DELETE USER to permanently remove this account and its data.') === 'DELETE USER') onAction('delete-user', { confirmation: 'DELETE USER' }); }} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Permanently delete account"><Trash2 size={15} /></button></>}
      {tab === 'posts' && <><button type="button" disabled={busy} onClick={() => onAction('moderate-post', { postAction: 'hide' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Hide</button><button type="button" disabled={busy} onClick={() => onAction('moderate-post', { postAction: 'restore' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Restore</button><button type="button" disabled={busy} onClick={() => onAction('moderate-post', { postAction: 'delete' })} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Remove post"><Trash2 size={15} /></button></>}
      {tab === 'reports' && <><button type="button" disabled={busy} onClick={() => onAction('resolve-report', { status: 'resolved' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Resolve</button><button type="button" disabled={busy} onClick={() => onAction('resolve-report', { status: 'dismissed' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Dismiss</button></>}
      {tab === 'comments' && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remove this comment from the campus feed?')) onAction('moderate-comment'); }} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Remove comment"><Trash2 size={15} /></button>}
      {tab === 'chat-reports' && <><button type="button" disabled={busy} onClick={() => onAction('set-user-status', { id: row.reported_id, status: 'SUSPENDED' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Suspend account</button><button type="button" disabled={busy} onClick={() => onAction('resolve-chat-report', { status: 'REVIEWED' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Review</button><button type="button" disabled={busy} onClick={() => onAction('resolve-chat-report', { status: 'DISMISSED' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Dismiss</button></>}
      {tab === 'invitations' && row.status === 'UNUSED' && <button type="button" disabled={busy} onClick={() => onAction('revoke-invitation')} className="chip rounded-full px-3 py-2 text-xs font-bold">Revoke</button>}
      {busy && <LoaderCircle size={16} className="animate-spin self-center text-unseen-600" />}</div>}
  </article>;
}
