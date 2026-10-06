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
type ChatChannel = ReturnType<ReturnType<typeof requireSupabase>['channel']>;
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
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const unique = new Map<string, ChatMessage>();
  for (const message of [...current, ...incoming]) {
    unique.set(`${message.senderId}:${message.createdAt}:${message.body}`, message);
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-100);
}
function localHistoryKey(userId: string, sessionKey: string) { return `unseen:random-chat:history:${userId}:${sessionKey}`; }
function localSessionKey(userId: string) { return `unseen:random-chat:active:${userId}`; }
function readLocalSession(userId: string): string | null {
  try { return sessionStorage.getItem(localSessionKey(userId)); } catch { return null; }
}
function readLocalHistory(userId: string, sessionKey: string, myId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(localHistoryKey(userId, sessionKey));
    const rows: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) return [];
    return rows.map((value) => {
      const row = object(value);
      return messageFrom({ body: row?.body, sender_id: row?.senderId, sender_profile: row?.sender, created_at: row?.createdAt }, myId);
    }).filter((item): item is ChatMessage => item !== null);
  } catch { return []; }
}
function rememberLocalSession(userId: string, sessionKey: string) {
  try { sessionStorage.setItem(localSessionKey(userId), sessionKey); } catch { /* Chat still works in memory when browser storage is unavailable. */ }
}
function forgetLocalHistory(userId: string, sessionKey?: string | null) {
  try {
    const activeKey = localSessionKey(userId);
    const key = sessionKey ?? sessionStorage.getItem(activeKey);
    if (key) sessionStorage.removeItem(localHistoryKey(userId, key));
    sessionStorage.removeItem(activeKey);
  } catch { /* Local cleanup is best effort when browser storage is unavailable. */ }
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
  const [chatReady, setChatReady] = useState(false);
  const myId = session?.user.id ?? '';
  const syncInFlight = useRef(false);
  const lastHeartbeatAt = useRef(0);
  const chatChannelRef = useRef<ChatChannel | null>(null);
  const chatChannelKeyRef = useRef<string | null>(null);
  const presenceTimeoutRef = useRef<number | null>(null);
  const clearMatchRef = useRef<() => void>(() => {});

  const connectToChat = (key: string) => {
    if (chatChannelRef.current && chatChannelKeyRef.current === key) return;
    if (chatChannelRef.current) void requireSupabase().removeChannel(chatChannelRef.current);
    chatChannelRef.current = null;
    chatChannelKeyRef.current = key;
    setChatReady(false);
    const client = requireSupabase();
    const channel = client.channel(`random-chat:${key}`, { config: { private: true, broadcast: { ack: true }, presence: { key: myId } } });
    let sawPeer = false;
    const finishIfPeerLeft = async () => {
      if (sessionRef.current !== key) return;
      const { error } = await client.rpc('random_chat_end', { p_session_key: key });
      if (sessionRef.current !== key) return;
      if (error) onToast(error.message, 'error');
      clearMatchRef.current();
      onToast('The other ghost disconnected. This chat was cleared.', 'info');
    };
    const evaluatePresence = () => {
      if (sessionRef.current !== key) return;
      const peerPresent = Object.keys(channel.presenceState()).some((presenceKey) => presenceKey !== myId);
      if (peerPresent) {
        sawPeer = true;
        if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
        presenceTimeoutRef.current = null;
        return;
      }
      if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
      presenceTimeoutRef.current = window.setTimeout(() => {
        presenceTimeoutRef.current = null;
        if (sessionRef.current !== key) return;
        const stillMissing = !Object.keys(channel.presenceState()).some((presenceKey) => presenceKey !== myId);
        if (stillMissing) void finishIfPeerLeft();
      }, sawPeer ? 1_200 : 30_000);
    };
    channel.on('presence', { event: 'sync' }, evaluatePresence)
      .on('presence', { event: 'join' }, evaluatePresence)
      .on('presence', { event: 'leave' }, evaluatePresence);
    channel.on('broadcast', { event: 'random:message' }, ({ payload }) => {
      const data = object(payload);
      if (data?.session_key !== key || sessionRef.current !== key) return;
      const incoming = messageFrom(data, myId);
      if (!incoming) return;
      setMessages((current) => mergeMessages(current, [incoming]));
      if (/(?:\b\d{10,}\b|@[A-Z0-9._%+-]+\.[A-Z]{2,}|(?:instagram|snapchat|phone|number)\s*[:=])/i.test(incoming.body)) setPersonalInfoWarning(true);
    }).subscribe((status) => {
      if (chatChannelKeyRef.current !== key) return;
      if (status === 'SUBSCRIBED') {
        setChatReady(true);
        void channel.track({ user_id: myId }).then(evaluatePresence).catch(() => setChatReady(false));
        evaluatePresence();
      }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setChatReady(false);
        if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
        presenceTimeoutRef.current = null;
        if (chatChannelRef.current === channel) {
          chatChannelRef.current = null;
          chatChannelKeyRef.current = null;
          void client.removeChannel(channel);
        }
      }
    });
    chatChannelRef.current = channel;
  };
  const activateMatch = (key: string, other: unknown, incoming: ChatMessage[] = []) => {
    const sameSession = sessionRef.current === key;
    sessionRef.current = key;
    setSessionKey(key);
    setPartner(ghost(other));
    rememberLocalSession(myId, key);
    const localMessages = readLocalHistory(myId, key, myId);
    setMessages((current) => sameSession ? mergeMessages(current, [...localMessages, ...incoming]) : mergeMessages(localMessages, incoming));
    if (!sameSession) { setDraft(''); setPersonalInfoWarning(false); }
    setMode('matched');
    connectToChat(key);
  };
  const clearMatch = () => {
    forgetLocalHistory(myId, sessionRef.current);
    sessionRef.current = null;
    setSessionKey(null);
    setPartner(null);
    setMessages([]);
    setDraft('');
    setPersonalInfoWarning(false);
    setChatReady(false);
    if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
    presenceTimeoutRef.current = null;
    chatChannelKeyRef.current = null;
    if (chatChannelRef.current) void requireSupabase().removeChannel(chatChannelRef.current);
    chatChannelRef.current = null;
    setMode('idle');
  };
  clearMatchRef.current = clearMatch;
  const restoreCurrent = async () => {
    const client = requireSupabase();
    const { data, error } = await client.rpc('random_chat_current');
    rpcError(error);
    const current = data?.[0];
    if (!current) { clearMatch(); return 'idle'; }
    if (current.state === 'matched' && current.session_key) {
      const rows = Array.isArray(current.messages) ? current.messages : [];
      const restored = rows.map((item: Json) => messageFrom(item, myId)).filter((item): item is ChatMessage => item !== null);
      activateMatch(current.session_key, current.partner, restored);
      return 'matched';
    } else {
      const state = current.state === 'searching' ? 'searching' : 'idle';
      clearMatch();
      if (state === 'searching') setMode('searching');
      return state;
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
        activateMatch(data.session_key, data.partner);
        setReportOpen(false);
        onToast('You have been matched with a campus ghost.', 'success');
      }
    }).on('broadcast', { event: 'random:ended' }, ({ payload }) => {
      const data = object(payload);
      if (active && data?.session_key === sessionRef.current) { clearMatch(); onToast('This chat has ended.', 'info'); }
    }).subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') void restoreCurrent().catch((cause: unknown) => { setMode('idle'); onToast(cause instanceof Error ? cause.message : 'Could not restore Random Chat.', 'error'); });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        void restoreCurrent().catch((cause: unknown) => { setMode('idle'); onToast(cause instanceof Error ? cause.message : 'Could not connect to Random Chat.', 'error'); });
      }
    });
    return () => {
      active = false;
      void client.removeChannel(channel);
      if (chatChannelRef.current) void client.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
      chatChannelKeyRef.current = null;
    };
  }, [profile?.isRegistered, session?.user.id]);

  useEffect(() => {
    if (mode !== 'matched' || !sessionKey) return;
    try {
      rememberLocalSession(myId, sessionKey);
      sessionStorage.setItem(localHistoryKey(myId, sessionKey), JSON.stringify(messages));
    } catch { /* Keep the transcript in component memory when browser storage is unavailable. */ }
  }, [messages, mode, myId, sessionKey]);

  useEffect(() => {
    if (mode !== 'searching' && mode !== 'matched') return;
    let active = true;
    let hasShownSyncError = false;
    const sync = async () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      const previousSession = sessionRef.current;
      try {
        const state = await restoreCurrent();
        hasShownSyncError = false;
        if (!active) return;
        if (previousSession && state !== 'matched') onToast('This chat has ended.', 'info');
        if (state === 'idle' && mode === 'searching') {
          await start();
        } else if (state === 'searching' && Date.now() - lastHeartbeatAt.current >= 15_000) {
          lastHeartbeatAt.current = Date.now();
          const { data, error } = await requireSupabase().rpc('random_chat_heartbeat');
          rpcError(error);
          if (data === false && active) await start();
        }
      } catch (cause) {
        if (active && !hasShownSyncError) {
          onToast(cause instanceof Error ? cause.message : 'Random Chat could not sync. Reconnecting…', 'error');
          hasShownSyncError = true;
        }
      } finally {
        syncInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => { void sync(); }, 5_000);
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
        activateMatch(result.session_key, result.partner);
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
      const channel = chatChannelRef.current;
      if (!chatReady || chatChannelKeyRef.current !== sessionKey || channel?.state !== 'joined') {
        throw new Error('Chat is reconnecting. Please try sending again.');
      }
      const { data, error } = await requireSupabase().rpc('random_chat_send', { p_session_key: sessionKey, p_body: text });
      rpcError(error);
      const sent = messageFrom(data?.[0], myId);
      const ticket = data?.[0]?.broadcast_ticket;
      if (!sent || typeof ticket !== 'string') throw new Error('Message was not approved. Please try again.');
      const sendStatus = await channel.send({
        type: 'broadcast',
        event: 'random:message',
        payload: {
          session_key: sessionKey,
          broadcast_ticket: ticket,
          body: sent.body,
          sender_id: sent.senderId,
          sender_profile: sent.sender,
          created_at: sent.createdAt,
        },
      });
      if (sendStatus !== 'ok') throw new Error('Message could not reach the other person. Please try again.');
      setMessages((current) => mergeMessages(current, [sent]));
      setDraft('');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Message could not be sent.', 'error'); }
    finally { setBusy(false); }
  };

  const closeChat = async () => {
    if (busy) return;
    const activeSession = sessionRef.current ?? sessionKey ?? readLocalSession(myId);
    const searching = mode === 'searching';
    if (activeSession || searching) setBusy(true);
    try {
      if (activeSession) {
        const { error } = await requireSupabase().rpc('random_chat_end', { p_session_key: activeSession });
        rpcError(error);
      } else if (searching) {
        const { error } = await requireSupabase().rpc('random_chat_cancel');
        rpcError(error);
      }
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not disconnect cleanly.', 'error');
    } finally {
      clearMatch();
      setBusy(false);
      onClose();
    }
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
      <button type="button" className="modal-bg" aria-label="Close Random Chat" onClick={() => void closeChat()} />
      <section className="modal-card card z-[1] flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="random-chat-heading">
        <header className="flex items-center justify-between border-b border-soft px-5 py-4 sm:px-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><MessageCircle size={19} /></span><div><p className="text-[10px] font-bold tracking-[.2em] text-unseen-600">CAMPUS RANDOM CHAT</p><h2 id="random-chat-heading" className="font-grotesk text-lg font-bold">Say hi to a ghost</h2></div></div><button type="button" onClick={() => void closeChat()} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></header>
        {!profile?.isRegistered ? <div className="p-7 text-center sm:p-10"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><UserRound size={25} /></span><h3 className="mt-4 font-grotesk text-xl font-bold">A saved campus account is needed</h3><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">Random Chat connects registered campus ghosts so reports and blocks can protect the community. Other visitors still get anonymous feed reactions.</p><button type="button" onClick={() => { onClose(); onOpenAuth('register'); }} className="btn-primary mt-5 rounded-full px-6 py-3 text-sm font-bold">Join UNSEEN</button></div> : <>
          <div className="flex min-h-[26rem] flex-col bg-soft/40">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-live="polite">
              {(mode === 'loading' || mode === 'searching') && <div className="flex h-72 flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-purple-100 text-unseen-700">{mode === 'loading' ? <LoaderCircle size={25} className="animate-spin" /> : <Sparkles size={25} className="animate-pulse" />}</span><h3 className="mt-4 font-grotesk text-xl font-bold">{mode === 'loading' ? 'Restoring your campus connection…' : 'Finding a campus ghost…'}</h3><p className="mt-2 max-w-sm text-sm text-muted">{mode === 'searching' ? 'We will match you as soon as another campus ghost is ready.' : 'Your public identity remains anonymous.'}</p>{mode === 'searching' && <button type="button" disabled={busy} onClick={() => void requireSupabase().rpc('random_chat_cancel').then(({ error }) => { if (error) onToast(error.message, 'error'); else setMode('idle'); })} className="chip mt-5 rounded-full px-5 py-2.5 text-sm font-bold">Cancel search</button>}</div>}
              {mode === 'idle' && <div className="flex h-72 flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-purple-100 text-unseen-700"><CircleHelp size={25} /></span><h3 className="mt-4 font-grotesk text-xl font-bold">A fresh conversation, no introductions.</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">Get paired with another available campus ghost. Do not share your name, number, address, or social handle.</p><button type="button" disabled={busy} onClick={() => void start()} className="btn-primary mt-5 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold"><Sparkles size={16} /> Find someone</button></div>}
              {mode === 'matched' && partner && <><div className="mb-5 flex items-center justify-between rounded-2xl border border-soft bg-card p-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: partner.color }}>{partner.emoji}</span><div><p className="truncate text-sm font-bold">{partner.name}</p><p className="text-[11px] font-medium text-emerald-700">Anonymous campus ghost · {chatReady ? 'Connected' : 'Reconnecting…'}</p></div></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void nextChat()} title="Next ghost" className="chip rounded-full px-3 py-2 text-xs font-bold">Next</button><button type="button" disabled={busy} onClick={() => void finish('block')} title="Block this ghost" className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700"><Ban size={15} /><span className="sr-only">Block</span></button><button type="button" disabled={busy} onClick={() => void finish('end')} title="End chat" className="chip rounded-full px-3 py-2 text-xs font-bold">End</button></div></div>
                {personalInfoWarning && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><ShieldAlert size={16} className="mt-0.5 shrink-0" />Keep private details out of chat. Never share your phone number, address, real name, or social account.</div>}
                <div className="space-y-3">{messages.map((message, index) => <div key={`${message.createdAt}:${message.senderId}:${index}`} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[86%] rounded-2xl px-4 py-3 ${message.mine ? 'rounded-br-md bg-purple-700 text-white' : 'rounded-bl-md border border-soft bg-card text-primary'}`}><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p><time className={`mt-1 block text-right text-[10px] ${message.mine ? 'text-purple-100' : 'text-faint'}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div></div>)}{!messages.length && <p className="py-8 text-center text-xs font-medium text-muted">You are connected. Say hello 👋</p>}</div>
                </>}
            </div>
            {mode === 'matched' && <div className="border-t border-soft bg-card p-3 sm:p-4"><form onSubmit={(event) => void send(event)} className="flex gap-2"><label className="sr-only" htmlFor="random-chat-message">Message</label><input id="random-chat-message" maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy || !chatReady} className="input-themed min-w-0 flex-1 rounded-full px-4 py-3 text-sm" placeholder={chatReady ? 'Write a message…' : 'Reconnecting…'} /><button type="submit" disabled={busy || !chatReady || !draft.trim()} className="btn-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-50" aria-label="Send message"><Send size={17} /></button></form><div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-medium text-muted"><span>Chat history stays in this tab and clears when the conversation ends.</span><button type="button" disabled={busy} onClick={() => setReportOpen(true)} className="inline-flex shrink-0 items-center gap-1 font-bold text-rose-700"><ShieldAlert size={13} /> Report</button></div></div>}
          </div>
        </>}
        <footer className="flex items-center justify-center gap-2 border-t border-soft px-4 py-3 text-[10px] font-medium text-muted"><Ban size={13} /> Be respectful. Block and report tools are available in every conversation.</footer>
      </section>
      {reportOpen && <div className="modal active z-[110]" role="presentation"><button type="button" className="modal-bg" onClick={() => { if (!busy) setReportOpen(false); }} aria-label="Close report form" /><section className="modal-card card z-[1] w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="random-report-title"><h3 id="random-report-title" className="font-grotesk text-xl font-bold">Report this conversation</h3><p className="mt-1 text-xs text-muted">Your reason and details go to moderators. Chat messages are not stored on the server.</p><form onSubmit={(event) => void submitReport(event)} className="mt-4 space-y-4"><label className="block text-xs font-bold">What happened?<select value={reportReason} onChange={(event) => setReportReason(event.target.value)} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3">{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="block text-xs font-bold">Details (optional)<textarea value={reportDetail} onChange={(event) => setReportDetail(event.target.value.slice(0, 1000))} rows={3} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3" /></label><div className="flex gap-2"><button type="button" onClick={() => setReportOpen(false)} className="chip flex-1 rounded-full px-4 py-3 text-sm font-bold">Cancel</button><button type="submit" disabled={busy} className="flex-1 rounded-full bg-rose-700 px-4 py-3 text-sm font-bold text-white">Send report</button></div></form></section></div>}
    </div>
  );
}
