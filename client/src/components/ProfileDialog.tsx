import { useState } from 'react';
import { LogOut, ShieldAlert, Trash2, UserRound, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getFunctionErrorMessage, getUserFacingError } from '../lib/errors';
import { requireSupabase } from '../lib/supabase';

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

export function ProfileDialog({ open, onClose, onOpenAuth, onToast }: ProfileDialogProps) {
  const { profile, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const deleteAccount = async () => {
    if (confirmation !== 'DELETE ACCOUNT') return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await requireSupabase().functions.invoke<{ error?: string }>('account', { body: { action: 'delete' } });
      if (invokeError) throw new Error(await getFunctionErrorMessage(invokeError, 'We could not delete your account. Please try again.'));
      if (data?.error) throw new Error(data.error);
      await logout();
      onClose();
      onToast('Your account and account-owned campus data were deleted.', 'success');
    } catch (cause) {
      setError(getUserFacingError(cause, 'We could not delete your account. Please try again.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal active z-[90]" role="presentation">
      <button type="button" className="modal-bg" aria-label="Close profile" onClick={() => { if (!busy) onClose(); }} />
      <section className="modal-card card z-[1] w-full max-w-lg rounded-t-[28px] p-6 sm:rounded-[28px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-[.2em] text-unseen-600">YOUR CAMPUS GHOST</p><h2 id="profile-title" className="mt-2 font-grotesk text-2xl font-bold">Anonymous profile</h2></div><button type="button" onClick={onClose} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close profile"><X size={17} /></button></div>
        <div className="mt-5 flex items-center gap-4 rounded-2xl border border-soft bg-soft p-4"><span className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl" style={{ background: profile?.color ?? '#EDE9FE' }}>{profile?.emoji ?? '👻'}</span><div className="min-w-0"><h3 className="truncate font-grotesk text-lg font-bold">{profile?.display_name ?? 'Anonymous Ghost'}</h3><p className="text-xs font-medium text-muted">This is the name others see around campus.</p></div></div>
        {profile?.isRegistered ? <>
          <div className="mt-4 rounded-2xl border border-soft p-4"><div className="flex items-center gap-2 text-xs font-bold tracking-wider text-muted"><UserRound size={15} /> PRIVATE SIGN-IN</div><div className="mt-2 font-semibold">{profile.username}</div><p className="mt-1 text-xs leading-relaxed text-muted">Your username is used only for sign-in and is never shown beside public posts.</p></div>
          <button type="button" onClick={() => void logout().then(() => { onClose(); onToast('You are signed out. Your anonymous visitor profile is active.', 'success'); }).catch((cause: unknown) => onToast(getUserFacingError(cause, 'Could not sign out. Please try again.'), 'error'))} className="chip mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold"><LogOut size={16} /> Log out</button>
          <div className="mt-5 border-t border-soft pt-4"><button type="button" onClick={() => { setConfirming((current) => !current); setError(null); }} className="inline-flex items-center gap-2 text-xs font-bold text-rose-700"><Trash2 size={15} /> Delete account and account-owned data</button>
            {confirming && <div className="mt-3 space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="flex items-start gap-2 text-xs leading-relaxed text-rose-900"><ShieldAlert size={16} className="mt-0.5 shrink-0" />This permanently removes your account, your posts and polls, your comments, bookmarks, mailbox messages, random chat data, and uploaded images. Type <b>DELETE ACCOUNT</b> to continue.</p><label className="block text-xs font-bold text-rose-900">Confirmation<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="input-themed mt-1.5 w-full rounded-xl px-3 py-2.5" autoComplete="off" /></label><button type="button" onClick={() => void deleteAccount()} disabled={busy || confirmation !== 'DELETE ACCOUNT'} className="w-full rounded-full bg-rose-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-45">{busy ? 'Deleting account…' : 'Permanently delete account'}</button></div>}
          </div>
        </> : <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-4"><p className="text-sm font-bold text-purple-900">Save this ghost with an invite-only account.</p><p className="mt-1 text-xs leading-relaxed text-purple-800">Visitors can browse, vote, and react to spotted posts. Sign in or join to like, comment, post, send mailbox notes, and use Random Chat.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => { onClose(); onOpenAuth('register'); }} className="btn-primary flex-1 rounded-full px-4 py-2.5 text-xs font-bold">Join UNSEEN</button><button type="button" onClick={() => { onClose(); onOpenAuth('login'); }} className="chip flex-1 rounded-full px-4 py-2.5 text-xs font-bold">Sign in</button></div></div>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">{error}</p>}
      </section>
    </div>
  );
}
