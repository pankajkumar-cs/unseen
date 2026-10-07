import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getUserFacingError } from '../lib/errors';
import { formatIndiaTime } from '../lib/dates';
import { Ban, CircleHelp, LoaderCircle, MessageCircle, Send, ShieldAlert, Sparkles, UserRound, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { requireSupabase } from '../lib/supabase';

interface RandomChatProps {
  onClose: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface GhostProfile { name: string; emoji: string; color: string }
interface ChatMessage { body: string; senderId: string; sender: GhostProfile; createdAt: string; mine: boolean; clientMessageId: string | null; delivery?: 'sending' | 'sent' }
interface PendingChatMessage { body: string; clientMessageId: string; sessionKey: string }
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
  return { body: row.body, senderId, sender: ghost(row.sender_profile), createdAt: row.created_at, mine: senderId === myId,
    clientMessageId: typeof row.client_message_id === 'string' ? row.client_message_id : null, delivery: 'sent' };
}
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const unique = new Map<string, ChatMessage>();
  for (const message of [...current, ...incoming]) {
    const key = message.clientMessageId
      ? `${message.senderId}:client:${message.clientMessageId}`
      : `${message.senderId}:${message.createdAt}:${message.body}`;
    unique.set(key, message);
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-100);
}
function rpcError(error: unknown) { if (error) throw error; }

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
  const [peerConnected, setPeerConnected] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [pendingSendStatus, setPendingSendStatus] = useState<'sending' | 'retrying' | 'failed' | null>(null);
  const myId = session?.user.id ?? '';
  const syncInFlight = useRef(false);
  const startInFlight = useRef(false);
  const busyRef = useRef(false);
  const searchGenerationRef = useRef(0);
  const lastHeartbeatAt = useRef(0);
  const chatChannelRef = useRef<ChatChannel | null>(null);
  const chatChannelKeyRef = useRef<string | null>(null);
  const presenceTimeoutRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const clearMatchRef = useRef<() => void>(() => {});
  const pendingMessageRef = useRef<PendingChatMessage | null>(null);
  const pendingSendInFlightRef = useRef(false);
  const pendingRetryTimerRef = useRef<number | null>(null);
  const pendingRetryAttemptsRef = useRef(0);
  const flushPendingMessageRef = useRef<() => void>(() => {});

  const setActionBusy = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const clearPendingRetry = () => {
    if (pendingRetryTimerRef.current !== null) window.clearTimeout(pendingRetryTimerRef.current);
    pendingRetryTimerRef.current = null;
  };
  const schedulePendingRetry = () => {
    if (pendingRetryTimerRef.current !== null || !pendingMessageRef.current) return;
    const delay = Math.min(1_000 * (2 ** Math.min(pendingRetryAttemptsRef.current, 4)), 15_000);
    pendingRetryAttemptsRef.current += 1;
    setPendingSendStatus(pendingRetryAttemptsRef.current > 1 ? 'retrying' : 'sending');
    pendingRetryTimerRef.current = window.setTimeout(() => {
      pendingRetryTimerRef.current = null;
      flushPendingMessageRef.current();
    }, delay);
  };
  const flushPendingMessage = async () => {
    const pending = pendingMessageRef.current;
    if (!pending || pendingSendInFlightRef.current) return;
    if (sessionRef.current !== pending.sessionKey) return;
    const channel = chatChannelRef.current;
    const peerIsPresent = channel && Object.keys(channel.presenceState()).some((presenceKey) => presenceKey !== myId);
    if (!channel || chatChannelKeyRef.current !== pending.sessionKey || channel.state !== 'joined' || !peerIsPresent) {
      schedulePendingRetry();
      return;
    }

    clearPendingRetry();
    pendingSendInFlightRef.current = true;
    setPendingSendStatus(pendingRetryAttemptsRef.current ? 'retrying' : 'sending');
    try {
      const { data, error } = await requireSupabase().rpc('random_chat_send', {
        p_session_key: pending.sessionKey,
        p_body: pending.body,
        p_client_message_id: pending.clientMessageId,
      });
      rpcError(error);
      const sent = messageFrom(data?.[0], myId);
      const ticket = data?.[0]?.broadcast_ticket;
      if (!sent || sent.clientMessageId !== pending.clientMessageId || typeof ticket !== 'string') {
        throw new Error('The message service is updating. Please retry in a moment.');
      }
      if (pendingMessageRef.current !== pending || sessionRef.current !== pending.sessionKey) return;
      const sendingMessage = { ...sent, delivery: 'sending' as const };
      setMessages((current) => mergeMessages(current, [sendingMessage]));
      const broadcast = {
        type: 'broadcast',
        event: 'random:message',
        payload: {
          session_key: pending.sessionKey,
          broadcast_ticket: ticket,
          client_message_id: pending.clientMessageId,
          body: sent.body,
          sender_id: sent.senderId,
          sender_profile: sent.sender,
          created_at: sent.createdAt,
        },
      } as const;
      let sendStatus = 'error';
      for (let attempt = 0; attempt < 3 && sendStatus !== 'ok'; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, attempt * 500));
        if (pendingMessageRef.current !== pending || sessionRef.current !== pending.sessionKey) return;
        if (channel !== chatChannelRef.current || channel.state !== 'joined') break;
        try { sendStatus = await channel.send(broadcast); } catch { sendStatus = 'error'; }
      }
      if (sendStatus !== 'ok') throw new Error('The message could not be confirmed yet. It will retry while this chat stays open.');
      if (pendingMessageRef.current !== pending) return;
      setMessages((current) => mergeMessages(current, [{ ...sent, delivery: 'sent' }]));
      setDraft((current) => current.trim() === pending.body ? '' : current);
      pendingMessageRef.current = null;
      setPendingMessageId(null);
      setPendingSendStatus(null);
      pendingRetryAttemptsRef.current = 0;
    } catch (cause) {
      if (pendingMessageRef.current !== pending) return;
      const code = object(cause)?.code;
      const isPermanent = typeof code === 'string' && ['22023', '42501', 'P0001', 'P0002', '23514', 'PGRST202'].includes(code);
      if (isPermanent) {
        if (code === 'P0002') {
          clearMatchRef.current();
          onToast(getUserFacingError(cause, 'This chat has ended. Start a new chat to continue.'), 'info');
          return;
        }
        setMessages((current) => current.filter((message) => message.clientMessageId !== pending.clientMessageId));
        pendingMessageRef.current = null;
        setPendingMessageId(null);
        setPendingSendStatus(null);
        pendingRetryAttemptsRef.current = 0;
        onToast(getUserFacingError(cause, 'Message could not be sent.'), 'error');
      } else if (pendingRetryAttemptsRef.current >= 5) {
        setPendingSendStatus('failed');
        onToast(getUserFacingError(cause, 'Message delivery is delayed. Retry when your connection is back.'), 'error');
      } else {
        schedulePendingRetry();
      }
    } finally {
      pendingSendInFlightRef.current = false;
    }
  };
  flushPendingMessageRef.current = () => { void flushPendingMessage(); };

  const connectToChat = (key: string) => {
    const existingChannel = chatChannelRef.current;
    if (existingChannel && chatChannelKeyRef.current === key && existingChannel.state !== 'closed') {
      const joined = existingChannel.state === 'joined';
      setChatReady(joined);
      setPeerConnected(joined && Object.keys(existingChannel.presenceState()).some((presenceKey) => presenceKey !== myId));
      return;
    }
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    if (chatChannelRef.current) void requireSupabase().removeChannel(chatChannelRef.current);
    chatChannelRef.current = null;
    chatChannelKeyRef.current = key;
    setChatReady(false);
    setPeerConnected(false);
    const client = requireSupabase();
    const channel = client.channel(`random-chat:${key}`, { config: { private: true, broadcast: { ack: true }, presence: { key: myId } } });
    let sawPeer = false;
    const scheduleReconnect = () => {
      setChatReady(false);
      setPeerConnected(false);
      if (reconnectTimerRef.current !== null) return;
      const delay = Math.min(1_000 * (2 ** Math.min(reconnectAttemptsRef.current, 5)), 30_000);
      reconnectAttemptsRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (sessionRef.current !== key || chatChannelRef.current !== channel) return;
        chatChannelRef.current = null;
        chatChannelKeyRef.current = null;
        void client.removeChannel(channel).catch(() => undefined).finally(() => {
          if (sessionRef.current === key && !chatChannelRef.current) connectToChat(key);
        });
      }, delay);
    };
    const finishIfPeerLeft = async () => {
      if (sessionRef.current !== key || chatChannelRef.current !== channel) return;
      try {
        const { error } = await client.rpc('random_chat_end', { p_session_key: key });
        rpcError(error);
      } catch {
        if (sessionRef.current === key && chatChannelRef.current === channel) {
          presenceTimeoutRef.current = window.setTimeout(() => {
            presenceTimeoutRef.current = null;
            evaluatePresence();
          }, 5_000);
        }
        return;
      }
      if (sessionRef.current !== key || chatChannelRef.current !== channel) return;
      clearMatchRef.current();
      onToast('The other ghost disconnected. This chat was cleared.', 'info');
    };
    const evaluatePresence = () => {
      if (sessionRef.current !== key || chatChannelRef.current !== channel) return;
      const peerPresent = Object.keys(channel.presenceState()).some((presenceKey) => presenceKey !== myId);
      setPeerConnected(peerPresent);
      if (peerPresent) {
        sawPeer = true;
        if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
        presenceTimeoutRef.current = null;
        flushPendingMessageRef.current();
        return;
      }
      if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
      presenceTimeoutRef.current = window.setTimeout(() => {
        presenceTimeoutRef.current = null;
        if (sessionRef.current !== key || chatChannelRef.current !== channel) return;
        const stillMissing = !Object.keys(channel.presenceState()).some((presenceKey) => presenceKey !== myId);
        if (stillMissing) void finishIfPeerLeft();
      }, sawPeer ? 20_000 : 45_000);
    };
    channel.on('presence', { event: 'sync' }, evaluatePresence)
      .on('presence', { event: 'join' }, evaluatePresence)
      .on('presence', { event: 'leave' }, evaluatePresence);
    channel.on('broadcast', { event: 'random:message' }, ({ payload }) => {
      const data = object(payload);
      if (data?.session_key !== key || sessionRef.current !== key || chatChannelRef.current !== channel) return;
      const incoming = messageFrom(data, myId);
      if (!incoming) return;
      setMessages((current) => mergeMessages(current, [incoming]));
      if (/(?:\b\d{10,}\b|@[A-Z0-9._%+-]+\.[A-Z]{2,}|(?:instagram|snapchat|phone|number)\s*[:=])/i.test(incoming.body)) setPersonalInfoWarning(true);
    });
    chatChannelRef.current = channel;
    channel.subscribe((status) => {
      if (chatChannelKeyRef.current !== key || chatChannelRef.current !== channel) return;
      if (status === 'SUBSCRIBED') {
        if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
        reconnectAttemptsRef.current = 0;
        setChatReady(true);
        setPeerConnected(false);
        void channel.track({ user_id: myId }).then((result) => {
          if (result === 'ok') { evaluatePresence(); flushPendingMessageRef.current(); }
          else scheduleReconnect();
        }).catch(scheduleReconnect);
        evaluatePresence();
      }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        scheduleReconnect();
        if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
        presenceTimeoutRef.current = null;
      }
    });
  };
  const activateMatch = (key: string, other: unknown) => {
    const sameSession = sessionRef.current === key;
    if (!sameSession) searchGenerationRef.current += 1;
    sessionRef.current = key;
    setSessionKey(key);
    setPartner(ghost(other));
    if (!sameSession) setMessages([]);
    if (!sameSession) {
      setDraft('');
      setPersonalInfoWarning(false);
      clearPendingRetry();
      pendingMessageRef.current = null;
      pendingRetryAttemptsRef.current = 0;
      setPendingMessageId(null);
      setPendingSendStatus(null);
    }
    setMode('matched');
    connectToChat(key);
  };
  const clearMatch = () => {
    searchGenerationRef.current += 1;
    sessionRef.current = null;
    setSessionKey(null);
    setPartner(null);
    setMessages([]);
    setDraft('');
    clearPendingRetry();
    pendingMessageRef.current = null;
    pendingRetryAttemptsRef.current = 0;
    setPendingMessageId(null);
    setPendingSendStatus(null);
    setPersonalInfoWarning(false);
    setChatReady(false);
    setPeerConnected(false);
    if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
    presenceTimeoutRef.current = null;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    chatChannelKeyRef.current = null;
    if (chatChannelRef.current) void requireSupabase().removeChannel(chatChannelRef.current);
    chatChannelRef.current = null;
    setMode('idle');
  };
  clearMatchRef.current = clearMatch;
  const restoreCurrent = async (isActive: () => boolean = () => true) => {
    const requestGeneration = searchGenerationRef.current;
    const client = requireSupabase();
    const { data, error } = await client.rpc('random_chat_current');
    rpcError(error);
    if (!isActive() || requestGeneration !== searchGenerationRef.current) {
      return 'stale';
    }
    const current = data?.[0];
    if (!current) {
      if (sessionRef.current) clearMatch();
      else setMode('idle');
      return 'idle';
    }
    if (current.state === 'matched' && current.session_key) {
      activateMatch(current.session_key, current.partner);
      return 'matched';
    } else {
      const state = current.state === 'searching' ? 'searching' : 'idle';
      if (sessionRef.current) clearMatch();
      setMode(state);
      return state;
    }
  };

  useEffect(() => {
    if (!profile?.isRegistered || !session?.user.id) { clearMatch(); setMode('idle'); return; }
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
      if (status === 'SUBSCRIBED') void restoreCurrent(() => active).catch((cause: unknown) => {
        if (active) { setMode('idle'); onToast(getUserFacingError(cause, 'Could not restore Random Chat.'), 'error'); }
      });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        void restoreCurrent(() => active).catch(() => {
          if (active) setMode((current) => current === 'loading' ? 'idle' : current);
        });
      }
    });
    return () => {
      active = false;
      const currentSession = sessionRef.current;
      void (async () => {
        try {
          if (currentSession) await client.rpc('random_chat_end', { p_session_key: currentSession });
          else await client.rpc('random_chat_cancel');
        } catch { /* The peer presence timeout still closes an abandoned session. */ }
      })();
      void client.removeChannel(channel);
      if (chatChannelRef.current) void client.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
      chatChannelKeyRef.current = null;
      if (presenceTimeoutRef.current !== null) window.clearTimeout(presenceTimeoutRef.current);
      presenceTimeoutRef.current = null;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      if (pendingRetryTimerRef.current !== null) window.clearTimeout(pendingRetryTimerRef.current);
      pendingRetryTimerRef.current = null;
      pendingMessageRef.current = null;
    };
  }, [profile?.isRegistered, session?.user.id]);

  useEffect(() => {
    if (mode !== 'searching' && mode !== 'matched') return;
    let active = true;
    const sync = async () => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      const previousSession = sessionRef.current;
      try {
        if (busyRef.current || startInFlight.current) return;
        const state = await restoreCurrent(() => active);
        if (!active || state === 'stale') return;
        if (previousSession && state !== 'matched') onToast('This chat has ended.', 'info');
        if (state === 'idle' && mode === 'searching') {
          await start();
        } else if (state === 'searching' && Date.now() - lastHeartbeatAt.current >= 15_000) {
          lastHeartbeatAt.current = Date.now();
          const { data, error } = await requireSupabase().rpc('random_chat_heartbeat');
          rpcError(error);
          if (data === false && active) await start();
        }
      } catch {
        // The next polling pass and Realtime's rejoin cover transient failures.
      } finally {
        syncInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => { void sync(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [mode, onToast]);

  const start = async (alreadyBusy = false) => {
    if (!profile?.isRegistered) { onOpenAuth('register'); return; }
    if (startInFlight.current || (busyRef.current && !alreadyBusy)) return;
    startInFlight.current = true;
    const requestGeneration = ++searchGenerationRef.current;
    if (!alreadyBusy) setActionBusy(true);
    setMode('searching');
    try {
      const { data, error } = await requireSupabase().rpc('random_chat_start');
      rpcError(error);
      const result = data?.[0];
      if (requestGeneration !== searchGenerationRef.current) return;
      if (result?.state === 'matched' && typeof result.session_key === 'string') activateMatch(result.session_key, result.partner);
      else if (result?.state === 'searching') setMode('searching');
      else throw new Error('Random Chat returned an unexpected response. Please try again.');
    } catch (cause) {
      if (requestGeneration === searchGenerationRef.current) {
        setMode(sessionRef.current ? 'matched' : 'idle');
        onToast(getUserFacingError(cause, 'Could not start Random Chat.'), 'error');
      }
    } finally {
      startInFlight.current = false;
      if (!alreadyBusy) setActionBusy(false);
    }
  };

  const cancelSearch = async () => {
    if (busyRef.current) return;
    searchGenerationRef.current += 1;
    setActionBusy(true);
    try {
      const { error } = await requireSupabase().rpc('random_chat_cancel');
      rpcError(error);
      const { data, error: currentError } = await requireSupabase().rpc('random_chat_current');
      rpcError(currentError);
      const current = data?.[0];
      if (current?.state === 'matched' && typeof current.session_key === 'string') {
        const { error: endError } = await requireSupabase().rpc('random_chat_end', { p_session_key: current.session_key });
        rpcError(endError);
      }
      clearMatch();
    } catch (cause) {
      onToast(getUserFacingError(cause, 'Could not cancel the search.'), 'error');
    } finally { setActionBusy(false); }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !sessionKey || busyRef.current || pendingMessageRef.current) return;
    setActionBusy(true);
    try {
      const channel = chatChannelRef.current;
      if (!chatReady || chatChannelKeyRef.current !== sessionKey || !channel || channel.state !== 'joined') {
        setChatReady(false);
        return;
      }
      if (!peerConnected) return;
      pendingMessageRef.current = { sessionKey, body: text, clientMessageId: crypto.randomUUID() };
      pendingRetryAttemptsRef.current = 0;
      setPendingMessageId(pendingMessageRef.current.clientMessageId);
      setPendingSendStatus('sending');
      await flushPendingMessage();
    } catch (cause) { onToast(getUserFacingError(cause, 'Message could not be sent.'), 'error'); }
    finally { setActionBusy(false); }
  };

  const closeChat = async () => {
    if (busyRef.current) return;
    const activeSession = sessionRef.current ?? sessionKey;
    const searching = mode === 'searching';
    if (activeSession || searching) setActionBusy(true);
    try {
      if (activeSession) {
        const { error } = await requireSupabase().rpc('random_chat_end', { p_session_key: activeSession });
        rpcError(error);
      } else if (searching) {
        const { error } = await requireSupabase().rpc('random_chat_cancel');
        rpcError(error);
      }
    } catch (cause) {
      onToast(getUserFacingError(cause, 'Could not disconnect cleanly.'), 'error');
    } finally {
      clearMatch();
      setActionBusy(false);
      onClose();
    }
  };

  const finish = async (action: 'end' | 'block') => {
    if (!sessionKey || busyRef.current) return;
    setActionBusy(true);
    try {
      const { error } = await requireSupabase().rpc(action === 'block' ? 'random_chat_block' : 'random_chat_end', { p_session_key: sessionKey });
      rpcError(error);
      clearMatch();
    } catch (cause) { onToast(getUserFacingError(cause, 'This chat could not be ended.'), 'error'); }
    finally { setActionBusy(false); }
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionKey || busyRef.current) return;
    setActionBusy(true);
    try {
      const { error } = await requireSupabase().rpc('random_chat_report', { p_session_key: sessionKey, p_reason: reportReason, p_detail: reportDetail.trim() });
      rpcError(error);
      clearMatch();
      setReportOpen(false);
      onToast('Your private report was sent to campus moderators.', 'success');
    } catch (cause) { onToast(getUserFacingError(cause, 'Could not submit this report.'), 'error'); }
    finally { setActionBusy(false); }
  };

  const nextChat = async () => {
    if (!sessionKey || busyRef.current) return;
    setActionBusy(true);
    try {
      const { error } = await requireSupabase().rpc('random_chat_end', { p_session_key: sessionKey });
      rpcError(error);
      clearMatch();
      await start(true);
    } catch (cause) { onToast(getUserFacingError(cause, 'Could not find another chat.'), 'error'); }
    finally { setActionBusy(false); }
  };

  return (
    <div className="modal active z-[95]" role="presentation">
      <button type="button" className="modal-bg" aria-label="Close Random Chat" onClick={() => void closeChat()} />
      <section className="modal-card card z-[1] flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="random-chat-heading">
        <header className="flex items-center justify-between border-b border-soft px-5 py-4 sm:px-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><MessageCircle size={19} /></span><div><p className="text-[10px] font-bold tracking-[.2em] text-unseen-600">CAMPUS RANDOM CHAT</p><h2 id="random-chat-heading" className="font-grotesk text-lg font-bold">Say hi to a ghost</h2></div></div><button type="button" onClick={() => void closeChat()} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></header>
        {!profile?.isRegistered ? <div className="p-7 text-center sm:p-10"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><UserRound size={25} /></span><h3 className="mt-4 font-grotesk text-xl font-bold">A saved campus account is needed</h3><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">Random Chat connects registered campus ghosts so reports and blocks can protect the community. Other visitors still get anonymous feed reactions.</p><button type="button" onClick={() => { onClose(); onOpenAuth('register'); }} className="btn-primary mt-5 rounded-full px-6 py-3 text-sm font-bold">Join UNSEEN</button></div> : <>
          <div className="flex min-h-[26rem] flex-col bg-soft/40">
            <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-live="polite">
              {(mode === 'loading' || mode === 'searching') && <div className="flex h-72 flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-purple-100 text-unseen-700">{mode === 'loading' ? <LoaderCircle size={25} className="animate-spin" /> : <Sparkles size={25} className="animate-pulse" />}</span><h3 className="mt-4 font-grotesk text-xl font-bold">{mode === 'loading' ? 'Restoring your campus connection…' : 'Finding a campus ghost…'}</h3><p className="mt-2 max-w-sm text-sm text-muted">{mode === 'searching' ? 'We will match you as soon as another campus ghost is ready.' : 'Your public identity remains anonymous.'}</p>{mode === 'searching' && <button type="button" disabled={busy} onClick={() => void cancelSearch()} className="chip mt-5 rounded-full px-5 py-2.5 text-sm font-bold">Cancel search</button>}</div>}
              {mode === 'idle' && <div className="flex h-72 flex-col items-center justify-center text-center"><span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-purple-100 text-unseen-700"><CircleHelp size={25} /></span><h3 className="mt-4 font-grotesk text-xl font-bold">A fresh conversation, no introductions.</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">Get paired with another available campus ghost. Do not share your name, number, address, or social handle.</p><button type="button" disabled={busy} onClick={() => void start()} className="btn-primary mt-5 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold"><Sparkles size={16} /> Find someone</button></div>}
              {mode === 'matched' && partner && <><div className="mb-5 flex items-center justify-between rounded-2xl border border-soft bg-card p-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: partner.color }}>{partner.emoji}</span><div><p className="truncate text-sm font-bold">{partner.name}</p><p className={`text-[11px] font-medium ${chatReady && peerConnected ? 'text-emerald-700' : 'text-amber-700'}`}>Anonymous campus ghost · {chatReady ? peerConnected ? 'Connected' : 'Waiting for the other ghost…' : 'Reconnecting…'}</p></div></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void nextChat()} title="Next ghost" className="chip rounded-full px-3 py-2 text-xs font-bold">Next</button><button type="button" disabled={busy} onClick={() => void finish('block')} title="Block this ghost" className="chip flex h-9 w-9 items-center justify-center rounded-full text-rose-700"><Ban size={15} /><span className="sr-only">Block</span></button><button type="button" disabled={busy} onClick={() => void finish('end')} title="End chat" className="chip rounded-full px-3 py-2 text-xs font-bold">End</button></div></div>
                {personalInfoWarning && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><ShieldAlert size={16} className="mt-0.5 shrink-0" />Keep private details out of chat. Never share your phone number, address, real name, or social account.</div>}
                <div className="space-y-3">{messages.map((message, index) => <div key={message.clientMessageId ?? `${message.createdAt}:${message.senderId}:${index}`} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[86%] rounded-2xl px-4 py-3 ${message.mine ? 'rounded-br-md bg-purple-700 text-white' : 'rounded-bl-md border border-soft bg-card text-primary'}`}><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p><time className={`mt-1 block text-right text-[10px] ${message.mine ? 'text-purple-100' : 'text-faint'}`}>{message.mine && message.delivery === 'sending' ? 'Sending…' : formatIndiaTime(message.createdAt)}</time></div></div>)}{!messages.length && <p className="py-8 text-center text-xs font-medium text-muted">You are connected. Say hello 👋</p>}</div>
                </>}
            </div>
            {mode === 'matched' && <div className="border-t border-soft bg-card p-3 sm:p-4"><form onSubmit={(event) => void send(event)} className="flex gap-2"><label className="sr-only" htmlFor="random-chat-message">Message</label><input id="random-chat-message" maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy || !!pendingMessageId || !chatReady || !peerConnected} className="input-themed min-w-0 flex-1 rounded-full px-4 py-3 text-sm" placeholder={!chatReady ? 'Reconnecting…' : pendingMessageId ? 'Sending your message…' : peerConnected ? 'Write a message…' : 'Waiting for the other ghost…'} /><button type="submit" disabled={busy || !!pendingMessageId || !chatReady || !peerConnected || !draft.trim()} className="btn-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-50" aria-label="Send message"><Send size={17} /></button></form>{pendingSendStatus && <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium text-amber-800"><span>{pendingSendStatus === 'failed' ? 'Message is still on this device and has not been confirmed.' : pendingSendStatus === 'retrying' ? 'Reconnecting to deliver your message…' : 'Sending message…'}</span>{pendingSendStatus === 'failed' && <button type="button" disabled={busy} onClick={() => { pendingRetryAttemptsRef.current = 0; setPendingSendStatus('sending'); flushPendingMessageRef.current(); }} className="shrink-0 font-bold text-unseen-700">Retry</button>}</div>}<div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-medium text-muted"><span>Messages stay in this tab only and clear on refresh or disconnect.</span><button type="button" disabled={busy} onClick={() => setReportOpen(true)} className="inline-flex shrink-0 items-center gap-1 font-bold text-rose-700"><ShieldAlert size={13} /> Report</button></div></div>}
          </div>
        </>}
        <footer className="flex items-center justify-center gap-2 border-t border-soft px-4 py-3 text-[10px] font-medium text-muted"><Ban size={13} /> Be respectful. Block and report tools are available in every conversation.</footer>
      </section>
      {reportOpen && <div className="modal active z-[110]" role="presentation"><button type="button" className="modal-bg" onClick={() => { if (!busy) setReportOpen(false); }} aria-label="Close report form" /><section className="modal-card card z-[1] w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="random-report-title"><h3 id="random-report-title" className="font-grotesk text-xl font-bold">Report this conversation</h3><p className="mt-1 text-xs text-muted">Your reason and details go to moderators. Chat messages are not stored on the server.</p><form onSubmit={(event) => void submitReport(event)} className="mt-4 space-y-4"><label className="block text-xs font-bold">What happened?<select value={reportReason} onChange={(event) => setReportReason(event.target.value)} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3">{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label><label className="block text-xs font-bold">Details (optional)<textarea value={reportDetail} onChange={(event) => setReportDetail(event.target.value.slice(0, 1000))} rows={3} className="input-themed mt-1.5 w-full rounded-xl px-3 py-3" /></label><div className="flex gap-2"><button type="button" onClick={() => setReportOpen(false)} className="chip flex-1 rounded-full px-4 py-3 text-sm font-bold">Cancel</button><button type="submit" disabled={busy} className="flex-1 rounded-full bg-rose-700 px-4 py-3 text-sm font-bold text-white">Send report</button></div></form></section></div>}
    </div>
  );
}
