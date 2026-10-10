import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requireSupabase } from '../lib/supabase';

export interface RealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
}

export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

type RealtimeListener = (event: RealtimeEvent) => void;
interface RealtimeContextValue {
  subscribe: (listener: RealtimeListener) => () => void;
  publish: (event: RealtimeEvent) => void;
}
const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const OnlineCountContext = createContext<number | null | undefined>(undefined);
const RealtimeStatusContext = createContext<RealtimeConnectionStatus | undefined>(undefined);

const publicEvents = [
  'post:new', 'post:updated', 'post:deleted', 'post:moderated',
  'comment:new', 'comment:updated', 'comment:deleted', 'like:change',
  'poll:new', 'poll:update', 'poll:deleted', 'crush:new', 'crush:update', 'crush:deleted', 'crush:moderated',
];

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<RealtimeListener>());
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('connecting');

  const publish = useCallback((event: RealtimeEvent) => {
    listeners.current.forEach((listener) => {
      try { listener(event); } catch { /* One subscriber should not interrupt the others. */ }
    });
  }, []);

  useEffect(() => {
    const client = requireSupabase();
    let active = true;
    let hasConnected = false;
    let feedChannel = client.channel('unseen:feed', { config: { private: true, broadcast: { self: false } } });
    for (const eventName of publicEvents) {
      feedChannel = feedChannel.on('broadcast', { event: eventName }, (message) => {
        const payload = message.payload;
        if (!payload || typeof payload !== 'object') return;
        publish({ type: eventName, payload: payload as Record<string, unknown> });
      });
    }
    const presenceChannel = client.channel('unseen:presence', { config: { private: false } })
      .on('presence', { event: 'sync' }, () => {
        if (active) setOnlineCount(Object.keys(presenceChannel.presenceState()).length);
      });

    feedChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (!active) return;
        setConnectionStatus('connected');
        if (hasConnected) publish({ type: 'system:reconnected', payload: {} });
        hasConnected = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (active) setConnectionStatus('reconnecting');
      }
    });

    presenceChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (!active) return;
        void presenceChannel.track({ active: true }).then((result) => {
          if (active && result !== 'ok') setOnlineCount(null);
        }).catch(() => { if (active) setOnlineCount(null); });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (active) setOnlineCount(null);
      }
    });

    return () => {
      active = false;
      setOnlineCount(null);
      setConnectionStatus('connecting');
      void Promise.all([client.removeChannel(feedChannel), client.removeChannel(presenceChannel)]);
    };
  }, [publish]);

  const subscribe = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const value = useMemo(() => ({ subscribe, publish }), [publish, subscribe]);
  return (
    <RealtimeContext.Provider value={value}>
      <RealtimeStatusContext.Provider value={connectionStatus}>
        <OnlineCountContext.Provider value={onlineCount}>{children}</OnlineCountContext.Provider>
      </RealtimeStatusContext.Provider>
    </RealtimeContext.Provider>
  );
}

export function useRealtime(subscriber: RealtimeListener) {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used within RealtimeProvider.');
  const current = useRef(subscriber);
  current.current = subscriber;
  useEffect(() => context.subscribe((event) => current.current(event)), [context]);
}

export function usePublishRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('usePublishRealtime must be used within RealtimeProvider.');
  return context.publish;
}

export function useOnlineCount() {
  const onlineCount = useContext(OnlineCountContext);
  if (onlineCount === undefined) throw new Error('useOnlineCount must be used within RealtimeProvider.');
  return onlineCount;
}

export function useRealtimeStatus() {
  const status = useContext(RealtimeStatusContext);
  if (status === undefined) throw new Error('useRealtimeStatus must be used within RealtimeProvider.');
  return status;
}
