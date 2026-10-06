import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ImagePlus, LoaderCircle, Send, Trash2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { createPost, discardPostImage, getPostUsage, uploadPostImage, type UploadedMedia } from '../services/feed';
import type { PostCategory } from '../types/database';

const options: Array<{ value: PostCategory; emoji: string; description: string }> = [
  { value: 'Confessions', emoji: '💜', description: 'A secret, a thought, or something you have been holding in.' },
  { value: 'Rants', emoji: '🌩️', description: 'Let it out. Keep it about the situation, never a person’s private details.' },
  { value: 'Spotted', emoji: '👀', description: 'A kind campus moment or harmless shout-out.' },
  { value: 'Memes', emoji: '😂', description: 'Bring the campus laugh track.' },
  { value: 'Placements', emoji: '🎓', description: 'Share a placement win, lead, or useful update.' },
];

interface PostComposerProps {
  open: boolean;
  onClose: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

function sanitizeText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\b\d{10}\b/g, 'XX-XXXXXX')
    .replace(/\b(?:room\s*(?:no)?\.?\s*\d+|hostel\s+\d+)\b/gi, '[LOCATION REDACTED]')
    .trim();
}

export function PostComposer({ open, onClose, onOpenAuth, onToast }: PostComposerProps) {
  const { profile, session } = useAuth();
  const [category, setCategory] = useState<PostCategory>('Confessions');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<'preparing' | 'uploading' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!open || !profile?.isRegistered) return;
    void getPostUsage().then((row) => setUsage(row?.remaining ?? null)).catch(() => setUsage(null));
  }, [open, profile?.isRegistered]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setProgress(null);
    }
  }, [open]);

  if (!open) return null;

  const changeFile = (next: File | null) => {
    setError(null);
    if (!next) { setFile(null); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setFile(null); setError('Choose a JPG, PNG, or WebP image.'); return; }
    if (next.size > 5 * 1024 * 1024) { setFile(null); setError('Images must be 5 MB or smaller.'); return; }
    setFile(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile?.isRegistered || !session) { onOpenAuth('register'); return; }
    const cleanBody = sanitizeText(body);
    if (!cleanBody) { setError('Add a few words before posting.'); return; }
    if (cleanBody.length > 500) { setError('Posts can be up to 500 characters.'); return; }
    if (usage === 0) { setError('You have used today’s five post slots. Come back tomorrow.'); return; }
    setBusy(true);
    setError(null);
    let uploaded: UploadedMedia | null = null;
    try {
      if (file) {
        setProgress(null);
        setUploadStage('preparing');
        uploaded = await uploadPostImage(file, session, setProgress, () => setUploadStage('uploading'));
      }
      const created = await createPost(category, cleanBody, uploaded?.publicId ?? null);
      setUsage(Math.max(0, 5 - created.usage_count));
      setBody('');
      setFile(null);
      onClose();
      onToast('Your post is live on campus.', 'success');
    } catch (cause) {
      if (uploaded) await discardPostImage(uploaded).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : 'Your post could not be published. Please try again.');
    } finally {
      setBusy(false);
      setProgress(null);
      setUploadStage(null);
    }
  };

  return (
    <div className="modal active z-[90]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <button type="button" className="modal-bg" aria-label="Close composer" onClick={() => { if (!busy) onClose(); }} />
      <section className="modal-card card z-[1] w-full max-w-xl rounded-t-[28px] p-6 sm:rounded-[28px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="composer-heading">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-xs font-bold tracking-[.2em] text-unseen-600">DROP A SECRET</div><h2 id="composer-heading" className="mt-2 font-grotesk text-2xl font-bold">Speak anonymously.</h2><p className="mt-1 text-sm text-muted">Your post will appear as {profile?.display_name ?? 'your campus ghost'}.</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full" aria-label="Close composer"><X size={17} /></button>
        </div>
        {!profile?.isRegistered && <div className="mt-5 rounded-2xl border border-purple-100 bg-purple-50 p-4 text-sm text-purple-800">Create or sign in to your anonymous campus account to post, like, or comment. Visitors can still read and vote. <button type="button" onClick={() => onOpenAuth('register')} className="ml-1 font-bold underline">Join UNSEEN</button></div>}
        <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">Post type
            <select value={category} onChange={(event) => setCategory(event.target.value as PostCategory)} disabled={busy} className="input-themed mt-1.5 w-full rounded-2xl px-4 py-3">
              {options.map((item) => <option key={item.value} value={item.value}>{item.emoji} {item.value}</option>)}
            </select>
          </label>
          <p className="-mt-2 text-xs text-muted">{options.find((item) => item.value === category)?.description}</p>
          <label className="block text-sm font-semibold">Your message
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={500} required rows={5} disabled={busy} className="input-themed mt-1.5 w-full resize-y rounded-2xl px-4 py-3 text-sm leading-relaxed" placeholder="Jo campus mein nahi bol paate, yahan bol do…" />
            <span className="mt-1 block text-right text-[11px] text-faint">{body.length}/500</span>
          </label>
          {file && previewUrl && <div className="relative overflow-hidden rounded-2xl border border-soft">
            <img src={previewUrl} alt="Preview of selected campus image" className="max-h-64 w-full object-cover" />
            <button type="button" onClick={() => changeFile(null)} disabled={busy} className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-base shadow" aria-label="Remove selected image"><Trash2 size={16} /></button>
            {uploadStage && <div className="absolute inset-x-0 bottom-0 bg-white/95 px-3 py-2"><div className="h-1.5 overflow-hidden rounded-full bg-purple-100"><div className="h-full rounded-full bg-purple-600 transition-[width]" style={{ width: `${progress ?? 0}%` }} /></div><p className="mt-1 text-[11px] font-semibold text-muted">{uploadStage === 'preparing' ? 'Optimizing image…' : `Uploading image · ${progress ?? 0}%`}</p></div>}
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className={`chip inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold ${busy ? 'pointer-events-none opacity-50' : ''}`}><ImagePlus size={16} /> Add image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={(event) => changeFile(event.target.files?.[0] ?? null)} /></label>
            {usage !== null && <span className="text-xs font-semibold text-muted">{usage} of 5 posts left today</span>}
          </div>
          <p className="text-[11px] leading-relaxed text-faint">Images are resized to fit a campus feed card and stored privately. Avoid faces, names, phone numbers, or personal information.</p>
          {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
          <button disabled={busy || !profile?.isRegistered || usage === 0} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full px-5 py-3.5 font-bold disabled:cursor-not-allowed disabled:opacity-55">
            {busy ? <><LoaderCircle size={16} className="animate-spin" />{uploadStage === 'preparing' ? 'Preparing image…' : uploadStage === 'uploading' ? 'Uploading…' : 'Publishing…'}</> : <><Send size={15} /> Drop it on campus</>}
          </button>
        </form>
      </section>
    </div>
  );
}
