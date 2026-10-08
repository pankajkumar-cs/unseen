import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, UserRound, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getUserFacingError } from '../lib/errors';

interface AuthDialogProps {
  mode: 'login' | 'register' | null;
  onClose: () => void;
  onModeChange: (mode: 'login' | 'register') => void;
}

export function AuthDialog({ mode, onClose, onModeChange }: AuthDialogProps) {
  const { login, register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setInvitationCode('');
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !pending) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mode, pending, onClose]);

  if (!mode) return null;
  const registering = mode === 'register';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (registering && password !== confirmPassword) {
      setError('Passwords do not match. Re-enter the same password in both fields.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (registering) await register(invitationCode, username, password, confirmPassword);
      else await login(username, password);
      onClose();
    } catch (cause) {
      setError(getUserFacingError(cause, 'Please check your details and try again.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal active z-[100]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <button type="button" className="modal-bg" aria-label="Close sign in" onClick={() => { if (!pending) onClose(); }} />
      <section className="modal-card card z-[1] w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold tracking-[.2em] text-unseen-600">YOUR IDENTITY STAYS HIDDEN</div>
            <h2 id="auth-title" className="mt-2 font-grotesk text-2xl font-bold">{registering ? 'Join UNSEEN' : 'Welcome back, ghost'}</h2>
            <p className="mt-1 text-sm text-muted">{registering ? 'Use your campus invitation to create an anonymous profile.' : 'Sign in with your username and password.'}</p>
          </div>
          <button type="button" onClick={onClose} className="chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full" aria-label="Close sign in"><X size={17} /></button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          {registering && (
            <label className="block text-sm font-semibold">Invitation code
              <span className="relative mt-1.5 block"><KeyRound size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" /><input required value={invitationCode} onChange={(event) => { setInvitationCode(event.target.value); setError(null); }} autoComplete="off" className="input-themed w-full rounded-2xl py-3 pl-11 pr-4" placeholder="UNSEEN-XXXX-XXXX-XXXX-XXXX" /></span>
            </label>
          )}
          <label className="block text-sm font-semibold">Username
            <span className="relative mt-1.5 block"><UserRound size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" /><input required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" value={username} onChange={(event) => { setUsername(event.target.value); setError(null); }} autoComplete="username" className="input-themed w-full rounded-2xl py-3 pl-11 pr-4" placeholder="3–20 letters, numbers, or _" /></span>
          </label>
          <label className="block text-sm font-semibold">Password
            <span className="relative mt-1.5 block"><input required minLength={registering ? 10 : 1} maxLength={128} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} autoComplete={registering ? 'new-password' : 'current-password'} className="input-themed w-full rounded-2xl py-3 pl-4 pr-14" placeholder={registering ? 'At least 10 characters' : 'Your password'} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
          </label>
          {registering && <label className="block text-sm font-semibold">Confirm password<input required minLength={10} maxLength={128} type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(null); }} autoComplete="new-password" className="input-themed mt-1.5 w-full rounded-2xl px-4 py-3" /></label>}
          {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert">{error}</p>}
          <button disabled={pending} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 font-bold disabled:cursor-wait disabled:opacity-70">
            {pending ? 'One moment…' : registering ? 'Create anonymous account' : 'Sign in'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted">
          {registering ? 'Already have an account?' : 'Have a campus invitation?'}{' '}
          <button type="button" className="font-bold text-unseen-700 underline-offset-2 hover:underline" onClick={() => onModeChange(registering ? 'login' : 'register')}>
            {registering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">Your username is only used to sign in. It never appears on public posts.</p>
      </section>
    </div>
  );
}
