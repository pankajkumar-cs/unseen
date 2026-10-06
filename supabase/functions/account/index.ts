import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }

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
  let body: { action?: string };
  try { body = await request.json() as { action?: string }; }
  catch { return json({ error: 'Invalid request.' }, 400); }
  if (body.action !== 'delete') return json({ error: 'Unknown account action.' }, 400);

  const { data: media, error: mediaError } = await admin.from('media').select('storage_path').eq('owner_user_id', authData.user.id);
  if (mediaError) return json({ error: 'Could not prepare your account data for deletion.' }, 503);
  const paths = (media ?? []).map((row) => row.storage_path).filter((path): path is string => typeof path === 'string');
  if (paths.length) {
    const { error: storageError } = await admin.storage.from('unseen-media').remove(paths);
    if (storageError) return json({ error: 'Your account is safe, but some images could not be removed. Please try again.' }, 503);
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
  if (deleteError) return json({ error: 'Your account could not be deleted. Please try again.' }, 503);
  return json({ success: true });
});
