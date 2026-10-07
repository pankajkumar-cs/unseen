import { useEffect, useState, type FormEvent } from 'react';
import { getUserFacingError } from '../lib/errors';
import { formatIndiaDate } from '../lib/dates';
import { Check, Plus, Vote, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import { createPoll, loadPolls, votePoll, type PollView } from '../services/community';

interface PollSectionProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
}

const optionEmojis = ['🅰️', '🅱️', '🅾️', '🆎', '✨', '💭'];
const optionColors = ['linear-gradient(90deg,#7C3AED,#A78BFA)', 'linear-gradient(90deg,#EC4899,#F9A8D4)', 'linear-gradient(90deg,#F59E0B,#FCD34D)'];

export function PollSection({ onOpenAuth, onToast }: PollSectionProps) {
  const { profile } = useAuth();
  const [polls, setPolls] = useState<PollView[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);

  const refresh = async () => {
    try { setPolls(await loadPolls()); }
    catch (cause) { onToast(getUserFacingError(cause, 'Campus polls could not load.'), 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);
  useRealtime((event) => {
    if (event.type.startsWith('poll:')) void refresh();
  });

  const castVote = async (poll: PollView, optionId: string) => {
    if (poll.myOptionId) return;
    const previous = poll;
    setPolls((current) => current.map((item) => item.id === poll.id ? {
      ...item,
      myOptionId: optionId,
      totalVotes: item.totalVotes + 1,
      options: item.options.map((option) => option.id === optionId ? { ...option, votes: option.votes + 1 } : option),
    } : item));
    try {
      const result = await votePoll(poll.id, optionId);
      if (result) setPolls((current) => current.map((item) => item.id === poll.id ? { ...item, totalVotes: result.total_votes, myOptionId: result.selected_option_id } : item));
    } catch (cause) {
      setPolls((current) => current.map((item) => item.id === poll.id ? previous : item));
      onToast(getUserFacingError(cause, 'Your vote could not be saved.'), 'error');
    }
  };

  const publish = async (question: string, values: string[]) => {
    if (!profile?.isRegistered) { onOpenAuth('register'); return; }
    const options = values.filter((value) => value.trim()).map((label, index) => ({
      label: label.trim(),
      emoji: optionEmojis[index],
      color: optionColors[index % optionColors.length],
    }));
    try {
      await createPoll(question.trim(), 'CAMPUS POLL', options);
      await refresh();
      setComposerOpen(false);
      onToast('Your poll is live for campus.', 'success');
    } catch (cause) { onToast(getUserFacingError(cause, 'Your poll could not be published.'), 'error'); }
  };

  return (
    <section id="battles" className="relative mt-10 overflow-hidden border-y border-soft bg-lav py-14">
      <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'radial-gradient(600px 300px at 10% 0%,rgba(124,58,237,.12),transparent),radial-gradient(600px 300px at 90% 100%,rgba(236,72,153,.1),transparent)' }} />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="text-center">
          <div className="soft inline-flex items-center gap-2 rounded-full border border-soft bg-card px-4 py-1.5 text-xs font-bold tracking-[.2em] text-unseen-600">🎲 CAMPUS POLLS</div>
          <h2 className="mt-3 font-grotesk text-3xl font-bold tracking-tight sm:text-[42px]">What should campus decide? <span className="grad-text">Vote anonymously.</span></h2>
          <p className="mt-1 text-sm font-medium text-muted">Anonymous voting · Live results · Sirf DEC students</p>
          <button type="button" onClick={() => profile?.isRegistered ? setComposerOpen(true) : onOpenAuth('register')} className="chip mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold"><Plus size={14} /> Create a poll</button>
        </div>
        {loading && <div className="mt-8 text-center text-sm text-muted">Loading campus polls…</div>}
        {!loading && !polls.length && <div className="card mx-auto mt-8 max-w-xl p-9 text-center"><div className="text-5xl">⚔️</div><div className="mt-3 font-grotesk font-bold">No live polls yet</div><p className="mt-1 text-sm text-muted">When a poll is published, live results will appear here.</p></div>}
        {!loading && polls.length > 0 && <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{polls.map((poll) => <article key={poll.id} className="card relative overflow-hidden p-6">
          <div className="text-[10px] font-bold tracking-[.18em] text-unseen-600">{poll.tag}</div>
          <h3 className="mt-1.5 font-grotesk text-lg font-bold leading-snug">{poll.question}</h3>
          <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-faint">{poll.totalVotes.toLocaleString()} votes · Expires {formatIndiaDate(poll.expiresAt)}</div>
          <div className="mt-4 flex flex-col gap-2.5">
            {poll.options.map((option) => {
              const selected = poll.myOptionId === option.id;
              const percent = poll.totalVotes ? Math.round(option.votes / poll.totalVotes * 100) : 0;
              return <button key={option.id} type="button" disabled={Boolean(poll.myOptionId)} onClick={() => void castVote(poll, option.id)} className={`relative overflow-hidden rounded-2xl border text-left transition ${selected ? 'border-unseen-500 ring-2 ring-unseen-200' : 'border-soft'} ${poll.myOptionId ? 'cursor-default' : 'hover:scale-[1.01]'}`}>
                <span className="poll-bar absolute inset-y-0 left-0" style={{ width: poll.myOptionId ? `${percent}%` : 0, background: option.color, opacity: poll.myOptionId ? .22 : 0 }} />
                <span className="relative flex items-center gap-2.5 p-3.5"><span className="text-xl">{option.emoji}</span><span className="flex-1 text-sm font-bold">{option.label}</span>{poll.myOptionId ? <><span className="font-grotesk text-sm font-bold">{percent}%</span>{selected && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-unseen-600 text-white"><Check size={14} /></span>}</> : <span className="text-[11px] font-bold text-faint">VOTE →</span>}</span>
              </button>;
            })}
          </div>
          <p className="mt-3 text-center text-[11px] font-semibold text-faint">{poll.myOptionId ? 'Vote sealed anonymously · results live' : 'Tap an option to vote anonymously'}</p>
          <p className="mt-3 text-right text-[10px] font-semibold text-faint">{poll.authorEmoji} {poll.author}</p>
        </article>)}</div>}
      </div>
      {composerOpen && <PollComposer onClose={() => setComposerOpen(false)} onSubmit={publish} />}
    </section>
  );
}

function PollComposer({ onClose, onSubmit }: { onClose: () => void; onSubmit: (question: string, options: string[]) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [values, setValues] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    void onSubmit(question, values).finally(() => setBusy(false));
  };
  return (
    <div className="modal active z-[90]" role="presentation">
      <button type="button" className="modal-bg" onClick={() => { if (!busy) onClose(); }} aria-label="Close poll composer" />
      <section className="modal-card card z-[1] w-full max-w-lg rounded-t-[28px] p-6 sm:rounded-[28px] sm:p-8" role="dialog" aria-modal="true" aria-labelledby="poll-compose-title">
        <div className="flex items-start justify-between"><div><div className="text-xs font-bold tracking-[.2em] text-unseen-600">CAMPUS POLL</div><h3 id="poll-compose-title" className="mt-2 font-grotesk text-2xl font-bold">Ask campus.</h3></div><button type="button" onClick={onClose} disabled={busy} className="chip flex h-9 w-9 items-center justify-center rounded-full" aria-label="Close"><X size={17} /></button></div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">Question<textarea required minLength={8} maxLength={200} rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} className="input-themed mt-1.5 w-full resize-y rounded-2xl px-4 py-3" placeholder="What should campus decide?" /></label>
          <div className="space-y-2"><div className="text-sm font-semibold">Answer options</div>{values.map((value, index) => <div key={`poll-option-${index}`} className="flex gap-2"><label htmlFor={`poll-option-${index}`} className="sr-only">Option {index + 1}</label><input id={`poll-option-${index}`} required={index < 2} maxLength={80} value={value} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="input-themed min-w-0 flex-1 rounded-2xl px-4 py-3 text-sm" placeholder={`Option ${index + 1}`} /><button type="button" disabled={busy || index < 2} onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="chip flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40" aria-label={`Remove option ${index + 1}`}><X size={15} /></button></div>)}</div>
          {values.length < 6 && <button type="button" onClick={() => setValues((current) => [...current, ''])} className="chip inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold"><Plus size={14} /> Add option</button>}
          <p className="text-[11px] text-muted">Polls expire after seven days. Your username is not shown.</p>
          <button disabled={busy || values.filter((value) => value.trim()).length < 2} className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 font-bold"><Vote size={16} />{busy ? 'Publishing…' : 'Publish poll'}</button>
        </form>
      </section>
    </div>
  );
}
