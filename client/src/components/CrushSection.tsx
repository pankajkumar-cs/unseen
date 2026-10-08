import { useEffect, useState, type FormEvent } from 'react';
import { getUserFacingError } from '../lib/errors';
import { formatIndiaDate } from '../lib/dates';
import { Heart, MapPin, Plus, Ship, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import { createCrush, loadCrushes, reactToCrush, type CrushView } from '../services/community';

interface CrushSectionProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export function CrushSection({ onOpenAuth, onToast }: CrushSectionProps) {
  const { profile } = useAuth();
  const [items, setItems] = useState<CrushView[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);

  const refresh = async () => {
    try { setItems(await loadCrushes()); }
    catch (cause) { onToast(getUserFacingError(cause, 'Spotted posts could not load.'), 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  useRealtime((event) => {
    if (event.type === 'system:reconnected') { void refresh(); return; }
    if (!event.type.startsWith('crush:')) return;
    if (event.type === 'crush:deleted') {
      const id = event.payload.id;
      if (typeof id === 'string') setItems((current) => current.filter((item) => item.id !== id));
      return;
    }
    void refresh();
  });

  const create = async (recipient: string, location: string, message: string) => {
    if (!profile?.isRegistered) { onOpenAuth('register'); return; }
    try {
      await createCrush(recipient, location, message);
      await refresh();
      setComposerOpen(false);
      onToast('Your spotted post is live.', 'success');
    } catch (cause) { onToast(getUserFacingError(cause, 'Your spotted post could not be added.'), 'error'); }
  };

  const react = async (item: CrushView, kind: 'ship' | 'blush') => {
    try {
      const result = await reactToCrush(item.id, kind);
      if (result) setItems((current) => current.map((row) => row.id === item.id ? { ...row, ships: result.ships, blushes: result.blushes } : row));
    } catch (cause) { onToast(getUserFacingError(cause, 'Your reaction could not be saved.'), 'error'); }
  };

  return (
    <section id="crush" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
      <div className="relative overflow-hidden rounded-[28px] border border-soft p-6 sm:p-10" style={{ background: 'linear-gradient(135deg,var(--surface),var(--crush-surface),var(--bg2))' }}>
        <div className="pointer-events-none absolute -right-8 -top-10 select-none text-[130px] opacity-10">💘</div>
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div><div className="text-xs font-bold tracking-[.2em] text-pink-700">💘 CRUSH CORNER & SPOTTED</div><h2 className="mt-2 font-grotesk text-3xl font-bold tracking-tight sm:text-[40px]">Library wali smile… <span className="grad-text">bol de yaar.</span></h2><p className="mt-1 text-sm font-medium text-muted">No names, no photos, no stalking. Keep it cute, keep it safe.</p></div>
          <button type="button" onClick={() => profile?.isRegistered ? setComposerOpen(true) : onOpenAuth('register')} className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#be185d,#6d28d9)' }}><Plus size={16} /> Drop a Spotted</button>
        </div>
        {loading && <p className="relative mt-7 text-sm text-muted">Loading the campus board…</p>}
        {!loading && !items.length && <div className="card relative mt-7 p-8 text-center"><div className="text-5xl">💘</div><h3 className="mt-3 font-grotesk font-bold">No spotted posts yet</h3><p className="mt-1 text-sm text-muted">Be the first to drop a kind, anonymous campus hint.</p></div>}
        {!loading && items.length > 0 && <div className="scrollbar-hide relative mt-7 flex snap-x gap-4 overflow-x-auto pb-2">
          {items.map((item) => <article key={item.id} className="card min-w-[280px] max-w-[340px] snap-start rounded-3xl border-soft p-5 backdrop-blur">
            <div className="flex items-center justify-between"><span className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#be185d,#6d28d9)' }}>💘 SPOTTED</span><time dateTime={item.createdAt} className="text-[11px] font-bold text-faint">{formatIndiaDate(item.createdAt)}</time></div>
            <h3 className="mt-3 font-grotesk text-[15px] font-bold">To: {item.recipient}</h3>
            {item.location && <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-pink-50 px-2.5 py-1 text-[11px] font-bold text-pink-700"><MapPin size={12} />{item.location}</div>}
            {item.message && <p className="mt-2.5 whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-muted">“{item.message}”</p>}
            <div className="mt-2 text-[11px] font-bold text-faint">{item.emoji} {item.author} (anonymous)</div>
            <div className="mt-4 flex gap-2"><button type="button" onClick={() => void react(item, 'ship')} className="flex min-h-11 flex-1 items-center justify-center rounded-full py-2.5 text-xs font-bold text-white transition hover:scale-[1.02]" style={{ background: 'linear-gradient(135deg,#be123c,#9f1239)' }}><Ship size={13} className="mr-1 inline" />Ship · {item.ships}</button><button type="button" onClick={() => void react(item, 'blush')} className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-pink-100 py-2.5 text-xs font-bold text-pink-700 transition hover:scale-[1.02]"><Heart size={13} className="mr-1 inline" />Same · {item.blushes}</button></div>
          </article>)}
        </div>}
      </div>
      {composerOpen && <SpottedComposer onClose={() => setComposerOpen(false)} onSubmit={create} />}
    </section>
  );
}

function SpottedComposer({ onClose, onSubmit }: { onClose: () => void; onSubmit: (recipient: string, location: string, message: string) => Promise<void> }) {
  const [recipient, setRecipient] = useState('');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    void onSubmit(recipient, location, message).finally(() => setBusy(false));
  };
  return (
    <div className="modal active z-[90]" role="presentation">
      <button type="button" className="modal-bg" onClick={() => { if (!busy) onClose(); }} aria-label="Close spotted composer" />
      <section className="modal-card card z-[1] w-full max-w-lg rounded-t-[28px] p-6 sm:rounded-[28px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="spotted-title">
        <div className="flex items-start justify-between"><div><div className="text-xs font-bold tracking-[.2em] text-pink-600">SPOTTED</div><h3 id="spotted-title" className="mt-2 font-grotesk text-2xl font-bold">Make someone’s day.</h3></div><button type="button" onClick={onClose} disabled={busy} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">To<textarea required maxLength={120} rows={2} value={recipient} onChange={(event) => setRecipient(event.target.value)} className="input-themed mt-1.5 w-full resize-y rounded-2xl px-4 py-3" placeholder="Someone with a kind smile…" /></label>
          <label className="block text-sm font-semibold">Where did you spot them? <span className="font-normal text-faint">(optional)</span><input maxLength={120} value={location} onChange={(event) => setLocation(event.target.value)} className="input-themed mt-1.5 w-full rounded-2xl px-4 py-3" placeholder="Library, canteen, campus…" /></label>
          <label className="block text-sm font-semibold">Message <span className="font-normal text-faint">(optional)</span><textarea maxLength={500} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} className="input-themed mt-1.5 w-full resize-y rounded-2xl px-4 py-3" placeholder="Keep it sweet and respectful." /></label>
          <p className="text-[11px] leading-relaxed text-muted">No names, photos, contact details, or identifying clues. Keep it harmless and respectful.</p>
          <button disabled={busy} className="btn-primary w-full rounded-full px-4 py-3 font-bold disabled:opacity-60">{busy ? 'Posting…' : 'Drop a Spotted'}</button>
        </form>
      </section>
    </div>
  );
}
