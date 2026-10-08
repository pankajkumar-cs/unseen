import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserFacingError } from '../lib/errors';
import { ChevronLeft, LoaderCircle, Share2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import { loadPostPage, toggleLike, type FeedCursor, type PostView } from '../services/feed';

const MEME_LIMIT = 32;
type SwipeDirection = 'left' | 'right';

interface MemeWallProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export function MemeWall({ onOpenAuth, onToast }: MemeWallProps) {
  const { profile } = useAuth();
  const [memes, setMemes] = useState<PostView[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState<SwipeDirection | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const pointerStart = useRef<{ x: number; y: number; axis: 'horizontal' | 'vertical' | null } | null>(null);
  const swipeLock = useRef(false);

  const loadMemes = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      let cursor: FeedCursor | null = null;
      const rows: PostView[] = [];
      do {
        const page = await loadPostPage('Memes', cursor, Math.min(20, MEME_LIMIT - rows.length));
        rows.push(...page.posts);
        cursor = page.posts.length >= 20 ? page.cursor : null;
      } while (cursor && rows.length < MEME_LIMIT);
      setMemes((current) => {
        const latest = reset ? rows : [...rows, ...current.filter((row) => !rows.some((fresh) => fresh.id === row.id))];
        return latest.slice(0, MEME_LIMIT);
      });
      if (reset) setIndex(0);
    } catch (cause) {
      onToast(getUserFacingError(cause, 'The Meme Wall could not load.'), 'error');
    } finally { setLoading(false); }
  }, [onToast]);

  useEffect(() => { void loadMemes(true); }, [loadMemes]);

  useRealtime((event) => {
    if (event.type === 'system:reconnected') { void loadMemes(true); return; }
    const id = event.payload.id;
    if (event.type === 'like:change' && typeof id === 'string' && typeof event.payload.likes === 'number') {
      setMemes((current) => current.map((post) => post.id === id ? { ...post, likes: event.payload.likes as number } : post));
      return;
    }
    if ((event.type === 'post:deleted' || event.type === 'post:moderated') && typeof id === 'string') {
      setMemes((current) => current.filter((post) => post.id !== id));
      return;
    }
    if (event.type === 'post:new' && event.payload.cat === 'Memes') void loadMemes();
    if (event.type === 'post:updated' && typeof id === 'string' && event.payload.status === 'approved') {
      setMemes((current) => current.map((post) => post.id === id && typeof event.payload.imagePath === 'string'
        ? { ...post, imagePath: event.payload.imagePath as string, imageUrl: null }
        : post));
    }
  });

  const advance = (direction: SwipeDirection) => {
    const current = memes[index];
    if (!current || swipeLock.current) return;
    if (direction === 'right' && !profile?.isRegistered) { onOpenAuth('login'); return; }
    swipeLock.current = true;
    setSwiping(direction);
    if (direction === 'right' && !current.liked) {
      void toggleLike(current.id, true).catch((cause: unknown) => {
        onToast(getUserFacingError(cause, 'The meme could not be liked.'), 'error');
      });
    }
    window.setTimeout(() => {
      setIndex((value) => value + 1);
      setSwiping(null);
      swipeLock.current = false;
    }, 420);
  };

  const share = async (post: PostView) => {
    const url = `https://unseen-dec.in/p/${encodeURIComponent(post.id)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'UNSEEN campus meme', url });
      else { await navigator.clipboard.writeText(url); onToast('Meme link copied.', 'success'); }
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) onToast(getUserFacingError(cause, 'Could not share this meme.'), 'error');
    }
  };

  const top = memes[index];
  const totalLikes = memes.reduce((sum, meme) => sum + meme.likes, 0);
  const swipedCount = Math.min(index, memes.length);
  const restart = () => { setIndex(0); setSwiping(null); };

  return (
    <section aria-labelledby="meme-wall-title" className="overflow-hidden border-y border-soft bg-lav py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><div className="text-xs font-bold tracking-[.2em] text-unseen-600">😂 MEME WALL · SWIPE MODE</div><h2 id="meme-wall-title" className="mt-2 font-grotesk text-3xl font-bold tracking-tight sm:text-[42px]">DEC Meme Wall — <span className="grad-text">swipe karo, haso, repeat.</span></h2><p className="mt-1 text-sm font-medium text-muted">Drag cards left to skip, right to LOL. Campus memes are real student posts.</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => advance('left')} disabled={!top || Boolean(swiping)} aria-label="Skip meme" className="flex h-12 w-12 items-center justify-center rounded-full border border-soft bg-card text-xl shadow-sm transition hover:scale-105 disabled:opacity-40"><ChevronLeft size={22} /><span className="sr-only">Skip</span></button>
            <button type="button" onClick={() => advance('right')} disabled={!top || Boolean(swiping)} aria-label={profile?.isRegistered ? 'Like meme' : 'Sign in to like meme'} className="btn-primary flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg transition hover:scale-105 disabled:opacity-40">🤣</button>
            <button type="button" onClick={() => top ? void share(top) : onToast('No meme to share yet.', 'info')} aria-label="Share current meme" className="flex h-12 w-12 items-center justify-center rounded-full border border-soft bg-card shadow-sm transition hover:scale-105"><Share2 size={19} /></button>
          </div>
        </div>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[380px_1fr]">
          <div>
            <div className="relative mx-auto h-[520px] max-w-[380px]" aria-live="polite">
              {loading && !memes.length && <div className="card flex h-full items-center justify-center gap-2 text-sm text-muted"><LoaderCircle size={18} className="animate-spin" /> Loading real campus memes…</div>}
              {!loading && !memes.length && <div className="card flex h-full flex-col items-center justify-center p-10 text-center"><div className="text-6xl">😂</div><div className="mt-3 font-grotesk text-xl font-bold">No memes yet</div><p className="mt-1 text-sm text-muted">The wall fills up when real campus posts arrive.</p></div>}
              {memes.length > 0 && index >= memes.length && <div className="card flex h-full flex-col items-center justify-center p-10 text-center"><div className="text-6xl">🏁</div><div className="mt-3 font-grotesk text-xl font-bold">You’ve seen every meme</div><button type="button" onClick={restart} className="btn-primary mt-4 rounded-full px-6 py-2.5 text-sm font-bold">↻ Replay Wall</button></div>}
              {memes.slice(index, index + 3).map((meme, offset) => <article
                key={meme.id}
                className={`meme-card card overflow-hidden ${offset === 0 && swiping ? `meme-swipe-${swiping}` : ''}`}
                style={{ zIndex: 10 - offset, transform: offset ? `translateY(${offset * 14}px) scale(${1 - offset * 0.05})` : dragOffset ? `translate(${dragOffset}px, ${Math.abs(dragOffset) * 0.08}px) rotate(${dragOffset * 0.06}deg)` : undefined, opacity: offset ? 1 - offset * 0.25 : undefined }}
                onPointerDown={(event) => {
                  if (offset === 0 && event.isPrimary && event.button === 0) {
                    pointerStart.current = { x: event.clientX, y: event.clientY, axis: null };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }
                }}
                onPointerMove={(event) => {
                  const start = pointerStart.current;
                  if (offset !== 0 || !start) return;
                  const deltaX = event.clientX - start.x;
                  const deltaY = event.clientY - start.y;
                  if (!start.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8) {
                    start.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
                  }
                  setDragOffset(start.axis === 'horizontal' ? deltaX : 0);
                }}
                onPointerUp={(event) => {
                  const start = pointerStart.current;
                  if (offset !== 0 || !start) return;
                  const deltaX = event.clientX - start.x;
                  const deltaY = event.clientY - start.y;
                  pointerStart.current = null;
                  setDragOffset(0);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  const horizontalSwipe = start.axis === 'horizontal'
                    || (!start.axis && Math.abs(deltaX) > 110 && Math.abs(deltaX) > Math.abs(deltaY));
                  if (!horizontalSwipe) return;
                  if (deltaX > 110) advance('right'); else if (deltaX < -110) advance('left');
                }}
                onPointerCancel={(event) => { pointerStart.current = null; setDragOffset(0); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
              >
                <div className="relative h-[300px] overflow-hidden">
                  {meme.imageUrl && !brokenImages[meme.id] && <img src={meme.imageUrl} alt="Campus meme" loading="lazy" className="h-full w-full object-cover" onLoad={() => setBrokenImages((current) => ({ ...current, [meme.id]: false }))} onError={() => setBrokenImages((current) => ({ ...current, [meme.id]: true }))} />}
                  {(!meme.imageUrl || brokenImages[meme.id]) && <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-700 to-pink-500 p-8 text-center font-grotesk text-2xl font-bold text-white">{meme.body}</div>}
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50" />
                  <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold">😂 DEC MEME</span>
                  <span className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl">😂</span>
                  <div className="absolute bottom-3 left-4 right-4 font-grotesk text-lg font-bold leading-tight text-white">{meme.authorName}</div>
                  {offset === 0 && swiping && <div className={`absolute inset-0 flex items-center justify-center font-grotesk text-3xl font-bold ${swiping === 'right' ? 'bg-emerald-500/25 text-emerald-950' : 'bg-rose-500/25 text-rose-950'}`}>{swiping === 'right' ? 'LIKE' : 'SKIP'}</div>}
                </div>
                <div className="p-4"><p className="line-clamp-3 text-[13px] font-semibold text-muted">“{meme.body}”</p><div className="mt-3 flex items-center justify-between"><span className="text-xs font-bold text-muted">🔥 {meme.likes} likes</span>{offset === 0 && <span className="text-[11px] font-bold text-faint">← DRAG TO SWIPE →</span>}</div></div>
              </article>)}
            </div>
            <div className="mx-auto mt-4 max-w-[380px]"><div className="mb-2 flex justify-between text-[11px] font-bold text-muted"><span>{memes.length ? `${Math.min(index + 1, memes.length)} / ${memes.length}` : '0 / 0'}</span><span>🔥 {totalLikes} community likes</span></div><div className="h-2 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-500 transition-[width] duration-500" style={{ width: `${memes.length ? (swipedCount / memes.length) * 100 : 0}%` }} /></div></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {!loading && !memes.length && <div className="card p-8 text-center sm:col-span-2"><div className="text-4xl">🫥</div><div className="mt-2 font-grotesk font-bold">Waiting for the first campus meme</div><p className="mt-1 text-sm text-muted">Real submissions will appear here.</p></div>}
            {memes.slice(0, 4).map((meme) => <article key={meme.id} className="card overflow-hidden">
              <div className="relative h-40 overflow-hidden">{meme.imageUrl && !brokenImages[meme.id] ? <img src={meme.imageUrl} loading="lazy" alt="Campus meme" className="h-full w-full object-cover" onLoad={() => setBrokenImages((current) => ({ ...current, [meme.id]: false }))} onError={() => setBrokenImages((current) => ({ ...current, [meme.id]: true }))} /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-purple-700 to-pink-500 p-5 text-center font-bold text-white">{meme.body}</div>}</div>
              <div className="p-4"><div className="font-grotesk text-sm font-bold">{meme.authorName}</div><div className="mt-0.5 line-clamp-2 text-xs font-medium text-muted">{meme.body}</div><div className="mt-2.5 flex items-center justify-between"><span className="text-[11px] font-bold text-muted">🔥 {meme.likes}</span><button type="button" onClick={() => void share(meme)} className="text-[11px] font-bold text-unseen-600">SHARE →</button></div></div>
            </article>)}
          </div>
        </div>
      </div>
    </section>
  );
}
