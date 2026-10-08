import { useEffect, useState } from 'react';
import { ArrowUpRight, LogIn, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

interface NavbarProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onOpenComposer: () => void;
  onOpenAdmin: () => void;
  onOpenProfile: () => void;
  onSearch: (value: string) => void;
}

const navItems = [
  { id: 'pulse', label: 'Pulse', compact: 'Pulse' },
  { id: 'explore', label: 'Explore', compact: 'Explore' },
  { id: 'battles', label: 'Campus polls', compact: 'Polls' },
  { id: 'crush', label: 'Spotted', compact: 'Spotted' },
  { id: 'memes', label: 'Meme Wall', compact: 'Memes' },
];

export function Navbar({ onOpenAuth, onOpenComposer, onOpenAdmin, onOpenProfile, onSearch }: NavbarProps) {
  const { profile } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const syncHash = () => {
      const section = window.location.hash.slice(1);
      setActiveSection(navItems.some((item) => item.id === section) ? section : null);
    };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (current) setActiveSection(current.target.id);
    }, { rootMargin: '-18% 0px -68% 0px', threshold: 0 }) : null;

    navItems.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section) observer?.observe(section);
    });
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => {
      observer?.disconnect();
      window.removeEventListener('hashchange', syncHash);
    };
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-[60]">
      <div className="site-header-surface glass border-b border-soft">
        <div className="site-header-inner mx-auto grid h-[60px] max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2.5 sm:h-16 sm:gap-4 sm:px-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] 2xl:px-6">
          <a href="#top" className="flex min-w-0 items-center gap-2 sm:gap-3" aria-label="UNSEEN home">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] shadow-md sm:h-11 sm:w-11 sm:rounded-[14px]" style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)' }}>
              <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
                <path d="M8 10 Q8 6 14 6 H34 Q42 6 42 14 V28 Q42 36 34 36 H20 L12 42 L13.5 35 Q8 34 8 28 Z" fill="white" />
                <path d="M12 21 Q24 11 36 21 Q24 31 12 21Z" fill="#2e1065" />
                <circle cx="24" cy="21" r="5" fill="white" /><circle cx="24" cy="21" r="2.6" fill="#7C3AED" />
              </svg>
            </span>
            <span className="min-w-0 leading-none">
              <span className="block truncate font-grotesk text-[16px] font-bold tracking-tight sm:text-[19px]">UNSEEN <span className="ml-0.5 inline-flex translate-y-[-1px] rounded-full border border-purple-200 bg-white/70 px-1.5 py-0.5 font-inter text-[9px] font-bold tracking-[.15em] text-purple-700 sm:px-2 sm:text-[10px]">DEC</span></span>
              <span className="mt-1 hidden text-[9px] font-bold tracking-[.16em] text-muted xl:block">DUMKA ENGINEERING COLLEGE</span>
            </span>
          </a>

          <nav className="hidden min-w-0 items-center justify-self-center rounded-full border border-soft bg-white/55 p-1 text-[12px] font-semibold shadow-sm lg:flex" aria-label="Main navigation">
            {navItems.map(({ id, label, compact }) => {
              const active = activeSection === id;
              return <a key={id} href={`#${id}`} aria-current={active ? 'location' : undefined} className={`whitespace-nowrap rounded-full px-2.5 py-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 xl:px-3 ${active ? 'bg-white text-purple-800 shadow-sm ring-1 ring-purple-100' : 'text-muted hover:bg-white/80 hover:text-primary'}`}>
                <span className="xl:hidden">{compact}</span><span className="hidden xl:inline">{label}</span>
              </a>;
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
            <button type="button" onClick={() => { const opening = !searchOpen; setSearchOpen(opening); if (!opening) onSearch(''); }} className="chip flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 xl:h-10 xl:w-10" aria-label={searchOpen ? 'Close search' : 'Search posts'} aria-expanded={searchOpen} aria-controls="global-search-panel">
              {searchOpen ? <X size={19} /> : <Search size={19} />}
            </button>
            {profile?.role === 'ADMIN' && (
              <button type="button" onClick={onOpenAdmin} className="chip hidden h-11 w-11 items-center justify-center rounded-full sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 xl:h-10 xl:w-10" title="Admin dashboard" aria-label="Admin dashboard"><ShieldCheck size={19} /></button>
            )}
            <button type="button" onClick={() => profile?.isRegistered ? onOpenProfile() : onOpenAuth('login')} className="flex h-11 max-w-[180px] items-center gap-2 rounded-full border border-soft bg-white/45 px-1.5 text-sm font-semibold transition hover:border-purple-200 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 sm:px-2 xl:h-10" title={profile?.isRegistered ? 'Open anonymous profile' : 'Sign in'} aria-label={profile?.isRegistered ? 'Open anonymous profile' : 'Sign in'}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base" style={{ background: profile?.color ?? '#FEF3C7' }}>{profile?.emoji ?? '👻'}</span>
              <span className="hidden truncate xl:block">{profile?.isRegistered ? profile.display_name.replace(/^Anonymous\s+/, '') : 'Sign in'}</span>
              {!profile?.isRegistered && <LogIn size={15} className="hidden sm:block xl:hidden" />}
            </button>
            <button type="button" onClick={onOpenComposer} className="btn-primary flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 xl:h-10 xl:w-auto xl:gap-2 xl:px-4 xl:text-sm xl:font-bold" aria-label="Create a post"><Plus size={19} /><span className="hidden xl:inline">Confess</span></button>
          </div>
        </div>
      </div>
      {searchOpen && <div id="global-search-panel" className="site-search-panel glass absolute inset-x-0 top-full border-b border-soft px-4 pb-3 pt-2 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <label className="sr-only" htmlFor="global-search">Search posts</label>
          <input id="global-search" onChange={(event) => onSearch(event.target.value)} placeholder="Search confessions, rants, spotted messages & memes" className="input-themed w-full rounded-full px-5 py-3 text-sm font-medium" autoFocus />
        </div>
      </div>}
      <a href="#explore" className="sr-only focus:not-sr-only"><ArrowUpRight size={14} /> Skip to campus feed</a>
    </header>
  );
}
