import { useState } from 'react';

const reportReasons = [
  'Harassment / Bullying', 'Spam / Irrelevant', 'Personal Info (Doxxing)',
  'Hate / abusive content', 'Sexual content', 'Threat', 'Personal information', 'Impersonation', 'Other',
];

export function ReportDialog({ onClose, onSubmit, title = 'Report for review' }: {
  onClose: () => void;
  onSubmit: (reason: string, detail: string) => Promise<void>;
  title?: string;
}) {
  const [reason, setReason] = useState(reportReasons[0]);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal active z-[110]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <button type="button" className="modal-bg" aria-label="Close report dialog" onClick={() => { if (!busy) onClose(); }} />
      <section className="modal-card card z-[1] w-full max-w-md rounded-t-[28px] p-6 sm:rounded-[28px]" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h3 id="report-title" className="font-grotesk text-xl font-bold">{title}</h3>
        <p className="mt-1 text-sm text-muted">Reports are only visible to the UNSEEN moderation team.</p>
        <form onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSubmit(reason, detail).finally(() => setBusy(false)); }} className="mt-4 space-y-3">
          <label className="block text-sm font-semibold">Reason<select value={reason} onChange={(event) => setReason(event.target.value)} className="input-themed mt-1.5 w-full rounded-2xl px-4 py-3">{reportReasons.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="block text-sm font-semibold">Details <span className="font-normal text-faint">(optional)</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={500} rows={3} className="input-themed mt-1.5 w-full resize-y rounded-2xl px-4 py-3" placeholder="Add context for the moderators" /></label>
          <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="chip flex-1 rounded-full px-4 py-3 text-sm font-bold">Cancel</button><button disabled={busy} className="btn-primary flex-1 rounded-full px-4 py-3 text-sm font-bold">{busy ? 'Sending…' : 'Send report'}</button></div>
        </form>
      </section>
    </div>
  );
}
