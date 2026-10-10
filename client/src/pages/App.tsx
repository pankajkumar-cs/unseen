import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Home, Laugh, Plus, RotateCw, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { CrushSection } from '../components/CrushSection';
import { Navbar } from '../components/Navbar';
import { PollSection } from '../components/PollSection';
import { PostFeed } from '../components/PostFeed';
import { PulseSection } from '../components/PulseSection';
import { RealtimeProvider, useOnlineCount, useRealtimeStatus } from '../realtime/RealtimeContext';
import type { PostCategory } from '../types/database';

const AuthDialog = lazy(() => import('../components/AuthDialog').then((module) => ({ default: module.AuthDialog })));
const PostComposer = lazy(() => import('../components/PostComposer').then((module) => ({ default: module.PostComposer })));
const ProfileDialog = lazy(() => import('../components/ProfileDialog').then((module) => ({ default: module.ProfileDialog })));
const AdminPanel = lazy(() => import('../components/AdminPanel').then((module) => ({ default: module.AdminPanel })));
const MemeWall = lazy(() => import('../components/MemeWall').then((module) => ({ default: module.MemeWall })));

type Toast = { id: number; text: string; kind: 'success' | 'error' | 'info' };

export function App() {
  const { configured, loading, error, profile, retryConnection, retrying } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [feedCategory, setFeedCategory] = useState<PostCategory | null>(null);
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const progressBar = useRef<HTMLDivElement>(null);
  const heroContent = useRef<HTMLDivElement>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  useEffect(() => {
    let frame = 0;
    const updateScrollEffects = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const page = document.documentElement;
        const maxScroll = Math.max(1, page.scrollHeight - window.innerHeight);
        if (progressBar.current) progressBar.current.style.width = `${Math.min(100, (window.scrollY / maxScroll) * 100)}%`;
        if (heroContent.current) {
          if (window.scrollY < window.innerHeight) {
            heroContent.current.style.transform = `translate3d(0,${window.scrollY * 0.12}px,0)`;
            heroContent.current.style.opacity = String(Math.max(0, 1 - window.scrollY / (window.innerHeight * 0.95)));
          } else heroContent.current.style.opacity = '0';
        }
        frame = 0;
      });
    };
    window.addEventListener('scroll', updateScrollEffects, { passive: true });
    updateScrollEffects();
    return () => { window.removeEventListener('scroll', updateScrollEffects); cancelAnimationFrame(frame); };
  }, []);

  if (!configured) return <SetupNotice />;
  if (loading) return <Preloader />;

  return (
    <RealtimeProvider>
      <div id="top" className="mobile-page relative min-h-screen overflow-clip">
        <div ref={progressBar} id="scroll-progress" className="fixed left-0 top-0 z-[100] h-[3px] w-0 bg-gradient-to-r from-purple-700 via-pink-500 to-amber-400" />
        <Navbar
          onOpenAuth={setAuthMode}
          onOpenComposer={() => setComposerOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
          onOpenProfile={() => setProfileOpen(true)}
          onSearch={setSearch}
        />

        <main className="relative z-[1]">
          <section id="hero" className="relative flex min-h-[100svh] flex-col overflow-hidden pt-16">
            <div id="sky-bg" className="absolute inset-0 bg-gradient-to-b from-[var(--hero1)] via-[var(--hero2)] to-[var(--hero3)]" />
            <div id="college-photo-slot" className="pointer-events-none absolute inset-0" aria-hidden="true" />
            <div id="hero-atmosphere" className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'radial-gradient(800px 400px at 20% 10%,rgba(124,58,237,.18),transparent),radial-gradient(700px 400px at 85% 20%,rgba(14,165,233,.12),transparent),radial-gradient(600px 500px at 50% 90%,rgba(245,158,11,.10),transparent)' }} />
            <div id="hero-bubbles" className="pointer-events-none absolute inset-0 z-[4] hidden lg:block">
              <div className="float-bubble glass absolute right-[6%] top-[22%] max-w-[210px] rounded-2xl border border-soft p-3 soft"><div className="text-[10px] font-bold tracking-widest text-unseen-600">LIVE COMMUNITY</div><div className="mt-1 text-xs font-semibold">Real student posts appear here as they arrive.</div></div>
              <div className="float-bubble glass absolute right-[6%] top-[43%] max-w-[220px] rounded-2xl border border-soft p-3 soft" style={{ animationDelay: '1.2s' }}><div className="text-[10px] font-bold tracking-widest text-sky-700">100% ANONYMOUS</div><div className="mt-1 text-xs font-semibold">Only what your campus actually shares — no preloaded stories.</div></div>
              <div className="float-bubble glass absolute bottom-[17%] right-[6%] max-w-[200px] rounded-2xl border border-soft p-3 soft" style={{ animationDelay: '2s' }}><div className="text-[10px] font-bold tracking-widest text-emerald-700">YOUR CAMPUS</div><div className="mt-1 text-xs font-semibold">Dumka Engineering College, together in one place.</div></div>
            </div>

            <div className="relative z-[10] mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
              <div ref={heroContent} id="hero-content" className="max-w-2xl transition-opacity">
                <div className="glass soft inline-flex items-center gap-2 rounded-full border border-soft py-1.5 pl-2 pr-4 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-green-500 live-dot" /> DEC-only anonymous community</div>
                <h1 className="mt-5 font-grotesk text-[42px] font-bold leading-[1.02] tracking-tight sm:text-[64px] lg:text-[72px]">JO CAMPUS MEIN<br /><span className="grad-text">NAHI BOL PAATE,</span><br />YAHAN BOL DO.</h1>
                <p className="mt-4 text-[17px] font-medium text-muted sm:text-xl">Your identity stays hidden. <span className="font-bold text-primary">Your voice doesn’t.</span></p>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">Confessions, rants, spotted messages & memes — made <b className="text-primary">only for Dumka Engineering College</b>. No names. No fear. Sirf sach.</p>
                <OnlineVisitorCount />
                <div className="mt-7 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setComposerOpen(true)} className="btn-primary group inline-flex items-center gap-2 rounded-full px-7 py-4 font-grotesk text-[15px] font-bold">ENTER CAMPUS → DROP A SECRET <span className="transition group-hover:translate-x-1" aria-hidden="true">→</span></button>
                  <a href="#pulse" className="glass soft inline-flex items-center gap-2 rounded-full border border-soft px-6 py-4 text-[15px] font-bold transition hover:scale-[1.02]"><span className="h-2 w-2 rounded-full bg-green-500 live-dot" /> Aaj Campus Mein</a>
                </div>
                <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
                  <div><div className="font-grotesk text-2xl font-bold">7 DAYS</div><div className="text-[11px] font-bold tracking-widest text-muted">POSTS STAY FRESH</div></div><div className="hidden w-px bg-black/10 sm:block" />
                  <div><div className="font-grotesk text-2xl font-bold">100%</div><div className="text-[11px] font-bold tracking-widest text-muted">ANONYMOUS</div></div><div className="hidden w-px bg-black/10 sm:block" />
                  <div className="hidden sm:block"><div className="font-grotesk text-2xl font-bold">📍 DUMKA</div><div className="text-[11px] font-bold tracking-widest text-muted">JHARKHAND 814101</div></div>
                </div>
              </div>
            </div>
            <div className="relative z-[10] mx-auto flex w-full max-w-7xl justify-end px-4 pb-6 text-[11px] font-bold tracking-widest text-muted sm:px-6">
              <a href="#pulse" className="flex animate-bounce items-center gap-2">SCROLL <span aria-hidden="true">⌄</span></a>
            </div>
          </section>

          <div className="relative z-10 overflow-hidden border-y border-soft bg-card py-3"><div className="ticker-track flex w-max gap-8 text-[13px] font-semibold text-muted">{['👻 Campus feed is waiting for its next real secret.', '💜 Confessions, rants, spotted moments and memes.', '🛡️ No names. Keep it anonymous and kind.', '🎓 A campus corner made for Dumka Engineering College.'].map((line) => <span key={line} className="whitespace-nowrap">{line}<span className="ml-6 text-unseen-300">•</span></span>)}</div></div>
          <PulseSection onCreatePost={() => setComposerOpen(true)} />
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            {search && <div className="flex justify-end pt-6"><button type="button" className="chip rounded-full px-4 py-2 text-xs font-bold" onClick={() => setSearch('')}>Clear search ×</button></div>}
            <PostFeed category={feedCategory} onCategoryChange={setFeedCategory} searchTerm={search} refreshKey={feedRefreshKey} onOpenAuth={setAuthMode} onCreatePost={() => setComposerOpen(true)} onToast={toast} />
          </div>
          <PollSection onOpenAuth={setAuthMode} onToast={toast} />
          <CrushSection onOpenAuth={setAuthMode} onToast={toast} />
          <DeferredMemeWall onOpenAuth={setAuthMode} onToast={toast} />
          <SafetySection />
          <CallToAction onCreatePost={() => setComposerOpen(true)} />
          <Footer onOpenAdmin={() => setAdminOpen(true)} showAdmin={profile?.role === 'ADMIN'} />
        </main>

        <MobileNav onHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })} onExplore={() => document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' })} onMemes={() => document.getElementById('memes')?.scrollIntoView({ behavior: 'smooth' })} onCreate={() => setComposerOpen(true)} onProfile={() => profile?.isRegistered ? setProfileOpen(true) : setAuthMode('login')} />

        {error && <div role="status" className="mobile-overlay-offset fixed left-4 right-4 z-[65] mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900 shadow-lg"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex min-w-0 flex-1 items-start gap-2"><ShieldCheck size={17} className="mt-0.5 shrink-0" />Some account features may be unavailable: {error}</span><button type="button" onClick={() => void retryConnection()} disabled={retrying} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-amber-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"><RotateCw size={14} className={retrying ? 'animate-spin' : ''} />{retrying ? 'Retrying…' : 'Try again'}</button></div></div>}
        <div className="mobile-overlay-offset fixed right-4 z-[120] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 lg:right-6" aria-live="polite">{toasts.map((item) => <div key={item.id} className={`toast rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg ${item.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : item.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-soft bg-card text-primary'}`}>{item.text}</div>)}</div>
        <Suspense fallback={null}>
          {authMode && <AuthDialog mode={authMode} onClose={() => setAuthMode(null)} onModeChange={setAuthMode} />}
          {composerOpen && <PostComposer open onClose={() => setComposerOpen(false)} onOpenAuth={setAuthMode} onToast={toast} onCreated={() => setFeedRefreshKey((key) => key + 1)} />}
          {profileOpen && <ProfileDialog open onClose={() => setProfileOpen(false)} onOpenAuth={setAuthMode} onOpenAdmin={() => setAdminOpen(true)} onToast={toast} />}
          {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} onToast={toast} />}
        </Suspense>
      </div>
    </RealtimeProvider>
  );
}

function OnlineVisitorCount() {
  const onlineCount = useOnlineCount();
  const connectionStatus = useRealtimeStatus();
  const isConnected = connectionStatus === 'connected' && onlineCount !== null;
  const label = connectionStatus === 'connecting'
    ? 'Connecting to DECians…'
    : connectionStatus === 'reconnecting'
      ? 'Live updates reconnecting…'
      : onlineCount === null
        ? 'Live updates connected · online count unavailable'
        : `${onlineCount} DECians online`;
  return (
    <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-emerald-200 bg-white/75 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-sm backdrop-blur" role="status" aria-live="polite">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {isConnected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-500' : connectionStatus === 'reconnecting' ? 'bg-amber-500' : 'bg-slate-400'}`} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function DeferredMemeWall({ onOpenAuth, onToast }: { onOpenAuth: (mode: 'login' | 'register') => void; onToast: (message: string, kind?: Toast['kind']) => void }) {
  const [visible, setVisible] = useState(false);
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = target.current;
    if (!node || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={target} id="memes" className="mt-14">
    {visible ? <Suspense fallback={<MemeWallPlaceholder />}><MemeWall onOpenAuth={onOpenAuth} onToast={onToast} /></Suspense> : <MemeWallPlaceholder />}
  </div>;
}

function MemeWallPlaceholder() {
  return <section className="overflow-hidden border-y border-soft bg-lav py-14"><div className="mx-auto max-w-7xl px-4 sm:px-6"><div className="skeleton h-8 w-56 rounded-full" /><div className="mt-4 grid gap-6 lg:grid-cols-[380px_1fr]"><div className="skeleton h-[520px] rounded-3xl" /><div className="skeleton h-64 rounded-3xl" /></div></div></section>;
}

function Preloader() {
  return <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-gradient-to-br from-[var(--bg)] to-[var(--bg2)]"><div className="relative"><div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-gradient-to-br from-purple-600 to-indigo-700 text-5xl shadow-xl">👁️</div><div className="absolute -inset-3 animate-spin rounded-[32px] border-2 border-dashed border-purple-300" style={{ animationDuration: '8s' }} /></div><h1 className="mt-6 font-grotesk text-3xl font-bold tracking-tight">UNSEEN</h1><p className="mt-1 text-sm font-medium tracking-widest text-muted">DUMKA ENGINEERING COLLEGE</p><div className="mt-6 flex gap-2"><span className="h-2 w-2 animate-bounce rounded-full bg-purple-500" /><span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '.15s' }} /><span className="h-2 w-2 animate-bounce rounded-full bg-pink-400" style={{ animationDelay: '.3s' }} /></div><p className="mt-4 text-xs font-medium text-faint">Jo campus mein nahi bol paate, yahan bol do…</p></div>;
}

function MobileNav({ onHome, onExplore, onMemes, onCreate, onProfile }: { onHome: () => void; onExplore: () => void; onMemes: () => void; onCreate: () => void; onProfile: () => void }) {
  const [activeDestination, setActiveDestination] = useState<'home' | 'explore' | 'memes'>('home');

  useEffect(() => {
    const destinations = [
      { id: 'explore', key: 'explore' as const },
      { id: 'memes', key: 'memes' as const },
    ].flatMap((destination) => {
      const element = document.getElementById(destination.id);
      return element ? [{ ...destination, element }] : [];
    });
    if (!destinations.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)
        .at(-1);
      if (current) {
        const destination = destinations.find((item) => item.element === current.target);
        if (destination) setActiveDestination(destination.key);
      } else if (window.scrollY < (document.getElementById('explore')?.offsetTop ?? Infinity)) {
        setActiveDestination('home');
      }
    }, { rootMargin: '-20% 0px -65% 0px', threshold: 0 });
    destinations.forEach(({ element }) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return <nav className="bottom-nav fixed inset-x-0 bottom-0 z-[60] lg:hidden" aria-label="Quick navigation"><div className="bottom-nav-surface glass grid grid-cols-5 items-center gap-0.5 border-t border-soft px-1.5 pt-1.5">
    <button type="button" onClick={onHome} aria-current={activeDestination === 'home' ? 'page' : undefined} aria-label="Go to home" className={`bottom-nav-item ${activeDestination === 'home' ? 'bottom-nav-item-active' : ''}`}><Home size={20} /><span>Home</span></button>
    <button type="button" onClick={onExplore} aria-current={activeDestination === 'explore' ? 'location' : undefined} aria-label="Explore campus posts" className={`bottom-nav-item ${activeDestination === 'explore' ? 'bottom-nav-item-active' : ''}`}><Compass size={20} /><span>Explore</span></button>
    <button type="button" onClick={onCreate} aria-label="Create a post" className="bottom-nav-create"><span className="bottom-nav-create-icon"><Plus size={21} /></span><span>Create</span></button>
    <button type="button" onClick={onMemes} aria-current={activeDestination === 'memes' ? 'location' : undefined} aria-label="Open Meme Wall" className={`bottom-nav-item ${activeDestination === 'memes' ? 'bottom-nav-item-active' : ''}`}><Laugh size={20} /><span>Meme Wall</span></button>
    <button type="button" onClick={onProfile} aria-label="Open your anonymous profile" className="bottom-nav-item"><UserRound size={20} /><span>Profile</span></button>
  </div></nav>;
}

function SafetySection() {
  const items = [
    { emoji: '🚫', title: 'No Real Names', text: 'Avoid sharing names, photos, phone numbers or private room details.', color: 'from-red-500 to-orange-500' },
    { emoji: '🚩', title: 'Report in 1 Tap', text: 'Report harassment, spam, or personal information. Moderators review each report.', color: 'from-violet-500 to-indigo-500' },
    { emoji: '👁️', title: 'Quick privacy check', text: 'A simple check flags phone numbers and room details before posting.', color: 'from-emerald-500 to-teal-500' },
    { emoji: '⚖️', title: 'Human Moderation', text: 'Reports go to the moderator queue for review.', color: 'from-amber-500 to-yellow-500' },
  ];
  return <section id="safety" className="mx-auto max-w-7xl px-4 py-16 sm:px-6"><div className="text-center"><div className="inline-flex items-center gap-2 rounded-full border border-soft bg-card px-4 py-1.5 text-xs font-bold tracking-[.2em] text-emerald-600 soft">🛡️ SAFETY FIRST · STRICT ANTI-DOXXING</div><h2 className="mt-3 font-grotesk text-3xl font-bold sm:text-[42px]">Anonymous ka matlab <span className="grad-text">responsible.</span></h2></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map((item) => <article key={item.title} className="card p-6"><div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} text-xl text-white`}>{item.emoji}</div><h3 className="mt-3 font-grotesk font-bold">{item.title}</h3><p className="mt-1 text-[13px] font-medium leading-relaxed text-muted">{item.text}</p></article>)}</div>
    <div className="card mt-4 flex items-center gap-3 p-5" style={{ background: 'linear-gradient(135deg,var(--surface),var(--bg2))' }}><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl" style={{ background: 'linear-gradient(135deg,#FDE68A,#FCA5A5)' }}>🦉</div><div className="text-sm"><b>Feeling low? Baat karna zaroori hai.</b><br /><span className="font-medium text-muted">Reach out to campus support or someone you trust. You do not have to handle it alone.</span></div></div>
  </section>;
}

function CallToAction({ onCreatePost }: { onCreatePost: () => void }) {
  return <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6"><div className="relative overflow-hidden rounded-[28px] p-8 text-center sm:p-14" style={{ background: 'linear-gradient(135deg,#2E1065,#6D28D9 45%,#4F46E5)', boxShadow: '0 30px 80px rgba(109,40,217,.35)' }}><div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: 'radial-gradient(500px 250px at 20% 20%,#fff,transparent),radial-gradient(500px 250px at 80% 80%,#F0ABFC,transparent)' }} /><div className="float-bubble absolute left-8 top-6 text-4xl">💌</div><div className="float-bubble absolute bottom-8 right-10 text-4xl" style={{ animationDelay: '1s' }}>👻</div><div className="relative"><h2 className="font-grotesk text-3xl font-bold tracking-tight text-white sm:text-5xl">Ready to be <span className="bg-gradient-to-r from-amber-200 to-fuchsia-200 bg-clip-text text-transparent">UNSEEN?</span></h2><p className="mx-auto mt-3 max-w-xl text-sm font-medium text-white/85 sm:text-base">Campus ki awaaz, bina naam ke. Tumhari identity hidden rahegi; tumhari baat campus tak.</p><div className="mt-7 flex flex-wrap justify-center gap-3"><button type="button" onClick={onCreatePost} className="rounded-full bg-white px-8 py-4 font-grotesk text-[15px] font-bold text-[#2E1065] shadow-xl transition hover:scale-105">DROP YOUR FIRST SECRET →</button></div><div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[11px] font-bold tracking-widest text-white/80"><span>✓ NO SIGNUP WITH NAME</span><span>✓ NO PROFILE STALKING</span><span>✓ DEC-ONLY COMMUNITY</span></div></div></div></section>;
}

function Footer({ onOpenAdmin, showAdmin }: { onOpenAdmin: () => void; showAdmin: boolean }) {
  return <footer className="site-footer border-t border-soft bg-card"><div className="mx-auto grid max-w-7xl gap-7 px-4 py-9 sm:px-6 sm:py-12 md:grid-cols-2 md:gap-8"><div><div className="flex items-center gap-2.5"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-700 text-xl text-white">👁️</div><div className="font-grotesk text-lg font-bold">UNSEEN</div></div><p className="mt-3 max-w-md text-[13px] font-medium leading-relaxed text-muted">Exclusive anonymous platform for <b className="text-primary">Dumka Engineering College</b>. Instagram + Reddit + diary — sab ek jagah.</p><div className="mt-4 flex flex-wrap gap-2"><span className="chip rounded-full px-3 py-1.5 text-[11px] font-bold">📍 Dumka, Jharkhand</span><span className="chip rounded-full px-3 py-1.5 text-[11px] font-bold">🎓 JUT Affiliated</span></div></div><div><div className="font-grotesk text-sm font-bold tracking-wider">EXPLORE</div><div className="site-footer-links mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] font-semibold text-muted sm:flex sm:flex-col"><a href="#pulse">⚡ Live Pulse</a><a href="#explore">✨ Confessions Feed</a><a href="#battles">🎲 Campus Polls</a><a href="#memes">😂 Meme Wall</a></div>{showAdmin && <button type="button" onClick={onOpenAdmin} className="chip mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold sm:w-auto"><ShieldCheck size={16} /> Admin Dashboard</button>}</div></div><div className="border-t border-soft px-4 py-4 text-left text-[11px] font-semibold leading-relaxed text-faint sm:px-6 sm:py-5 sm:text-center sm:text-[12px]">© 2026 UNSEEN · Made with 💜 for Dumka Engineering College · <span className="sm:mx-2">·</span><a href="#safety" className="inline-block min-h-11 py-3 text-unseen-700 sm:min-h-0 sm:py-0">Guidelines</a></div></footer>;
}

function SetupNotice() {
  return <main className="flex min-h-screen items-center justify-center p-5"><section className="card w-full max-w-xl p-7 sm:p-9"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-unseen-700"><ShieldCheck size={22} /></div><p className="mt-5 text-xs font-bold tracking-[.2em] text-unseen-600">UNSEEN SETUP</p><h1 className="mt-2 font-grotesk text-3xl font-bold">Connect the campus project</h1><p className="mt-3 text-sm leading-relaxed text-muted">Add the Supabase project URL and publishable key to the local environment to enable sign-in, realtime posts, polls, and storage.</p></section></main>;
}
