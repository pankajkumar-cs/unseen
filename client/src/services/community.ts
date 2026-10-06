import { requireSupabase } from '../lib/supabase';
import type { FeedPollRow, Json } from '../types/database';

export interface PollOption {
  id: string;
  label: string;
  emoji: string;
  color: string;
  votes: number;
}

export interface PollView {
  id: string;
  tag: string;
  question: string;
  author: string;
  authorEmoji: string;
  totalVotes: number;
  options: PollOption[];
  myOptionId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CrushView {
  id: string;
  recipient: string;
  location: string | null;
  message: string | null;
  author: string;
  emoji: string;
  color: string;
  ships: number;
  blushes: number;
  createdAt: string;
  expiresAt: string;
}

export interface MailboxView {
  id: string;
  sender: string;
  emoji: string;
  color: string;
  preview: string;
  body: string | null;
  sealed: boolean;
  sent: boolean;
  createdAt: string;
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function pollOptions(value: Json): PollOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option): PollOption[] => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return [];
    const row = option as Record<string, Json | undefined>;
    if (typeof row.id !== 'string' || typeof row.label !== 'string') return [];
    return [{
      id: row.id,
      label: row.label,
      emoji: typeof row.emoji === 'string' ? row.emoji : '✨',
      color: typeof row.color === 'string' ? row.color : '#7C3AED',
      votes: typeof row.votes === 'number' ? row.votes : 0,
    }];
  });
}

function toPoll(row: FeedPollRow): PollView {
  return {
    id: row.public_id,
    tag: row.tag,
    question: row.question,
    author: row.author_name,
    authorEmoji: row.author_emoji,
    totalVotes: row.total_votes,
    options: pollOptions(row.options),
    myOptionId: row.my_option_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function loadPolls(): Promise<PollView[]> {
  const { data, error } = await requireSupabase().rpc('feed_polls_page', { p_limit: 30 });
  throwIfError(error);
  return (data ?? []).map(toPoll);
}

export async function loadPulseStats() {
  const { data, error } = await requireSupabase().rpc('feed_pulse_stats');
  throwIfError(error);
  return data?.[0] ?? null;
}

export async function createPoll(question: string, tag: string, options: Array<{ label: string; emoji: string; color: string }>) {
  const { data, error } = await requireSupabase().rpc('create_poll', {
    p_question: question,
    p_tag: tag,
    p_options: options as Json,
  });
  throwIfError(error);
  if (!data?.[0]) throw new Error('Poll could not be published.');
}

export async function votePoll(pollId: string, optionId: string) {
  const { data, error } = await requireSupabase().rpc('set_poll_vote', {
    p_poll_public_id: pollId,
    p_option_id: optionId,
  });
  throwIfError(error);
  return data?.[0] ?? null;
}

export async function loadCrushes(): Promise<CrushView[]> {
  const { data, error } = await requireSupabase().from('crushes')
    .select('public_id,recipient,location,message,author_name,author_emoji,author_color,ships_count,blushes_count,created_at,expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  throwIfError(error);
  return (data ?? []).map((row) => ({
    id: row.public_id,
    recipient: row.recipient,
    location: row.location,
    message: row.message,
    author: row.author_name,
    emoji: row.author_emoji,
    color: row.author_color,
    ships: row.ships_count,
    blushes: row.blushes_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

export async function createCrush(recipient: string, location: string, message: string) {
  const { data, error } = await requireSupabase().rpc('create_crush', {
    p_recipient: recipient,
    p_location: location,
    p_message: message,
  });
  throwIfError(error);
  return data?.[0] ?? null;
}

export async function reactToCrush(crushId: string, kind: 'ship' | 'blush') {
  const { data, error } = await requireSupabase().rpc('increment_crush_reaction', {
    p_crush_public_id: crushId,
    p_kind: kind,
  });
  throwIfError(error);
  return data?.[0] ?? null;
}

export async function loadMailbox(): Promise<MailboxView[]> {
  const { data, error } = await requireSupabase().rpc('list_mailbox_messages');
  throwIfError(error);
  return (data ?? []).map((row) => ({
    id: row.public_id,
    sender: row.sender_name,
    emoji: row.sender_emoji,
    color: row.sender_color,
    preview: row.preview,
    body: row.body,
    sealed: row.is_sealed,
    sent: row.sent,
    createdAt: row.created_at,
  }));
}

export async function activeGhostProfiles() {
  const { data, error } = await requireSupabase().rpc('active_ghost_profiles');
  throwIfError(error);
  return data ?? [];
}

export async function sendMailboxMessage(ghostId: string, body: string) {
  const { error } = await requireSupabase().rpc('send_mailbox_message', {
    p_recipient_ghost_id: ghostId,
    p_body: body,
  });
  throwIfError(error);
}

export async function openMailboxMessage(publicId: string) {
  const { data, error } = await requireSupabase().rpc('open_mailbox_message', { p_public_id: publicId });
  throwIfError(error);
  const opened = data?.[0];
  if (!opened) throw new Error('This envelope is unavailable or has expired.');
  return opened;
}
