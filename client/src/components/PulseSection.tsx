import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '../realtime/RealtimeContext';
import { loadPulseStats } from '../services/community';
import { loadPostPage, type PostView } from '../services/feed';

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface PulseStats {
  secrets_today: number;
  confessions: number;
  memes: number;
  rants: number;
  spotted: number;
  total_secrets: number;
}

interface PulseSectionProps { onCreatePost: () => void }

export function PulseSection({ onCreatePost }: PulseSectionProps) {
  const [stats, setStats] = useState<PulseStats | null>(null);
  const [recent, setRecent] = useState<PostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('just now');
  const refresh = useCallback(async (withRecent = false) => {
    const [nextStats, nextPosts] = await Promise.all([
      loadPulseStats(),
      withRecent ? loadPostPage(null, null, 4) : Promise.resolve(null),
    ]);
    setStats(nextStats);
    if (nextPosts) setRecent(nextPosts.posts);
    setUpdatedAt('just now');
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(true).catch(() => setLoading(false)); }, [refresh]);
  useRealtime((event) => {
    if (event.type === 'post:new') void refresh(true).catch(() => undefined);
    else if (event.type === 'post:deleted' || event.type === 'post:moderated' || event.type === 'crush:new' || event.type === 'crush:deleted') {
      void refresh(false).catch(() => undefined);
    }
  });

  const cards = [
    { name: 'Confessions', emoji: '💜', value: stats?.confessions ?? 0, colors: ['#6D28D9', '#4C1D95'], labelColor: 'var(--pulse-purple-label)', background: 'var(--pulse-purple-surface)', description: 'Share what you cannot say out loud.' },
    { name: 'Memes', emoji: '😂', value: stats?.memes ?? 0, colors: ['#92400E', '#78350F'], labelColor: 'var(--pulse-amber-label)', background: 'var(--pulse-amber-surface)', description: 'Fresh campus humour from students.' },
    { name: 'Rants', emoji: '🌩️', value: stats?.rants ?? 0, colors: ['#B91C1C', '#9F1239'], labelColor: 'var(--pulse-rose-label)', background: 'var(--pulse-rose-surface)', description: 'Vent safely. Keep it respectful.' },
    { name: 'Spotted', emoji: '👀', value: stats?.spotted ?? 0, colors: ['#0369A1', '#075985'], labelColor: 'var(--pulse-sky-label)', background: 'var(--pulse-sky-surface)', description: 'Campus moments and harmless hints.' },
  ];
  const recentEmoji: Record<string, string> = { Confessions: '💜', Memes: '😂', Rants: '🌩️', Spotted: '👀', Placements: '🎓' };

  return (
    <section id="pulse" className="mx-auto max-w-7xl px-4 pb-6 pt-14 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold tracking-[.2em] text-unseen-600"><span className="live-dot h-2 w-2 rounded-full bg-green-500" /> LIVE PULSE</div><h2 className="mt-2 font-grotesk text-3xl font-bold tracking-tight sm:text-[42px]">Aaj Campus Mein <span className="grad-text">⚡</span></h2><p className="mt-1 text-sm font-medium text-muted">Real-time kya chal raha hai DEC mein — confessions, rants, spotted posts & memes.</p></div>
        <div className="flex items-center gap-2"><span className="rounded-full border border-soft bg-card px-4 py-2 text-xs font-bold text-muted">Updated <span className="text-base text-primary">{updatedAt}</span></span></div>
      </div>
      {loading && <div className="mt-6 text-sm text-muted">Checking the campus pulse…</div>}
      {!loading && <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{cards.map((card) => <a key={card.name} href={card.name === 'Spotted' ? '#crush' : `#explore`} className="card group cursor-pointer p-4 sm:p-5" style={{ background: `linear-gradient(135deg,var(--surface),${card.background})` }}>
        <div className="flex items-center justify-between"><span className="text-2xl">{card.emoji}</span><span className="rounded-full px-2 py-1 text-[10px] font-bold text-white" style={{ background: `linear-gradient(135deg,${card.colors[0]},${card.colors[1]})` }}>{card.value} today</span></div>
        <div className="mt-2 font-grotesk text-2xl font-bold sm:text-3xl">{card.value.toLocaleString()}</div><div className="mt-0.5 text-xs font-bold tracking-widest" style={{ color: card.labelColor }}>{card.name.toUpperCase()}</div><div className="mt-2.5 truncate text-[11px] font-semibold text-muted">{card.description}</div>
      </a>)}</div>}
      <div className="card mt-4 flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex shrink-0 items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl text-white" style={{ background: 'linear-gradient(135deg,#F59E0B,#EF4444)' }}>🔥</div><div><div className="font-grotesk text-sm font-bold">Recent campus posts</div><div className="text-xs font-medium text-muted">Latest approved posts from the campus feed</div></div></div>
        <div className="flex w-full flex-1 flex-col gap-1.5 overflow-hidden text-[13px] font-medium">
          {recent.length ? recent.map((post) => <a key={post.id} href={`#post-${post.id}`} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-soft bg-soft p-2"><span>{recentEmoji[post.category] ?? '👻'}</span><span className="min-w-0 flex-1 truncate">{post.body}</span><time dateTime={post.createdAt} className="shrink-0 text-[11px] font-bold text-faint">{relativeTime(post.createdAt)}</time></a>) : !loading ? <div className="rounded-xl border border-soft bg-soft p-2 text-muted">No activity yet. Your campus can start the conversation.</div> : null}
        </div>
        <button type="button" onClick={onCreatePost} className="btn-primary shrink-0 rounded-full px-5 py-2.5 text-xs font-bold">Join the buzz +</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2 text-[11px] font-bold tracking-widest text-muted">
        <span><b className="font-grotesk text-xl text-primary">{stats?.total_secrets.toLocaleString() ?? '—'}</b><br />SECRETS DROPPED</span>
        <span><b className="font-grotesk text-xl text-primary">{stats?.secrets_today.toLocaleString() ?? '—'}</b><br />SECRETS TODAY</span>
        <span><b className="font-grotesk text-xl text-primary">100%</b><br />ANONYMOUS</span>
      </div>
    </section>
  );
}
