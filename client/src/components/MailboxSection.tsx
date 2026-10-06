import { useEffect, useState, type FormEvent } from 'react';
import { Inbox, LoaderCircle, MailPlus, Send, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { activeGhostProfiles, loadMailbox, openMailboxMessage, sendMailboxMessage, type MailboxView } from '../services/community';

interface MailboxSectionProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export function MailboxSection({ onOpenAuth, onToast }: MailboxSectionProps) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<MailboxView[]>([]);
  const [loading, setLoading] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const refresh = async () => {
    if (!profile?.isRegistered) return;
    setLoading(true);
    try { setMessages(await loadMailbox()); }
    catch (cause) { onToast(cause instanceof Error ? cause.message : 'Your mailbox could not load.', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [profile?.isRegistered]);

  const open = async (message: MailboxView) => {
    if (!message.sealed || message.sent || openingId) return;
    setOpeningId(message.id);
    try {
      const opened = await openMailboxMessage(message.id);
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, sealed: false, body: opened.body } : item));
      onToast('Envelope unsealed.', 'success');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'This envelope could not be opened.', 'error'); }
    finally { setOpeningId(null); }
  };

  const send = async (ghostId: string, body: string) => {
    try {
      await sendMailboxMessage(ghostId, body);
      await refresh();
      setComposerOpen(false);
      onToast('Your secret note was sent.', 'success');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Your note could not be sent.', 'error'); }
  };

  return (
    <section id="mailbox" className="mx-auto max-w-7xl px-4 pt-14 sm:px-6">
      <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="card relative flex flex-col justify-center overflow-hidden p-7 sm:p-9">
          <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle,#A78BFA,transparent)' }} />
          <div className="relative text-xs font-bold tracking-[.2em] text-unseen-600">✉️ SECRET MAILBOX</div>
          <h2 className="relative mt-2 font-grotesk text-3xl font-bold tracking-tight sm:text-4xl">Sealed envelopes.<br /><span className="grad-text">Zero identity.</span></h2>
          <p className="relative mt-3 text-sm font-medium leading-relaxed text-muted">Send an anonymous note to another campus ghost — a thank you, a kind word, or a secret admirer message. Notes expire after seven days.</p>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => profile?.isRegistered ? setComposerOpen(true) : onOpenAuth('login')} className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold"><MailPlus size={16} /> Send Secret DM</button>
            {profile?.isRegistered && <button type="button" onClick={() => void refresh()} className="chip rounded-full px-5 py-3 text-sm font-bold">Refresh inbox</button>}
          </div>
        </div>
        <div className="grid min-h-64 gap-4 sm:grid-cols-2" aria-live="polite" aria-busy={loading}>
          {!profile?.isRegistered && <div className="card flex flex-col items-center justify-center p-8 text-center sm:col-span-2"><Inbox size={30} className="text-unseen-500" /><h3 className="mt-3 font-grotesk font-bold">Your mailbox is waiting</h3><p className="mt-1 max-w-sm text-sm text-muted">Sign in with your anonymous campus account to receive or send sealed notes.</p></div>}
          {profile?.isRegistered && loading && <div className="card flex items-center justify-center p-8 sm:col-span-2"><LoaderCircle size={21} className="animate-spin text-unseen-600" aria-label="Loading mailbox" /></div>}
          {profile?.isRegistered && !loading && messages.length === 0 && <div className="card flex flex-col items-center justify-center p-8 text-center sm:col-span-2"><div className="text-5xl">✉️</div><h3 className="mt-3 font-grotesk font-bold">Your mailbox is empty</h3><p className="mt-1 text-sm text-muted">Secret messages will appear here when another ghost sends one.</p></div>}
          {profile?.isRegistered && !loading && messages.map((message) => <button key={message.id} type="button" onClick={() => void open(message)} disabled={openingId === message.id} className={`envelope card relative overflow-hidden p-0 text-left transition ${message.sealed ? 'cursor-pointer' : 'cursor-default'} ${message.sealed ? '' : 'opened'}`}>
            <div className="flex items-start gap-3 p-5 pb-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ background: message.color, animation: message.sealed ? 'envelopeBob 3s ease-in-out infinite' : undefined }}>{message.sealed ? '✉️' : message.emoji}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-[13px] font-bold">{message.sealed ? 'Sealed Envelope' : message.sent ? 'Sent note' : message.sender}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${message.sealed ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{message.sealed ? '🔒 SEALED' : 'OPENED'}</span></span><time dateTime={message.createdAt} className="mt-0.5 block text-[11px] font-bold text-faint">{new Date(message.createdAt).toLocaleString()}</time></span></div>
            <span className={`mx-5 mb-5 block rounded-2xl border border-dashed border-soft2 bg-soft p-3.5 text-[13px] font-medium ${message.sealed ? 'blur-[3px] select-none' : ''}`}>{message.sealed ? `${message.preview} 🔒 Tap to unseal…` : message.body}</span>
            {message.sealed && <span className="-mt-2 block px-5 pb-4 text-[11px] font-bold text-unseen-600">Tap to unseal →</span>}
            {openingId === message.id && <span className="absolute inset-0 flex items-center justify-center bg-white/70"><LoaderCircle size={20} className="animate-spin text-unseen-600" /></span>}
          </button>)}
        </div>
      </div>
      {composerOpen && <MailboxComposer onClose={() => setComposerOpen(false)} onSend={send} />}
    </section>
  );
}

function MailboxComposer({ onClose, onSend }: { onClose: () => void; onSend: (ghostId: string, body: string) => Promise<void> }) {
  const [recipients, setRecipients] = useState<Array<{ ghost_id: string; display_name: string; emoji: string }>>([]);
  const [recipient, setRecipient] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void activeGhostProfiles().then((rows) => setRecipients(rows.filter((row) => row.ghost_id).map((row) => ({ ghost_id: row.ghost_id, display_name: row.display_name, emoji: row.emoji })))).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Campus ghosts could not load.')).finally(() => setLoading(false));
  }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recipient || !body.trim()) return;
    setBusy(true);
    void onSend(recipient, body.trim()).finally(() => setBusy(false));
  };
  return (
    <div className="modal active z-[90]" role="presentation">
      <button type="button" className="modal-bg" onClick={() => { if (!busy) onClose(); }} aria-label="Close message composer" />
      <section className="modal-card card z-[1] w-full max-w-lg rounded-t-[28px] p-6 sm:rounded-[28px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="mailbox-compose-title">
        <div className="flex items-start justify-between"><div><div className="text-xs font-bold tracking-[.2em] text-unseen-600">SECRET MAILBOX</div><h3 id="mailbox-compose-title" className="mt-2 font-grotesk text-2xl font-bold">Send a sealed note.</h3></div><button type="button" onClick={onClose} disabled={busy} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></div>
        {error && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">Send to<select required value={recipient} onChange={(event) => setRecipient(event.target.value)} disabled={loading || busy} className="input-themed mt-1.5 w-full rounded-2xl px-4 py-3"><option value="">{loading ? 'Loading campus ghosts…' : 'Choose an anonymous profile'}</option>{recipients.map((row) => <option key={row.ghost_id} value={row.ghost_id}>{row.emoji} {row.display_name}</option>)}</select></label>
          {!loading && !recipients.length && <p className="text-xs text-muted">No other active campus profiles are available right now.</p>}
          <label className="block text-sm font-semibold">Your note<textarea required maxLength={1000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} disabled={busy} className="input-themed mt-1.5 w-full resize-y rounded-2xl px-4 py-3" placeholder="Say something kind…" /><span className="mt-1 block text-right text-[11px] text-faint">{body.length}/1000</span></label>
          <p className="text-[11px] leading-relaxed text-muted">The recipient sees your campus ghost name. Your username stays private. Notes expire after seven days.</p>
          <button disabled={busy || loading || !recipients.length} className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 font-bold disabled:opacity-60"><Send size={15} />{busy ? 'Sealing envelope…' : 'Send anonymously'}</button>
        </form>
      </section>
    </div>
  );
}
