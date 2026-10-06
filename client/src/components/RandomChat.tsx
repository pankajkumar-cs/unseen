import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, CircleHelp, LoaderCircle, MessageCircle, Send, ShieldAlert, Sparkles, UserRound, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { requireSupabase } from '../lib/supabase';
import type { Json } from '../types/database';

interface RandomChatProps {
  onClose: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface GhostProfile { name: string; emoji: string; color: string }
interface ChatMessage { body: string; senderId: string; sender: GhostProfile; createdAt: string; mine: boolean }
type ChatMode = 'loading' | 'idle' | 'searching' | 'matched';
const reasons = ['Harassment', 'Bullying', 'Threat', 'Sexual/explicit content', 'Spam', 'Hate/abuse', 'Asking for personal information', 'Sharing inappropriate content', 'Other'];

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function ghost(value: unknown): GhostProfile {
  const row = object(value);
  return { name: typeof row?.name === 'string' ? row.name : 'Anonymous Ghost', emoji: typeof row?.emoji === 'string' ? row.emoji : '👻', color: typeof row?.color === 'string' ? row.color : '#EDE9FE' };
}
function messageFrom(value: unknown, myId: string): ChatMessage | null {
  const row = object(value);
  if (!row || typeof row.body !== 'string' || typeof row.created_at !== 'string') return null;
  const senderId = typeof row.sender_id === 'string' ? row.sender_id : '';
  return { body: row.body, senderId, sender: ghost(row.sender_profile), createdAt: row.created_at, mine: senderId === myId };
}
function rpcError(error: { message: string } | null) { if (error) throw new Error(error.message); }

export function RandomChat({ onClose, onOpenAuth, onToast }: RandomChatProps) {
  const { profile, session } = useAuth();
  const [mode, setMode] = useState<ChatMode>('loading');
  const [partner, setPartner] = useState<GhostProfile | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(reasons[0]);
  const [reportDetail, setReportDetail] = useState('');
  const [personalInfoWarning, setPersonalInfoWarning] = useState(false);
  const myId = session?.user.id ?? '';

  const clearMatch = () => { sessionRef.current = null; setSessionKey(null); setPartner(null); setMessages([]); setDraft(''); setMode('idle'); };
  const restoreCurrent = async () => {
    const client = requireSupabase();
    const { data, error } = await client.rpc('random_chat_current');
    rpcError(error);
    const current = data?.[0];
    if (!current) { setMode('idle'); return; }
    if (current.state === 'matched' && current.session_key) {
      sessionRef.current = current.session_key;
      setSessionKey(current.session_key);
      setPartner(ghost(current.partner));
      const rows = Array.isArray(current.messages) ? current.messages : [];
      setMessages(rows.map((item: Json) => messageFrom(item, myId)).filter((item): item is ChatMessage => item !== null));
      setMode('matched');
    } else {
      sessionRef.current = null;
      setSessionKey(null);
      setPartner(null);
      setMode(current.state === 'searching' ? 'searching' : 'idle');
    }
  };

  useEffect(() => {
    if (!profile?.isRegistered || !session?.user.id) { setMode('idle'); return; }
    const client = requireSupabase();
    let active = true;
    const channel = client.channel(`user:${session.user.id}`, { config: { private: true } });
    channel.on('broadcast', { event: 'random:matched' }, ({ payload }) => {
      const data = object(payload);
      if (!active) return;
      if (typeof data?.session_key === 'string') {
        sessionRef.current = data.session_key;
        setSessionKey(data.session_key);
        setPartner(ghost(data.partner));
        setMessages([]);
        setMode('matched');
        setReportOpen(false);
        onToast('You have been matched with a campus ghost.', 'success');
      }
    }).on('broadcast', { event: 'random:message' }, ({ payload }) => {
      const data = object(payload);
      if (!active || data?.session_key !== sessionRef.current) return;
      const incoming = messageFrom(data, myId);
      if (!incoming) return;
      setMessages((current) => [...current, incoming].slice(-100));
      if (/(?:\b\d{10,}\b|@[A-Z0-9._%+-]+\.[A-Z]{2,}|(?:instagram|snapchat|phone|number)\s*[:=])/i.test(incoming.body)) setPersonalInfoWarning(true);
    }).on('broadcast', { event: 'random:ended' }, ({ payload }) => {
      const data = object(payload);
      if (active && data?.session_key === sessionRef.current) { clearMatch(); onToast('This chat has ended.', 'info'); }
    }).subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') void restoreCurrent().catch((cause: unknown) => { setMode('idle'); onToast(cause instanceof Error ? cause.message : 'Could not restore Random Chat.', 'error'); });
    });
    return () => { active = false; void client.removeChannel(channel); };
  }, [profile?.isRegistered, session?.user.id]);

  useEffect(() => {
    if (mode !== 'searching') return;
    const timer = window.setInterval(() => { void requireSupabase().rpc('random_chat_heartbeat').then(({ error }) => { if (error) onToast(error.message, 'error'); }); }, 20_000);
    return () => window.clearInterval(timer);
  }, [mode, onToast]);

  const start = async () => {
    if (!profile?.isRegistered) { onOpenAuth('register'); return; }
    setBusy(true);
    setMode('searching');
    try {
      const { data, error } = await requireSupabase().rpc('random_chat_start');
      rpcError(error);
      const result = data?.[0];
      if (result?.state === 'matched' && result.session_key) {
        sessionRef.current = result.session_key;
        setSessionKey(result.session_key);
        setPartner(ghost(result.partner));
        setMessages([]);
        setMode('matched');
      } else setMode('searching');
    } catch (cause) { setMode('idle'); onToast(cause instanceof Error ? cause.message : 'Could not start Random Chat.', 'error'); }
    finally { setBusy(false); }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !sessionKey || busy) return;
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc('random_chat_send', { p_session_key: sessionKey, p_body: text });
      rpcError(error);
      setDraft('');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Message could not be sent.', 'error'); }
    finally { setBusy(false); }
  };

  const finish = async (action: 'end' | 'block') => {
    if (!sessionKey) return;
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc(action === 'block' ? 'random_chat_block' : 'random_chat_end', { p_session_key: sessionKey });
      rpcError(error);
      clearMatch();
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'This chat could not be ended.', 'error'); }
    finally { setBusy(false); }
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionKey) return;
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc('random_chat_report', { p_session_key: sessionKey, p_reason: reportReason, p_detail: reportDetail.trim() });
      rpcError(error);
      clearMatch();
      setReportOpen(false);
      onToast('Your private report was sent to campus moderators.', 'success');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Could not submit this report.', 'error'); }
    finally { setBusy(false); }
  };

  const nextChat = async () => {
    if (!sessionKey) return;
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc('random_chat_end', { p_session_key: sessionKey });
      rpcError(error);
      clearMatch();
      await start();
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Could not find another chat.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal active z-[95]" role="presentation">
      <button type="button" className="modal-bg" aria-label="Close Random Chat" onClick={() => { if (!busy) onClose(); }} />
      <section className="modal-card card z-[1] flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="random-chat-heading">
        <header className="flex items-center justify-between border-b border-soft px-5 py-4 sm:px-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><MessageCircle size={19} /></span><div><p className="text-[10px] font-bold tracking-[.2em] text-unseen-600">CAMPUS RANDOM CHAT</p><h2 id="random-chat-heading" className="font-grotesk text-lg font-bold">Say hi to a ghost</h2></div></div><button type="button" onClick={() => { if (!busy) onClose(); }} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></header>
        {!profile?.isRegistered ? <div className="p-7 text-center sm:p-10"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><UserRound size={25} /></span><h3 className="mt-4 font-grotesk text-xl font-bold">A saved campus account is needed</h3><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">Random Chat connects registered campus ghosts so reports and blocks can protect the community. Other visitors still get anonymous feed reactions.</p><button type="button" onClick={() => { onClose(); onOpenAuth('register'); }} className="btn-primary mt-5 rounded-full px-6 py-3 text-sm font-bold">Join UNSEEN</button></div> : <>
          <div className="flex min-h-[26rem] flex-col bg-soft/40">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-live="polite">
              {(mode === 'loading' || mode === 'searching') && <div className="flex h-72 flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-purple-100 text-unseen-700">{mode === 'loading' ? <LoaderCircle size={25} className="animate-spin" /> : <Sparkles size={25} className="animate-pulse" />}</span><h3 className="mt-4 font-grotesk text-xl font-bold">{mode === 'loading' ? 'Restoring your campus connection…' : 'Finding a campus ghost…'}</h3><p className="mt-2 max-w-sm text-sm text-muted">{mode === 'searching' ? 'We will match you as soon as another campus ghost is ready.' : 'Your public identity remains anonymous.'}</p>{mode === 'searching' && <button type="button" disabled={busy} onClick={() => void requireSupabase().rpc('random_chat_cancel').then(({ error }) => { if (error) onToast(error.message, 'error'); else setMode('idle'); })} className="chip mt-5 rounded-full px-5 py-2.5 text-sm font-bold">Cancel search</button>}</div>}
              {mode === 'idle' && <div className="flex h-72 flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-purple-100 text-unseen-700"><CircleHelp size={25} /></span><h3 className="mt-4 font-grotesk text-xl font-bold">A fresh conversation, no introductions.</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">Get paired with another available campus ghost. Do not share your name, number, address, or social handle.</p><button type="button" disabled={busy} onClick={() => void start()} className="btn-primary mt-5 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold"><Sparkles size={16} /> Find someone</button></div>}
              {mode === 'matched' && partner && <><div className="mb-5 flex items-center justify-between rounded-2xl border border-soft bg-card p-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: partner.color }}>{partner.emoji}</span><div><p className="truncate text-sm font-bold">{partner.name}</p><p className="text-[11px] font-medium text-emerald-700">Anonymous campus ghost · Connected</p></div></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void nextChat()} title="Next ghost" className="chip rounded-full px-3 py-2 text-xs font-bold">Next</button><button type="button" disabled={busy} onClick={() => void finish('block')} title="Block this ghost" className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700"><Ban size={15} /><span className="sr-only">Block</span></button><button type="button" disabled={busy} onClick={() => void finish('end')} title="End chat" className="chip rounded-full px-3 py-2 text-xs font-bold">End</button></div></div>
                {personalInfoWarning && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><ShieldAlert size={16} className="mt-0.5 shrink-0" />Keep private details out of chat. Never share your phone number, address, real name, or social account.</div>}
                <div className="space-y-3">{messages.map((message, index) => <div key={`${message.createdAt}:${message.senderId}:${index}`} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[86%] rounded-2xl px-4 py-3 ${message.mine ? 'rounded-br-md bg-purple-700 text-white' : 'rounded-bl-md border border-soft bg-card text-primary'}`}><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p><time className={`mt-1 block text-right text-[10px] ${message.mine ? 'text-purple-100' : 'text-faint'}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div></div>)}{!messages.length && <p className="py-8 text-center text-xs font-medium text-muted">You are connected. Say hello 👋</p>}</div>
                </>}
            </div>
            {mode === 'matched' && <div className="border-t border-soft bg-card p-3 sm:p-4"><form onSubmit={(event) => void send(event)} className="flex gap-2"><label className="sr-only" htmlFor="random-chat-message">Message</label><input id="random-chat-message" maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} className="input-themed min-w-0 flex-1 rounded-full px-4 py-3 text-sm" placeholder="Write a message…" /><button type="submit" disabled={busy || !draft.trim()} className="btn-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-50" aria-label="Send message"><Send size={17} /></button></form><div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-medium text-muted"><span>Messages are private to this matched conversation and expire after 24 hours.</span><button type="button" disabled={busy} onClick={() => setReportOpen(true)} className="inline-flex shrink-0 items-center gap-1 font-bold text-rose-700"><ShieldAlert size={13} /> Report</button></div></div>}
          </div>
        </>}
        <footer className="flex items-center justify-center gap-2 border-t border-soft px-4 py-3 text-[10px] font-medium text-muted"><Ban size={13} /> Be respectful. Block and report tools are available in every conversation.</footer>
      </section>
      {reportOpen && <div className="modal active z-[110]" role="presentation"><button type="button" className="modal-bg" onClick={() => { if (!busy) setReportOpen(false); }} aria-label="Close report form" /><section className="modal-card card z-[1] w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="random-report-title"><h3 id="random-report-title" className="font-grotesk text-xl font-bold">Report this conversation</h3><p className="mt-1 text-xs text-muted">The moderator sees the anonymous profiles and recent messages for review.</p><form onSubmit={(event) => void submitReport(event)} className="mt-4 space-y-4"><label className="block text-xs font-bold">What happened?<select value={reportReason} onChange={(event) => setReportReason(event.target.value)} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3">{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="block text-xs font-bold">Details (optional)<textarea value={reportDetail} onChange={(event) => setReportDetail(event.target.value.slice(0, 1000))} rows={3} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3" /></label><div className="flex gap-2"><button type="button" onClick={() => setReportOpen(false)} className="chip flex-1 rounded-full px-4 py-3 text-sm font-bold">Cancel</button><button type="submit" disabled={busy} className="flex-1 rounded-full bg-rose-700 px-4 py-3 text-sm font-bold text-white">Send report</button></div></form></section></div>}
    </div>
  );
}
