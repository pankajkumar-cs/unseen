import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !serviceKey || !publicKey) return json({ error: 'Account service is not configured.' }, 503);
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return json({ error: 'Sign in to manage your account.' }, 401);
  const caller = createClient(supabaseUrl, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await caller.auth.getUser(bearer);
  if (authError || !authData.user || authData.user.is_anonymous) return json({ error: 'An active account is required.' }, 401);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: { action?: string; password?: string };
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 8_192) return json({ error: 'Request is too large.' }, 413);
    body = await request.json() as { action?: string; password?: string };
  } catch { return json({ error: 'Invalid request.' }, 400); }
  if (body.action !== 'delete') return json({ error: 'Unknown account action.' }, 400);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 128) return json({ error: 'Enter your current password to delete your account.' }, 400);

  const attemptKey = await sha256(`unseen-account-delete:${authData.user.id}`);
  const { data: allowed, error: limitError } = await admin.rpc('take_auth_attempt', {
    p_attempt_key: attemptKey,
    p_max_attempts: 5,
  });
  if (limitError) return json({ error: 'Account service is temporarily unavailable.' }, 503);
  if (!allowed) return json({ error: 'Too many deletion attempts. Wait 15 minutes and try again.' }, 429);

  const { data: account, error: profileError } = await admin.from('profiles')
    .select('id,username,role').eq('id', authData.user.id).maybeSingle();
  if (profileError || !account) return json({ error: 'The account could not be verified.' }, 503);
  const { error: passwordError } = await caller.auth.signInWithPassword({
    email: `${account.username}@auth.unseen.invalid`,
    password,
  });
  if (passwordError) return json({ error: 'Your current password is incorrect.' }, 401);

  if (account.role === 'ADMIN') {
    const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true })
      .eq('role', 'ADMIN').eq('moderation_status', 'ACTIVE');
    if (error) return json({ error: 'Could not verify administrator access.' }, 503);
    if ((count ?? 0) <= 1) return json({ error: 'The final active administrator cannot delete this account.' }, 409);
  }

  const { data: media, error: mediaError } = await admin.from('media').select('storage_path').eq('owner_user_id', authData.user.id);
  if (mediaError) return json({ error: 'Could not prepare your account data for deletion.' }, 503);
  const paths = (media ?? []).map((row) => row.storage_path).filter((path): path is string => typeof path === 'string');
  if (paths.length) {
    const { error: storageError } = await admin.storage.from('unseen-media').remove(paths);
    if (storageError) return json({ error: 'Your account is safe, but some images could not be removed. Please try again.' }, 503);
  }

  if (account.role === 'ADMIN') {
    const { error } = await admin.rpc('admin_manage_user', {
      p_admin_user_id: account.id,
      p_target_user_id: account.id,
      p_action: 'delete-user',
      p_role: null,
      p_status: null,
      p_reason: 'Account owner requested deletion after password verification.',
    });
    if (error) {
      if (error.code === '23514') return json({ error: 'The final active administrator cannot delete this account.' }, 409);
      return json({ error: 'Your account could not be deleted. Please try again.' }, 503);
    }
  } else {
    const { error } = await admin.auth.admin.deleteUser(authData.user.id);
    if (error) return json({ error: 'Your account could not be deleted. Please try again.' }, 503);
  }
  return json({ success: true });
});
