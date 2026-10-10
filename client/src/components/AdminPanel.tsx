import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, KeyRound, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react';
import { getFunctionErrorMessage, getUserFacingError } from '../lib/errors';
import { formatIndiaDateTime } from '../lib/dates';
import { requireSupabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

type AdminTab = 'overview' | 'users' | 'posts' | 'polls' | 'crushes' | 'comments' | 'media' | 'reports' | 'invitations' | 'audit';
type AdminRow = Record<string, unknown>;
type AdminResult = { rows?: AdminRow[]; overview?: Record<string, number>; invitation?: { code: string; id: string }; total?: number; pageSize?: number; error?: string; warning?: string };

interface AdminPanelProps {
  onClose: () => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'users', label: 'Accounts' }, { id: 'posts', label: 'Posts' },
  { id: 'polls', label: 'Polls' }, { id: 'crushes', label: 'Spotted' },
  { id: 'comments', label: 'Comments' }, { id: 'media', label: 'Images' }, { id: 'reports', label: 'Reports' },
  { id: 'invitations', label: 'Invitations' }, { id: 'audit', label: 'Audit log' },
];

export function AdminPanel({ onClose, onToast }: AdminPanelProps) {
  const { session } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [overview, setOverview] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<{ id: string; username: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const refreshSequence = useRef(0);
  const loadingRef = useRef(true);
  const pendingRealtimeRefresh = useRef(false);
  const refreshRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const realtimeTimer = useRef<number | null>(null);

  const invoke = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await requireSupabase().functions.invoke<AdminResult>('admin', { body: { action, ...args } });
    if (error) throw new Error(await getFunctionErrorMessage(error, 'The admin request could not be completed. Please try again.'));
    if (data?.error) throw new Error(getUserFacingError(data.error, 'The admin request could not be completed. Please try again.'));
    return data ?? {};
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (silent && loadingRef.current) { pendingRealtimeRefresh.current = true; return; }
    const sequence = ++refreshSequence.current;
    if (!silent) { loadingRef.current = true; setLoading(true); }
    try {
      const data = await invoke(tab, { page, ...(tab === 'users' ? { search: userSearch } : {}) });
      if (sequence !== refreshSequence.current) return;
      setRows(data.rows ?? []);
      setTotalRows(data.total ?? data.rows?.length ?? 0);
      setPageSize(data.pageSize ?? 100);
      if (data.overview) setOverview(data.overview);
    } catch (cause) {
      if (sequence === refreshSequence.current && !silent) onToast(getUserFacingError(cause, 'The admin view could not load. Please try again.'), 'error');
    } finally {
      if (sequence === refreshSequence.current && !silent) { loadingRef.current = false; setLoading(false); }
      if (sequence === refreshSequence.current && pendingRealtimeRefresh.current) {
        pendingRealtimeRefresh.current = false;
        if (realtimeTimer.current !== null) window.clearTimeout(realtimeTimer.current);
        realtimeTimer.current = window.setTimeout(() => {
          realtimeTimer.current = null;
          void refreshRef.current(true);
        }, 0);
      }
    }
  }, [invoke, onToast, page, tab, userSearch]);
  refreshRef.current = refresh;
  useEffect(() => { void refresh(); }, [refresh]);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeTimer.current !== null) window.clearTimeout(realtimeTimer.current);
    realtimeTimer.current = window.setTimeout(() => {
      realtimeTimer.current = null;
      void refreshRef.current(true);
    }, 200);
  }, []);
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    setLiveConnected(false);
    let active = true;
    const client = requireSupabase();
    const channel = client.channel(`admin:${userId}`, { config: { private: true } });
    channel.on('broadcast', { event: 'admin:refresh' }, scheduleRealtimeRefresh)
      .on('broadcast', { event: 'admin:action' }, scheduleRealtimeRefresh)
      .subscribe((status) => {
        if (!active) return;
        if (status === 'SUBSCRIBED') { setLiveConnected(true); scheduleRealtimeRefresh(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveConnected(false);
      });
    const fallback = window.setInterval(() => { if (active) void refreshRef.current(true); }, 30_000);
    return () => {
      active = false;
      window.clearInterval(fallback);
      if (realtimeTimer.current !== null) window.clearTimeout(realtimeTimer.current);
      realtimeTimer.current = null;
      void client.removeChannel(channel);
    };
  }, [scheduleRealtimeRefresh, session?.user.id]);

  const mutate = async (id: string, action: string, args: Record<string, unknown> = {}) => {
    setBusyId(id);
    try { await invoke(action, { id, reason: reason.trim(), ...args }); onToast('Admin action completed.', 'success'); await refresh(); }
    catch (cause) { onToast(getUserFacingError(cause, 'The admin action could not be completed. Please try again.'), 'error'); }
    finally { setBusyId(null); }
  };

  const createInvite = async () => {
    setBusyId('new-invite');
    try { const data = await invoke('create-invitation'); setInvite(data.invitation?.code ?? null); onToast('Invitation created. Copy the code now; it is only shown once.', 'success'); }
    catch (cause) { onToast(getUserFacingError(cause, 'Could not create an invitation. Please try again.'), 'error'); }
    finally { setBusyId(null); }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordTarget) return;
    if (newPassword.length < 10 || newPassword.length > 128) {
      setPasswordError('Password must be between 10 and 128 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match. Re-enter the same password in both fields.');
      return;
    }
    setBusyId(passwordTarget.id);
    setPasswordError('');
    try {
      const data = await invoke('set-user-password', {
        id: passwordTarget.id,
        password: newPassword,
        confirmPassword,
        reason: reason.trim(),
      });
      setPasswordTarget(null);
      setNewPassword('');
      setConfirmPassword('');
      onToast(data.warning ?? `Password changed for ${passwordTarget.username}. Share the new password with them privately.`, data.warning ? 'error' : 'success');
      await refresh(true);
    } catch (cause) {
      setPasswordError(getUserFacingError(cause, 'Could not change this account password. Please try again.'));
    } finally { setBusyId(null); }
  };

  const handleItemAction = (row: AdminRow, action: string, args?: Record<string, unknown>) => {
    if (action === 'open-password-reset') {
      setPasswordTarget({ id: String(row.id ?? ''), username: String(row.username ?? 'campus account') });
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
      return;
    }
    if (action === 'hide-report-content') {
      const targetType = String(row.target_type ?? '');
      if (targetType === 'post' && typeof row.post_public_id === 'string') void mutate(row.post_public_id, 'moderate-post', { postAction: 'hide' });
      else if (targetType === 'comment' && typeof row.comment_public_id === 'string') void mutate(row.comment_public_id, 'moderate-comment');
      else if (targetType === 'poll' && typeof row.poll_public_id === 'string') void mutate(row.poll_public_id, 'moderate-poll', { pollAction: 'hide' });
      else if (targetType === 'crush' && typeof row.crush_public_id === 'string') void mutate(row.crush_public_id, 'moderate-crush', { crushAction: 'hide' });
      else onToast('This report does not point to content that can be hidden.', 'error');
      return;
    }
    void mutate(String(row.id ?? ''), action, args);
  };

  return (
    <div className="modal active z-[100]" role="presentation">
      <button type="button" className="modal-bg" aria-label="Close admin tools" onClick={onClose} />
      <section className="modal-card card z-[1] w-full max-w-6xl rounded-t-[28px] p-4 sm:rounded-[28px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="admin-heading">
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><ShieldCheck size={21} /></span><div><p className="text-[11px] font-bold tracking-[.2em] text-unseen-600">PRIVATE MODERATION</p><h2 id="admin-heading" className="font-grotesk text-2xl font-bold">Campus admin</h2></div></div><div className="flex gap-2"><button type="button" onClick={() => void refresh()} disabled={loading} className="chip flex h-10 w-10 items-center justify-center rounded-full" aria-label="Refresh"><RefreshCw size={16} /></button><button type="button" onClick={onClose} className="chip flex h-10 w-10 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></div></div>
        <nav className="scrollbar-hide mt-5 flex gap-2 overflow-x-auto border-b border-soft pb-3" aria-label="Admin sections">{tabs.map((item) => <button key={item.id} type="button" onClick={() => { setTab(item.id); setPage(0); }} className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold ${tab === item.id ? 'bg-purple-700 text-white' : 'chip'}`}>{item.label}</button>)}</nav>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted">Actions are checked against your active administrator account and recorded.</p><span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${liveConnected ? 'text-emerald-700' : 'text-amber-700'}`}><span className={`h-2 w-2 rounded-full ${liveConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />{liveConnected ? 'Live updates on' : 'Reconnecting · automatic refresh on'}</span>{tab === 'invitations' && <button type="button" onClick={() => void createInvite()} disabled={busyId !== null} className="btn-primary rounded-full px-4 py-2 text-xs font-bold">+ New invitation</button>}</div>
        {invite && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div><p className="text-[10px] font-bold tracking-wider text-emerald-800">NEW INVITATION · COPY IT NOW</p><code className="mt-1 block select-all text-sm font-bold text-emerald-950">{invite}</code></div><button type="button" onClick={() => { void navigator.clipboard.writeText(invite); onToast('Invitation code copied.', 'success'); }} className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white">Copy code</button></div>}
        <label className="mt-4 block text-xs font-semibold text-muted">Action note (optional)<input value={reason} onChange={(event) => setReason(event.target.value.slice(0, 500))} className="input-themed mt-1.5 w-full rounded-xl px-3 py-2.5" placeholder="Add a short moderator note" /></label>
        {tab === 'users' && <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="min-w-56 flex-1 text-xs font-semibold text-muted">Find any account<input value={userSearch} onChange={(event) => { setUserSearch(event.target.value.slice(0, 20)); setPage(0); }} className="input-themed mt-1.5 w-full rounded-xl px-3 py-2.5" placeholder="Search username" /></label><span className="text-xs text-muted">{totalRows.toLocaleString()} accounts</span></div>}
        <div className="mt-4 max-h-[54vh] min-h-56 overflow-y-auto rounded-2xl border border-soft bg-card" aria-busy={loading}>
          {loading ? <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted"><LoaderCircle size={18} className="animate-spin" /> Loading private admin data…</div> : tab === 'overview' ? <Overview values={overview} /> : !rows.length ? <div className="p-8 text-center text-sm text-muted">Nothing in this section right now.</div> : tab === 'media' ? <MediaGrid rows={rows} busyId={busyId} onRemove={(id) => void mutate(id, 'remove-media')} /> : <div className="divide-y divide-[var(--border)]">{rows.map((row, index) => <AdminItem key={String(row.id ?? row.code_digest ?? index)} row={row} tab={tab} busy={busyId === String(row.id ?? '')} onAction={(action, args) => handleItemAction(row, action, args)} />)}</div>}
        </div>
        {tab !== 'overview' && <div className="mt-3 flex items-center justify-between gap-3 text-xs"><button type="button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} className="chip rounded-full px-4 py-2 font-bold">Previous</button><span className="text-muted">Page {page + 1} of {Math.max(1, Math.ceil(totalRows / pageSize))} · {totalRows.toLocaleString()} records</span><button type="button" disabled={(page + 1) * pageSize >= totalRows || loading} onClick={() => setPage((current) => current + 1)} className="chip rounded-full px-4 py-2 font-bold">Next</button></div>}
      </section>
      {passwordTarget && <div className="modal active z-[110]" role="presentation"><button type="button" className="modal-bg" aria-label="Close password reset" onClick={() => { if (busyId !== passwordTarget.id) setPasswordTarget(null); }} /><section className="modal-card card z-[1] w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="admin-password-heading"><h3 id="admin-password-heading" className="font-grotesk text-xl font-bold">Change account password</h3><p className="mt-1 text-sm text-muted">Set a new password for <b>{passwordTarget.username}</b>. It will only be shown here while you enter it; share it with the user privately.</p><form onSubmit={(event) => void resetPassword(event)} className="mt-4 space-y-3"><label className="block text-xs font-bold">New password<input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordError(''); }} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3" /></label><label className="block text-xs font-bold">Confirm new password<input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordError(''); }} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3" /></label>{passwordError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-800">{passwordError}</p>}<div className="flex gap-2"><button type="button" disabled={busyId === passwordTarget.id} onClick={() => setPasswordTarget(null)} className="chip flex-1 rounded-full px-4 py-3 text-sm font-bold">Cancel</button><button type="submit" disabled={busyId === passwordTarget.id} className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold">{busyId === passwordTarget.id && <LoaderCircle size={15} className="animate-spin" />}Set new password</button></div></form></section></div>}
    </div>
  );
}

function MediaGrid({ rows, busyId, onRemove }: { rows: AdminRow[]; busyId: string | null; onRemove: (id: string) => void }) {
  return <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((row) => {
    const id = String(row.id ?? '');
    return <article key={id} className="overflow-hidden rounded-2xl border border-soft bg-card">
      {typeof row.signed_url === 'string' ? <img src={row.signed_url} alt="Campus post submitted for moderation" loading="lazy" className="aspect-[4/3] w-full bg-soft object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center bg-soft text-sm text-muted">Image unavailable</div>}
      <div className="p-3"><p className="truncate text-xs font-bold">{String(row.author_name ?? 'Anonymous Ghost')}</p><p className="mt-1 text-[11px] text-muted">{typeof row.created_at === 'string' ? formatIndiaDateTime(row.created_at) : 'Date unavailable'} · {typeof row.file_size_bytes === 'number' ? `${(row.file_size_bytes / 1024).toFixed(0)} KB` : 'Size unavailable'}</p>
        <button type="button" disabled={busyId === id} onClick={() => { if (window.confirm('Permanently remove this image from the post and campus storage?')) onRemove(id); }} className="chip mt-3 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-rose-700"><Trash2 size={14} /> Remove image</button>
      </div>
    </article>;
  })}</div>;
}

function Overview({ values }: { values: Record<string, number> }) {
  const cards = [['Active accounts', 'activeAccounts'], ['Posts in feed', 'posts'], ['Live polls', 'polls'], ['Spotted posts', 'crushes'], ['Open reports', 'openReports'], ['Images', 'media']];
  return <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, key]) => <div key={key} className="rounded-2xl border border-soft bg-soft p-4"><p className="text-xs font-bold tracking-wider text-muted">{label}</p><p className="mt-1 font-grotesk text-3xl font-bold">{(values[key] ?? 0).toLocaleString()}</p></div>)}</div>;
}

function AdminItem({ row, tab, busy, onAction }: { row: AdminRow; tab: AdminTab; busy: boolean; onAction: (action: string, args?: Record<string, unknown>) => void }) {
  const title = tab === 'reports'
    ? `${String(row.target_type ?? 'Content')} report · ${String(row.reason ?? 'Needs review')}`
    : String(row.username ?? row.author_name ?? row.question ?? row.recipient ?? row.reason ?? row.action ?? row.target_id ?? row.id ?? 'Campus record');
  const description = String(row.content_preview ?? row.reported_content ?? row.body ?? row.message ?? row.question ?? row.detail ?? row.reason ?? row.target_type ?? row.display_name ?? '');
  const status = String(row.status ?? row.moderation_status ?? '');
  const stamp = typeof row.created_at === 'string' ? formatIndiaDateTime(row.created_at) : '';
  return <article className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all text-sm font-bold">{title}</h3>{status && <span className="rounded-full bg-soft px-2 py-1 text-[10px] font-bold uppercase text-muted">{status}</span>}</div>{description && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted">{description}</p>}<div className="mt-1 flex flex-wrap gap-2 text-[10px] text-faint">{typeof row.category === 'string' && <span>{row.category}</span>}{typeof row.target_type === 'string' && <span>{row.target_type}</span>}{typeof row.reporter === 'string' && <span>Reporter: {row.reporter}</span>}{typeof row.reported === 'string' && <span>Reported: {row.reported}</span>}{stamp && <time>{stamp}</time>}</div></div>
    {tab !== 'audit' && <div className="flex shrink-0 flex-wrap gap-2">{tab === 'users' && <><button type="button" disabled={busy} title="Restore account" onClick={() => onAction('set-user-status', { status: 'ACTIVE' })} className="chip flex h-9 w-9 items-center justify-center rounded-full"><Check size={15} /></button><button type="button" disabled={busy} title="Suspend account" onClick={() => { if (window.confirm(`Suspend ${title}? They will not be able to use member features until restored.`)) onAction('set-user-status', { status: 'SUSPENDED' }); }} className="chip flex h-9 w-9 items-center justify-center rounded-full"><ShieldAlert size={15} /></button><button type="button" disabled={busy} title="Ban account" onClick={() => { if (window.confirm(`Ban ${title}? Their account will lose access until restored.`)) onAction('set-user-status', { status: 'BANNED' }); }} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700"><Ban size={15} /></button><button type="button" disabled={busy || row.role === 'ADMIN'} title={row.role === 'ADMIN' ? 'Admin passwords cannot be reset here' : 'Set a new password'} onClick={() => onAction('open-password-reset')} className="chip flex h-9 w-9 items-center justify-center rounded-full text-unseen-700"><KeyRound size={15} /><span className="sr-only">Change password</span></button><button type="button" disabled={busy} onClick={() => onAction('set-user-role', { role: row.role === 'ADMIN' ? 'USER' : 'ADMIN' })} className="chip rounded-full px-3 py-2 text-xs font-bold">{row.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}</button><button type="button" disabled={busy} onClick={() => { if (window.prompt('Type DELETE USER to permanently remove this account and its data.') === 'DELETE USER') onAction('delete-user', { confirmation: 'DELETE USER' }); }} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Permanently delete account"><Trash2 size={15} /></button></>}
      {tab === 'posts' && <><button type="button" disabled={busy} onClick={() => onAction('moderate-post', { postAction: 'hide' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Hide</button><button type="button" disabled={busy} onClick={() => onAction('moderate-post', { postAction: 'restore' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Restore</button><button type="button" disabled={busy} onClick={() => onAction('moderate-post', { postAction: 'delete' })} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Remove post"><Trash2 size={15} /></button></>}
      {(tab === 'polls' || tab === 'crushes') && <><button type="button" disabled={busy} onClick={() => onAction(tab === 'polls' ? 'moderate-poll' : 'moderate-crush', tab === 'polls' ? { pollAction: 'hide' } : { crushAction: 'hide' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Hide</button><button type="button" disabled={busy} onClick={() => onAction(tab === 'polls' ? 'moderate-poll' : 'moderate-crush', tab === 'polls' ? { pollAction: 'restore' } : { crushAction: 'restore' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Restore</button><button type="button" disabled={busy} onClick={() => onAction(tab === 'polls' ? 'moderate-poll' : 'moderate-crush', tab === 'polls' ? { pollAction: 'delete' } : { crushAction: 'delete' })} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Remove content"><Trash2 size={15} /></button></>}
      {tab === 'reports' && <>{['post', 'comment', 'poll', 'crush'].includes(String(row.target_type)) && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Hide this ${String(row.target_type)} from the campus feed?`)) onAction('hide-report-content'); }} className="chip rounded-full px-3 py-2 text-xs font-bold">Hide content</button>}<button type="button" disabled={busy} onClick={() => onAction('resolve-report', { status: 'resolved' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Resolve</button><button type="button" disabled={busy} onClick={() => onAction('resolve-report', { status: 'dismissed' })} className="chip rounded-full px-3 py-2 text-xs font-bold">Dismiss</button></>}
      {tab === 'comments' && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Remove this comment from the campus feed?')) onAction('moderate-comment'); }} className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700" title="Remove comment"><Trash2 size={15} /></button>}
      {tab === 'invitations' && row.status === 'UNUSED' && <button type="button" disabled={busy} onClick={() => onAction('revoke-invitation')} className="chip rounded-full px-3 py-2 text-xs font-bold">Revoke</button>}
      {busy && <LoaderCircle size={16} className="animate-spin self-center text-unseen-600" />}</div>}
  </article>;
}
