import { useState } from 'react';
import { ArrowUpRight, LogIn, Plus, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

interface NavbarProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onOpenComposer: () => void;
  onOpenAdmin: () => void;
  onOpenProfile: () => void;
  onOpenRandomChat: () => void;
  onSearch: (value: string) => void;
}

export function Navbar({ onOpenAuth, onOpenComposer, onOpenAdmin, onOpenProfile, onOpenRandomChat, onSearch }: NavbarProps) {
  const { profile } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-[60]">
      <div className="glass border-b border-soft">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href="#top" className="flex min-w-0 items-center gap-3" aria-label="UNSEEN home">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-lg" style={{ background: 'linear-gradient(135deg,#7C3AED,#4F46E5)' }}>
              <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
                <path d="M8 10 Q8 6 14 6 H34 Q42 6 42 14 V28 Q42 36 34 36 H20 L12 42 L13.5 35 Q8 34 8 28 Z" fill="white" />
                <path d="M12 21 Q24 11 36 21 Q24 31 12 21Z" fill="#2e1065" />
                <circle cx="24" cy="21" r="5" fill="white" /><circle cx="24" cy="21" r="2.6" fill="#7C3AED" />
              </svg>
            </span>
            <span className="min-w-0 leading-none">
              <span className="block truncate font-grotesk text-[19px] font-bold tracking-tight">UNSEEN <span className="hidden align-top rounded-full border border-purple-200 px-2 py-0.5 font-inter text-[10px] tracking-widest text-purple-700 sm:inline">DEC</span></span>
              <span className="mt-1 hidden text-[10px] font-bold tracking-[.18em] text-muted sm:block">DUMKA ENGINEERING COLLEGE</span>
            </span>
          </a>

          <nav className="hidden items-center gap-1 text-[13.5px] font-semibold lg:flex" aria-label="Main navigation">
            <a href="#pulse" className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Pulse</a>
            <a href="#explore" className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Explore</a>
            <a href="#battles" className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Campus polls</a>
            <a href="#crush" className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Spotted</a>
            <a href="#mailbox" className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Mailbox</a>
            <a href="#memes" className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Meme Wall</a>
            <button type="button" onClick={onOpenRandomChat} className="rounded-full px-3.5 py-2 text-muted transition hover:bg-black/5 hover:text-primary">Random chat</button>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => { setSearchOpen((open) => !open); if (searchOpen) onSearch(''); }} className="chip flex h-10 w-10 items-center justify-center rounded-full" aria-label={searchOpen ? 'Close search' : 'Search posts'}>
              <Search size={18} />
            </button>
            {profile?.role === 'ADMIN' && (
              <button type="button" onClick={onOpenAdmin} className="chip hidden h-10 w-10 items-center justify-center rounded-full sm:flex" title="Admin dashboard" aria-label="Admin dashboard"><ShieldCheck size={18} /></button>
            )}
            <button type="button" onClick={() => profile?.isRegistered ? onOpenProfile() : onOpenAuth('login')} className="flex h-10 max-w-[160px] items-center gap-2 rounded-full border border-soft px-2.5 text-sm font-semibold" title={profile?.isRegistered ? 'Open anonymous profile' : 'Sign in'}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base" style={{ background: profile?.color ?? '#FEF3C7' }}>{profile?.emoji ?? '👻'}</span>
              <span className="hidden truncate sm:block">{profile?.isRegistered ? profile.display_name.replace(/^Anonymous\s+/, '') : 'Sign in'}</span>
              {!profile?.isRegistered && <LogIn size={15} className="sm:hidden" />}
            </button>
            <button type="button" onClick={onOpenComposer} className="btn-primary hidden items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold sm:flex"><Plus size={16} /> CONFESS</button>
            <button type="button" onClick={onOpenComposer} className="btn-primary flex h-10 w-10 items-center justify-center rounded-full sm:hidden" aria-label="Create a post"><Plus size={20} /></button>
          </div>
        </div>
        {searchOpen && (
          <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6">
            <label className="sr-only" htmlFor="global-search">Search posts</label>
            <input id="global-search" onChange={(event) => onSearch(event.target.value)} placeholder="Search confessions, rants, spotted messages & memes" className="input-themed w-full rounded-full px-5 py-3 text-sm font-medium" autoFocus />
          </div>
        )}
      </div>
      <a href="#explore" className="sr-only focus:not-sr-only"><ArrowUpRight size={14} /> Skip to campus feed</a>
    </header>
  );
}
