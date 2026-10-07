import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const encoder = new TextEncoder();
const animals = [
  ['Panda', '🐼', '#FEF3C7'], ['Owl', '🦉', '#EDE9FE'], ['Fox', '🦊', '#FFEDD5'],
  ['Frog', '🐸', '#DCFCE7'], ['Tiger', '🐯', '#FFEDD5'], ['Peacock', '🦚', '#CCFBF1'],
  ['Wolf', '🐺', '#E0E7FF'], ['Cat', '🐱', '#FCE7F3'],
] as const;

type AuthBody = {
  action?: 'validate-invitation' | 'register' | 'login';
  invitationCode?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalizeUsername(value: unknown) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

function normalizeCode(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function genericCredentialError() {
  return json({ error: 'Invalid username or password.' }, 401);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !serviceKey || !publicKey) {
    return json({ error: 'Authentication is not configured. Please contact UNSEEN support.' }, 503);
  }

  let body: AuthBody;
  try {
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > 16_384) return json({ error: 'Request is too large.' }, 413);
    body = await request.json() as AuthBody;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const publicClient = createClient(supabaseUrl, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const username = normalizeUsername(body.username);
  const clientIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const attemptKey = await sha256(`unseen-auth:${clientIp}:${username || 'invitation'}`);
  const { data: allowed, error: limitError } = await admin.rpc('take_auth_attempt', {
    p_attempt_key: attemptKey,
    p_max_attempts: 10,
  });
  if (limitError) return json({ error: 'Authentication is temporarily unavailable.' }, 503);
  if (!allowed) return json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429);

  if (body.action === 'validate-invitation') {
    const code = normalizeCode(body.invitationCode);
    if (!code) return json({ error: 'Invitation code is required.' }, 400);
    const plainDigest = await sha256(code);
    const { data: invitation, error } = await admin.from('invitation_codes')
      .select('status')
      .eq('digest_algorithm', 'sha256')
      .eq('code_digest', plainDigest)
      .maybeSingle();
    if (error) return json({ error: 'Could not validate this invitation right now.' }, 503);
    if (!invitation) return json({ error: 'Invalid invitation code.' }, 400);
    if (invitation.status === 'CLAIMED') return json({ error: 'This invitation code has already been used.' }, 409);
    if (invitation.status === 'REVOKED') return json({ error: 'This invitation code is no longer active.' }, 410);
    return json({ valid: true });
  }

  if (body.action === 'register') {
    const code = normalizeCode(body.invitationCode);
    const password = String(body.password ?? '');
    if (!code) return json({ error: 'Invitation code is required.' }, 400);
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return json({ error: 'Choose a username with 3–20 letters, numbers, or underscores.' }, 400);
    }
    if (password.length < 10 || password.length > 128) return json({ error: 'Choose a password with at least 10 characters.' }, 400);
    if (password !== String(body.confirmPassword ?? '')) return json({ error: 'Passwords do not match. Re-enter the same password in both fields.' }, 400);
    const { data: existing, error: existingError } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (existingError) return json({ error: 'We could not check username availability right now. Please try again shortly.' }, 503);
    if (existing) return json({ error: 'Username already taken.' }, 409);

    const codeDigest = await sha256(code);
    const identity = animals[crypto.getRandomValues(new Uint32Array(1))[0] % animals.length];
    const displayName = `Anonymous ${identity[0]} #${100 + (crypto.getRandomValues(new Uint16Array(1))[0] % 900)}`;
    const ghostId = crypto.randomUUID();
    const email = `${username}@auth.unseen.invalid`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { unseen_username: username },
    });
    if (createError || !created.user) {
      if (createError?.message.toLowerCase().includes('already')) return json({ error: 'Username already taken.' }, 409);
      return json({ error: 'We could not create your account. Please try again.' }, 500);
    }

    const { error: claimError } = await admin.rpc('claim_invited_account', {
      p_user_id: created.user.id,
      p_username: username,
      p_code_digest: codeDigest,
      p_display_name: displayName,
      p_emoji: identity[1],
      p_color: identity[2],
      p_ghost_id: ghostId,
    });
    if (claimError) {
      await admin.auth.admin.deleteUser(created.user.id);
      if (claimError.code === '23505') return json({ error: 'Username already taken.' }, 409);
      if (claimError.message.includes('invalid or used invitation')) return json({ error: 'This invitation code is invalid, used, or revoked.' }, 409);
      return json({ error: 'We could not create your account. Please try again.' }, 500);
    }

    const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) {
      return json({ error: 'Your account was created. Sign in with your username and password to continue.' }, 201);
    }
    return json({ success: true, session: signedIn.session }, 201);
  }

  if (body.action === 'login') {
    const password = String(body.password ?? '');
    if (!/^[a-z0-9_]{3,20}$/.test(username) || !password) return genericCredentialError();
    const { data: account, error: accountError } = await admin.from('profiles')
      .select('id, moderation_status')
      .eq('username', username)
      .maybeSingle();
    if (accountError) return json({ error: 'Authentication is temporarily unavailable.' }, 503);
    if (!account) return genericCredentialError();
    if (account.moderation_status !== 'ACTIVE') {
      return json({ error: 'This account is suspended or banned. Contact UNSEEN moderators.' }, 403);
    }

    const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({
      email: `${username}@auth.unseen.invalid`,
      password,
    });
    if (signInError || !signedIn.session) return genericCredentialError();
    return json({ success: true, session: signedIn.session });
  }

  return json({ error: 'Unknown authentication action.' }, 400);
});
