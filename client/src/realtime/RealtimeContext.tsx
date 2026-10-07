import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { requireSupabase } from '../lib/supabase';

export interface RealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
}

type RealtimeListener = (event: RealtimeEvent) => void;
interface RealtimeContextValue {
  subscribe: (listener: RealtimeListener) => () => void;
  publish: (event: RealtimeEvent) => void;
}
const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const OnlineCountContext = createContext<number | null | undefined>(undefined);

const publicEvents = [
  'post:new', 'post:updated', 'post:deleted', 'post:moderated',
  'comment:new', 'comment:updated', 'comment:deleted', 'like:change',
  'poll:new', 'poll:update', 'poll:deleted', 'crush:new', 'crush:update', 'crush:deleted',
];

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Set<RealtimeListener>());
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  const publish = useCallback((event: RealtimeEvent) => {
    listeners.current.forEach((listener) => {
      try { listener(event); } catch { /* One subscriber should not interrupt the others. */ }
    });
  }, []);

  useEffect(() => {
    const client = requireSupabase();
    let channel = client.channel('unseen:feed', { config: { private: false, broadcast: { self: false } } });
    channel = channel.on('presence', { event: 'sync' }, () => {
      setOnlineCount(Object.keys(channel.presenceState()).length);
    });
    for (const eventName of publicEvents) {
      channel = channel.on('broadcast', { event: eventName }, (message) => {
        const payload = message.payload;
        if (!payload || typeof payload !== 'object') return;
        publish({ type: eventName, payload: payload as Record<string, unknown> });
      });
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel.track({ active: true }).then((result) => {
          if (result !== 'ok') setOnlineCount(null);
        }).catch(() => setOnlineCount(null));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setOnlineCount(null);
      }
    });
    return () => {
      setOnlineCount(null);
      void client.removeChannel(channel);
    };
  }, [publish]);

  const subscribe = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const value = useMemo(() => ({ subscribe, publish }), [publish, subscribe]);
  return (
    <RealtimeContext.Provider value={value}>
      <OnlineCountContext.Provider value={onlineCount}>{children}</OnlineCountContext.Provider>
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
