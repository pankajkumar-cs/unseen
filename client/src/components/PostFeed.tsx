import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { getUserFacingError } from '../lib/errors';
import { formatRelativeIndiaTime } from '../lib/dates';
import { Bookmark, Flag, Heart, ImageOff, LoaderCircle, MapPin, MessageCircle, Send, Share2, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ReportDialog } from './ReportDialog';
import { usePublishRealtime, useRealtime } from '../realtime/RealtimeContext';
import { createComment, deleteOwnPost, loadComments, loadPostById, loadPostPage, loadSavedPosts, postDeepLink, refreshSignedImageUrl, removeComment, submitReport, toggleBookmark, toggleLike, type CommentView, type FeedCursor, type PostView } from '../services/feed';
import type { PostCategory } from '../types/database';

const categories: Array<{ name: string; value: PostCategory | null; emoji: string }> = [
  { name: 'All', value: null, emoji: '✨' },
  { name: 'Confessions', value: 'Confessions', emoji: '💜' },
  { name: 'Memes', value: 'Memes', emoji: '😂' },
  { name: 'Rants', value: 'Rants', emoji: '🌩️' },
  { name: 'Spotted', value: 'Spotted', emoji: '👀' },
];

function decodeURIComponentSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

const EMPTY_INTERACTION: PostInteractionState = { commentsLoaded: false, commentsOpen: false, comments: [], commentText: '' };

interface PostFeedProps {
  searchTerm: string;
  category: PostCategory | null;
  refreshKey: number;
  onCategoryChange: (value: PostCategory | null) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onCreatePost: () => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

interface PostInteractionState {
  commentsLoaded: boolean;
  commentsOpen: boolean;
  comments: CommentView[];
  commentText: string;
}

export function PostFeed({ searchTerm, category, refreshKey, onCategoryChange, onOpenAuth, onCreatePost, onToast }: PostFeedProps) {
  const [posts, setPosts] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedView, setSavedView] = useState(false);
  const [interactionByPost, setInteractionByPost] = useState<Record<string, PostInteractionState>>({});
  const sentinel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const loadMoreGeneration = useRef(0);
  const loadingMoreRef = useRef(false);
  const deepLinkScrolled = useRef<string | null>(null);
  const { profile } = useAuth();

  const selectCategory = (value: PostCategory | null) => {
    setSavedView(false);
    onCategoryChange(value);
  };

  const loadFirstPage = useCallback(async () => {
    const requestId = ++generation.current;
    loadMoreGeneration.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    setPosts([]);
    setCursor(null);
    setHasMore(!savedView);
    try {
      if (savedView) {
        if (!profile?.isRegistered) {
          setPosts([]);
          setHasMore(false);
          return;
        }
        const saved = await loadSavedPosts();
        if (requestId !== generation.current) return;
        setPosts(saved);
        return;
      }
      const page = await loadPostPage(category, null);
      if (requestId !== generation.current) return;
      let initialPosts = page.posts;
      const deepLink = window.location.hash.match(/^#post-(.+)$/)?.[1];
      if (deepLink) {
        try {
          const linkedPost = await loadPostById(decodeURIComponent(deepLink));
          if (requestId !== generation.current) return;
          if (linkedPost && !initialPosts.some((post) => post.id === linkedPost.id)) initialPosts = [linkedPost, ...initialPosts];
        } catch { /* Keep the feed usable if an old or malformed share link cannot resolve. */ }
      }
      setPosts(initialPosts);
      setCursor(page.cursor);
      setHasMore(page.posts.length === 20);
    } catch (cause: unknown) {
      if (requestId === generation.current) setError(getUserFacingError(cause, 'The campus feed could not load.'));
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, [category, profile?.isRegistered, savedView]);

  useEffect(() => {
    void loadFirstPage();
    return () => { generation.current += 1; };
  }, [loadFirstPage, refreshKey]);

  useEffect(() => {
    const linkedId = window.location.hash.match(/^#post-(.+)$/)?.[1];
    if (!linkedId || loading || !posts.some((post) => post.id === decodeURIComponentSafe(linkedId))) return;
    const postId = decodeURIComponentSafe(linkedId);
    if (deepLinkScrolled.current === postId) return;
    deepLinkScrolled.current = postId;
    const timer = window.setTimeout(() => document.getElementById(`post-${postId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => window.clearTimeout(timer);
  }, [loading, posts]);

  const loadMore = useCallback(async () => {
    if (savedView || !hasMore || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const moreRequestId = ++loadMoreGeneration.current;
    setLoadingMore(true);
    const requestId = generation.current;
    try {
      const page = await loadPostPage(category, cursor);
      if (requestId !== generation.current) return;
      setPosts((current) => {
        const known = new Set(current.map((post) => post.id));
        return [...current, ...page.posts.filter((post) => !known.has(post.id))];
      });
      setCursor(page.cursor);
      setHasMore(page.posts.length === 20);
    } catch (cause) {
      onToast(getUserFacingError(cause, 'More posts could not load.'), 'error');
    } finally {
      if (moreRequestId === loadMoreGeneration.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [category, cursor, hasMore, onToast, savedView]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || savedView || !hasMore || loading || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: '600px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore, savedView]);

  useRealtime((event) => {
    if (event.type === 'system:reconnected') {
      void loadFirstPage();
      return;
    }
    if (event.type === 'like:change') {
      const id = event.payload.id;
      const likes = event.payload.likes;
      if (typeof id === 'string' && typeof likes === 'number') {
        setPosts((current) => current.map((post) => post.id === id ? { ...post, likes } : post));
      }
      return;
    }
    if (event.type === 'post:deleted') {
      const id = event.payload.id;
      if (typeof id === 'string') setPosts((current) => current.filter((post) => post.id !== id));
      return;
    }
    if (event.type === 'comment:new' || event.type === 'comment:deleted' || event.type === 'comment:updated') {
      const postId = event.payload.postId;
      const commentsCount = event.payload.commentsCount;
      if (typeof postId === 'string' && typeof commentsCount === 'number' && Number.isFinite(commentsCount)) {
        setPosts((current) => current.map((post) => post.id === postId ? { ...post, commentsCount: Math.max(0, commentsCount) } : post));
      }
      return;
    }
    if (!['post:new', 'post:updated', 'post:moderated'].includes(event.type)) return;
    const id = event.payload.id;
    const status = event.payload.status;
    if (typeof id !== 'string') return;
    if (typeof status === 'string' && status !== 'approved') {
      setPosts((current) => current.filter((post) => post.id !== id));
      return;
    }
    if (event.type === 'post:updated') {
      const hasImagePath = Object.prototype.hasOwnProperty.call(event.payload, 'imagePath');
      const imagePath = typeof event.payload.imagePath === 'string' ? event.payload.imagePath : null;
      const allowed: Partial<PostView> = {};
      if (typeof event.payload.content === 'string') allowed.body = event.payload.content;
      if (typeof event.payload.likes === 'number' && Number.isFinite(event.payload.likes)) allowed.likes = Math.max(0, event.payload.likes);
      if (typeof event.payload.commentsCount === 'number' && Number.isFinite(event.payload.commentsCount)) allowed.commentsCount = Math.max(0, event.payload.commentsCount);
      if (hasImagePath) allowed.imagePath = imagePath;
      if (Object.keys(allowed).length) setPosts((current) => current.map((post) => post.id === id ? { ...post, ...allowed, ...(imagePath === null && hasImagePath ? { imageUrl: null } : {}) } : post));
      if (imagePath) {
        void refreshSignedImageUrl(imagePath).then((imageUrl) => setPosts((current) => current.map((post) => post.id === id && post.imagePath === imagePath ? { ...post, imageUrl } : post))).catch(() => undefined);
      }
      return;
    }
    if (savedView || !['post:new', 'post:moderated'].includes(event.type)) return;
    void loadPostById(id).then((incoming) => {
      if (!incoming || (category && incoming.category !== category)) return;
      setPosts((current) => current.some((post) => post.id === incoming.id)
        ? current.map((post) => post.id === incoming.id ? { ...post, body: incoming.body, likes: incoming.likes, commentsCount: incoming.commentsCount, imagePath: incoming.imagePath, imageUrl: incoming.imageUrl } : post)
        : [incoming, ...current]);
    }).catch(() => undefined);
  });

  const onPostUpdate = (id: string, change: Partial<PostView>) => {
    setPosts((current) => current.filter((post) => !(savedView && change.bookmarked === false && post.id === id)).map((post) => post.id === id ? { ...post, ...change } : post));
  };
  const updateInteraction = (id: string, change: Partial<PostInteractionState>) => {
    setInteractionByPost((current) => {
      const next = { ...current };
      delete next[id];
      next[id] = { ...EMPTY_INTERACTION, ...(current[id] ?? {}), ...change };
      const keys = Object.keys(next);
      if (keys.length > 100) delete next[keys[0]];
      return next;
    });
  };

  const visiblePosts = posts.filter((post) => !searchTerm.trim() || `${post.category} ${post.body}`.toLocaleLowerCase().includes(searchTerm.trim().toLocaleLowerCase()));

  return (
    <section id="explore" className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="text-xs font-bold tracking-[.2em] text-unseen-600">EXPLORE FEED</div><h2 className="mt-2 font-grotesk text-3xl font-bold tracking-tight sm:text-[42px]">Campus ki <span className="grad-text">awaaz</span>, bina naam.</h2></div>
        <button type="button" onClick={onCreatePost} className="btn-primary flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold"><Send size={15} /> Confess anonymously</button>
      </div>
      <div className="feed-category-scroll mt-5 flex snap-x snap-mandatory gap-2 pb-2 sm:mt-6" role="group" aria-label="Filter posts by category">
        <button type="button" onClick={() => { if (!profile?.isRegistered) { onOpenAuth('login'); return; } setSavedView((value) => !value); }} aria-pressed={savedView} className={`chip min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] font-bold transition-colors ${savedView ? 'feed-category-active' : ''}`}>🔖 Saved</button>
        {categories.map((item) => {
          const active = !savedView && category === item.value;
          return <button key={item.name} type="button" onClick={() => selectCategory(item.value)} aria-pressed={active} className={`chip min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] font-bold transition-colors ${active ? 'feed-category-active' : ''}`}>{item.emoji} {item.name}</button>;
        })}
      </div>
      {searchTerm.trim() && <p className="mt-2 text-xs text-muted">Search checks posts currently loaded in this feed.</p>}
      {error && <div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <div className="feed-two-col mt-4">
        <div className="masonry min-w-0" aria-live="polite" aria-busy={loading}>
          {loading && Array.from({ length: 3 }, (_, index) => <div key={index} className="card mb-5 h-64 animate-pulse p-5"><div className="skeleton h-9 w-36 rounded-full" /><div className="skeleton mt-5 h-4 w-full rounded" /><div className="skeleton mt-3 h-4 w-3/4 rounded" /><div className="skeleton mt-8 h-20 w-full rounded-2xl" /></div>)}
          {!loading && visiblePosts.length > 0 && <Virtuoso
            data={visiblePosts}
            useWindowScroll
            defaultItemHeight={360}
            increaseViewportBy={{ top: 500, bottom: 900 }}
            computeItemKey={(_index, post) => post.id}
            itemContent={(_index, post) => <div className="pb-5"><PostCard post={post} profile={profile} interaction={interactionByPost[post.id] ?? EMPTY_INTERACTION} updateInteraction={(change) => updateInteraction(post.id, change)} onPostUpdate={onPostUpdate} onDeletePost={(id) => setPosts((current) => current.filter((item) => item.id !== id))} onOpenAuth={onOpenAuth} onToast={onToast} /></div>}
          />}
          {!loading && !visiblePosts.length && <div className="card p-10 text-center"><div className="text-5xl">👻</div><div className="mt-3 font-grotesk text-xl font-bold">{searchTerm ? 'No secrets found' : 'No secrets here yet'}</div><p className="mt-1 text-sm text-muted">{searchTerm ? 'Try another search, or share your own story.' : 'Be the first ghost to share something with campus.'}</p><button type="button" onClick={onCreatePost} className="btn-primary mt-5 rounded-full px-6 py-2.5 text-sm font-bold">+ Confess anonymously</button></div>}
          <div ref={sentinel} className="h-1" aria-hidden="true" />
          {!loading && loadingMore && <div className="flex justify-center py-6 text-unseen-700"><LoaderCircle size={22} className="animate-spin" aria-label="Loading more posts" /></div>}
          {!loading && !savedView && !hasMore && visiblePosts.length > 0 && <p className="py-6 text-center text-xs font-semibold text-faint">You’re all caught up.</p>}
        </div>
        <aside className="hidden flex-col gap-4 lg:flex">
          <div className="card p-5">
            <div className="text-xs font-bold tracking-[.17em] text-unseen-600">CAMPUS GUIDELINES</div>
            <h3 className="mt-2 font-grotesk text-lg font-bold">Keep it anonymous. Keep it kind.</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">Share your campus stories without names, private details, or personal contact information. Posts stay up for seven days.</p>
          </div>
          <div className="card p-5" id="meme-wall-shortcut">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-xl">😂</div><div><div className="font-grotesk font-bold">Meme Wall</div><div className="text-xs text-muted">The campus laugh track</div></div></div>
            <button type="button" onClick={() => { selectCategory('Memes'); document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' }); }} className="chip mt-4 w-full rounded-full px-4 py-2 text-xs font-bold">Explore memes ↓</button>
          </div>
          <div className="rounded-[24px] border border-soft p-5" style={{ background: 'linear-gradient(135deg,var(--surface),var(--bg2))' }}>
            <div className="text-xs font-bold tracking-[.17em] text-unseen-600">100% ANONYMOUS</div><p className="mt-2 font-grotesk text-lg font-bold">Your identity stays hidden. Your voice doesn’t.</p><p className="mt-2 text-xs leading-relaxed text-muted">The name on your posts is your campus ghost profile, never your username.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
interface PostCardProps {
  post: PostView;
  profile: ReturnType<typeof useAuth>['profile'];
  onPostUpdate: (id: string, change: Partial<PostView>) => void;
  onDeletePost: (id: string) => void;
  interaction: PostInteractionState;
  updateInteraction: (change: Partial<PostInteractionState>) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

function PostCard({ post, profile, interaction, updateInteraction, onPostUpdate, onDeletePost, onOpenAuth, onToast }: PostCardProps) {
  const { commentsOpen, comments, commentText, commentsLoaded } = interaction;
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadFailed, setCommentsLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment' | 'account'; id: string | null } | null>(null);
  const publishRealtime = usePublishRealtime();
  const lock = useRef(false);
  const bookmarkLock = useRef(false);
  const refreshAttemptedUrl = useRef<string | null>(null);

  useEffect(() => {
    setImageBroken(false);
    refreshAttemptedUrl.current = null;
  }, [post.imagePath]);

  useEffect(() => {
    if (!imageOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImageOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [imageOpen]);

  useEffect(() => {
    if (!commentsOpen || commentsLoaded || commentsLoading || commentsLoadFailed) return;
    setCommentsLoading(true);
    void loadComments(post.id).then((nextComments) => {
      setCommentsLoadFailed(false);
      updateInteraction({ comments: nextComments, commentsLoaded: true });
    }).catch((cause: unknown) => {
      setCommentsLoadFailed(true);
      updateInteraction({ commentsLoaded: false });
      onToast(getUserFacingError(cause, 'Comments could not load.'), 'error');
    }).finally(() => setCommentsLoading(false));
  }, [commentsOpen, commentsLoaded, commentsLoading, commentsLoadFailed, post.id, onToast, updateInteraction]);

  useRealtime((event) => {
    const postId = event.payload.postId;
    if (postId !== post.id) return;
    if (event.type === 'comment:new' && event.payload.status === 'approved') {
      const id = event.payload.id;
      if (typeof id !== 'string' || typeof event.payload.text !== 'string') return;
      const item: CommentView = {
        id,
        authorName: typeof event.payload.author === 'string' ? event.payload.author : 'Anonymous Ghost',
        authorEmoji: typeof event.payload.emoji === 'string' ? event.payload.emoji : '👻',
        body: event.payload.text,
        createdAt: typeof event.payload.createdAt === 'string' ? event.payload.createdAt : new Date().toISOString(),
        mine: false,
      };
      updateInteraction({ commentsLoaded: true, comments: comments.some((comment) => comment.id === id) ? comments : [...comments, item] });
      if (typeof event.payload.commentsCount === 'number') onPostUpdate(post.id, { commentsCount: Math.max(0, event.payload.commentsCount) });
    } else if (event.type === 'comment:deleted') {
      const id = event.payload.id;
      if (typeof id === 'string') updateInteraction({ comments: comments.filter((comment) => comment.id !== id) });
      if (typeof event.payload.commentsCount === 'number') onPostUpdate(post.id, { commentsCount: Math.max(0, event.payload.commentsCount) });
    } else if (event.type === 'comment:updated') {
      const id = event.payload.id;
      if (typeof id !== 'string') return;
      if (event.payload.status !== 'approved') updateInteraction({ comments: comments.filter((comment) => comment.id !== id) });
      else updateInteraction({ comments: comments.map((comment) => comment.id === id && typeof event.payload.text === 'string' ? { ...comment, body: event.payload.text } : comment) });
      if (typeof event.payload.commentsCount === 'number') onPostUpdate(post.id, { commentsCount: Math.max(0, event.payload.commentsCount) });
    }
  });

  const changeLike = async () => {
    if (!profile?.isRegistered) { onOpenAuth('login'); return; }
    if (lock.current) return;
    lock.current = true;
    const liked = !post.liked;
    onPostUpdate(post.id, { liked, likes: Math.max(0, post.likes + (liked ? 1 : -1)) });
    try {
      const result = await toggleLike(post.id, liked);
      onPostUpdate(post.id, { liked: result.liked, likes: result.likes_count });
      publishRealtime({ type: 'like:change', payload: { id: post.id, likes: result.likes_count } });
    } catch (cause) {
      onPostUpdate(post.id, { liked: post.liked, likes: post.likes });
      onToast(getUserFacingError(cause, 'Your like could not be saved.'), 'error');
    } finally { lock.current = false; }
  };

  const changeBookmark = async () => {
    if (!profile?.isRegistered) { onOpenAuth('login'); return; }
    if (bookmarkLock.current) return;
    bookmarkLock.current = true;
    try {
      const bookmarked = await toggleBookmark(profile.userId, post.id);
      onPostUpdate(post.id, { bookmarked });
      onToast(bookmarked ? 'Saved to your bookmarks.' : 'Removed from your bookmarks.', 'success');
    } catch (cause) { onToast(getUserFacingError(cause, 'Bookmark could not be saved.'), 'error'); }
    finally { bookmarkLock.current = false; }
  };

  const addComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile?.isRegistered) { onOpenAuth('login'); return; }
    const body = commentText.trim();
    if (!body || pending) return;
    setPending(true);
    try {
      const comment = await createComment(post.id, body);
      updateInteraction({ commentsLoaded: true, comments: comments.some((item) => item.id === comment.id) ? comments : [...comments, comment] });
      onPostUpdate(post.id, { commentsCount: post.commentsCount + 1 });
      updateInteraction({ commentText: '' });
    } catch (cause) { onToast(getUserFacingError(cause, 'Your reply could not be posted.'), 'error'); }
    finally { setPending(false); }
  };

  const deletePost = async () => {
    if (!window.confirm('Remove this post from the campus feed?')) return;
    try { await deleteOwnPost(post.id); onDeletePost(post.id); }
    catch (cause) { onToast(getUserFacingError(cause, 'This post could not be removed.'), 'error'); }
  };

  const report = async (reason: string, detail: string) => {
    if (!reportTarget) return;
    try {
      await submitReport(post.id, reportTarget.type, reportTarget.id, reason, detail);
      onToast('Thanks. The moderation team will review this report.', 'success');
      setReportTarget(null);
    } catch (cause) { onToast(getUserFacingError(cause, 'Your report could not be sent.'), 'error'); }
  };

  const share = async () => {
    const link = postDeepLink(post.id);
    try {
      if (navigator.share) await navigator.share({ title: 'UNSEEN campus post', url: link });
      else { await navigator.clipboard.writeText(link); onToast('Post link copied.', 'success'); }
    } catch { /* A cancelled native share is not an error. */ }
  };

  const reportPostOrComment = (target: { type: 'post' | 'comment' | 'account'; id: string | null }) => {
    if (!profile?.isRegistered) { onOpenAuth('login'); return; }
    setReportTarget(target);
  };

  const refreshImageAfterError = async () => {
    const path = post.imagePath;
    const attemptKey = `${path ?? ''}|${post.imageUrl ?? ''}`;
    if (!path || refreshAttemptedUrl.current === attemptKey) { setImageBroken(true); return; }
    refreshAttemptedUrl.current = attemptKey;
    try { onPostUpdate(post.id, { imageUrl: await refreshSignedImageUrl(path) }); }
    catch { setImageBroken(true); }
  };

  return (
    <article id={`post-${post.id}`} className="card scroll-mt-36 overflow-hidden p-4 sm:p-5" aria-label={`${post.category} post`}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: post.authorColor }}>{post.authorEmoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold">{post.authorName}</span>
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-bold tracking-wider text-purple-700">CAMPUS GHOST</span>
            <span className="text-[11px] font-semibold text-faint">{formatRelativeIndiaTime(post.createdAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted">
            <span className="rounded-full bg-soft px-2.5 py-1">{post.category}</span>
            {post.location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{post.location}</span>}
            {post.branch && <span>{post.branch}</span>}
          </div>
        </div>
        {post.owned && <button type="button" onClick={() => void deletePost()} className="chip flex h-11 w-11 shrink-0 items-center justify-center rounded-full" title="Remove your post" aria-label="Remove your post"><Trash2 size={16} /></button>}
      </div>

      <p className="mt-4 whitespace-pre-wrap break-words text-[14px] font-medium leading-relaxed">{post.body}</p>
      {post.imagePath && !imageBroken && post.imageUrl && <button type="button" onClick={() => setImageOpen(true)} aria-label="Open post image full screen" className="mt-4 block w-full cursor-zoom-in overflow-hidden rounded-2xl bg-transparent p-0 text-left">
        <img src={post.imageUrl} alt="Image shared anonymously by a campus ghost. Open full screen." width={post.imageWidth ?? undefined} height={post.imageHeight ?? undefined} loading="lazy" decoding="async" sizes="(min-width: 1100px) 33vw, (min-width: 640px) 50vw, 100vw" className="feed-post-image" onError={() => void refreshImageAfterError()} />
      </button>}
      {post.imagePath && imageBroken && <div className="post-image-fallback"><ImageOff size={14} className="mr-2" /> This image is no longer available.</div>}

      {imageOpen && post.imageUrl && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-3 pt-16 sm:p-6 sm:pt-16" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setImageOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="Full-screen post image" className="relative flex h-full w-full items-center justify-center">
          <button type="button" onClick={() => setImageOpen(false)} aria-label="Close full-screen image" className="absolute right-1 top-1 z-[1] flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-lg sm:right-0 sm:top-0"><X size={22} /></button>
          <img src={post.imageUrl} alt="Full-screen image shared anonymously by a campus ghost" className="max-h-full max-w-full object-contain" />
        </section>
      </div>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-soft pt-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => void changeLike()} aria-label={post.liked ? 'Unlike post' : 'Like post'} aria-pressed={post.liked} className="chip flex items-center gap-1 rounded-full px-2 py-2 text-xs font-bold"><Heart size={16} fill={post.liked ? 'currentColor' : 'none'} className={`transition-all duration-200 ${post.liked ? 'scale-110 text-rose-600' : 'text-muted'}`} /> <span>{post.likes}</span><span className="hidden xs:inline">Like</span></button>
          <button type="button" onClick={() => { if (!commentsOpen) setCommentsLoadFailed(false); updateInteraction({ commentsOpen: !commentsOpen }); }} aria-expanded={commentsOpen} className="chip flex items-center gap-1 rounded-full px-2 py-2 text-xs font-bold"><MessageCircle size={16} /><span>{post.commentsCount}</span><span className="hidden xs:inline">Reply</span></button>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => reportPostOrComment({ type: 'post', id: null })} className="chip flex h-11 w-11 items-center justify-center rounded-full" aria-label="Report post"><Flag size={15} /></button>
          <button type="button" onClick={() => void changeBookmark()} aria-pressed={post.bookmarked} className={`bookmark-btn chip flex h-11 w-11 items-center justify-center rounded-full ${post.bookmarked ? 'saved' : ''}`} aria-label={post.bookmarked ? 'Remove bookmark' : 'Bookmark post'}><Bookmark size={15} /></button>
          <button type="button" onClick={() => void share()} className="chip flex h-11 w-11 items-center justify-center rounded-full" aria-label="Share post"><Share2 size={15} /></button>
        </div>
      </div>

      {commentsOpen && (
        <div className="mt-2 border-t border-soft pt-3">
          <div className="space-y-3" aria-live="polite">
            {commentsLoading && <p className="py-3 text-center text-xs text-muted">Loading anonymous replies…</p>}
            {!commentsLoading && comments.map((comment) => <div key={comment.id} className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: comment.mine ? profile?.color ?? '#EDE9FE' : '#EDE9FE' }}>{comment.authorEmoji}</span>
              <div className="min-w-0 flex-1 rounded-2xl bg-soft px-3.5 py-2.5">
                <div className="flex items-center gap-2"><span className="text-xs font-bold">{comment.authorName}</span><time dateTime={comment.createdAt} className="text-[10px] text-faint">{formatRelativeIndiaTime(comment.createdAt)}</time></div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{comment.body}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => reportPostOrComment({ type: 'comment', id: comment.id })} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-black/5" aria-label="Report reply"><Flag size={15} /></button>
                {comment.mine && <button type="button" onClick={() => { void removeComment(comment.id).then(() => updateInteraction({ comments: comments.filter((item) => item.id !== comment.id) })).catch((cause: unknown) => onToast(getUserFacingError(cause, 'Reply could not be removed.'), 'error')); }} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-black/5" aria-label="Delete your reply"><Trash2 size={15} /></button>}
              </div>
            </div>)}
            {!commentsLoading && comments.length === 0 && <p className="py-3 text-center text-xs text-muted">No replies yet. Keep it kind and be the first.</p>}
          </div>
          {profile?.isRegistered ? <form onSubmit={(event) => void addComment(event)} className="mt-4 flex gap-2">
            <label className="sr-only" htmlFor={`comment-${post.id}`}>Write an anonymous reply</label>
            <input id={`comment-${post.id}`} value={commentText} onChange={(event) => updateInteraction({ commentText: event.target.value })} maxLength={500} placeholder="Reply anonymously…" className="input-themed min-w-0 flex-1 rounded-full px-4 py-2.5 text-[13px] font-medium" />
            <button disabled={pending || !commentText.trim()} className="btn-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50" aria-label="Send reply"><Send size={15} /></button>
          </form> : <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted">
            <span>Sign in or join to reply anonymously.</span>
            <button type="button" onClick={() => onOpenAuth('login')} className="inline-flex min-h-11 items-center rounded-full px-2 font-bold text-unseen-700 underline">Sign in</button>
            <button type="button" onClick={() => onOpenAuth('register')} className="inline-flex min-h-11 items-center rounded-full px-2 font-bold text-unseen-700 underline">Join UNSEEN</button>
          </div>}
        </div>
      )}

      {reportTarget && <ReportDialog onClose={() => setReportTarget(null)} onSubmit={report} />}
    </article>
  );
}
