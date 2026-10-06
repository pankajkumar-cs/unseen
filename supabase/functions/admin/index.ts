import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers });
const encoder = new TextEncoder();
async function digest(value: string) {
  const data = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function safeReason(value: unknown) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500); }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !serviceKey || !publicKey) return json({ error: 'Moderation service is not configured.' }, 503);
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return json({ error: 'An administrator sign-in is required.' }, 401);
  const caller = createClient(supabaseUrl, publicKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await caller.auth.getUser(bearer);
  if (userError || !userData.user || userData.user.is_anonymous) return json({ error: 'An administrator sign-in is required.' }, 401);
  let body: Record<string, unknown>;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 24_000) return json({ error: 'Request is too large.' }, 413);
    body = await request.json() as Record<string, unknown>;
  } catch { return json({ error: 'Invalid request.' }, 400); }
  const action = String(body.action ?? '');
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('id,username,role,moderation_status').eq('id', userData.user.id).maybeSingle();
  if (profileError) return json({ error: 'Could not check administrator access.' }, 503);
  if (!profile || profile.role !== 'ADMIN' || profile.moderation_status !== 'ACTIVE') return json({ error: 'Administrator access is required.' }, 403);

  const recordAction = async (name: string, targetType: string, targetId: string, reason = '', metadata: Record<string, unknown> = {}) => {
    const { data: identity } = await admin.from('anonymous_identities').select('display_name').eq('user_id', profile.id).maybeSingle();
    const { error } = await admin.from('admin_actions').insert({
      admin_user_id: profile.id,
      admin_identity: identity?.display_name ?? 'Admin',
      action: name,
      target_type: targetType,
      target_id: targetId,
      reason,
      metadata,
    });
    if (error) throw new Error('The action could not be recorded; no moderation change was applied.');
  };

  try {
    if (action === 'overview') {
      const [accounts, posts, reports, media, chats, waiting] = await Promise.all([
        admin.from('profiles').select('id', { count: 'exact', head: true }).eq('moderation_status', 'ACTIVE'),
        admin.from('posts').select('id', { count: 'exact', head: true }).gt('expires_at', new Date().toISOString()),
        admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        admin.from('media').select('id', { count: 'exact', head: true }),
        admin.from('random_chat_sessions').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
        admin.from('random_chat_queue').select('user_id', { count: 'exact', head: true }).eq('status', 'WAITING').gt('expires_at', new Date().toISOString()),
      ]);
      if ([accounts, posts, reports, media, chats, waiting].some((result) => result.error)) return json({ error: 'Could not load the campus overview.' }, 503);
      return json({ overview: { activeAccounts: accounts.count ?? 0, posts: posts.count ?? 0, openReports: reports.count ?? 0, media: media.count ?? 0, activeChats: chats.count ?? 0, waiting: waiting.count ?? 0 } });
    }
    if (action === 'users') {
      const { data, error } = await admin.from('profiles').select('id,username,role,moderation_status,moderation_reason,created_at').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: 'Could not load campus accounts.' }, 503);
      return json({ rows: data ?? [] });
    }
    if (action === 'posts') {
      const { data, error } = await admin.from('posts').select('public_id,category,body,status,author_name,created_at,expires_at').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: 'Could not load posts for review.' }, 503);
      return json({ rows: (data ?? []).map((row) => ({ ...row, id: row.public_id })) });
    }
    if (action === 'reports') {
      const { data, error } = await admin.from('reports').select('id,target_type,post_public_id,comment_id,reported_user_id,reason,detail,status,created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: 'Could not load open reports.' }, 503);
      return json({ rows: data ?? [] });
    }
    if (action === 'comments') {
      const { data, error } = await admin.from('comments').select('public_id,post_public_id,body,author_name,created_at').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: 'Could not load comments for review.' }, 503);
      return json({ rows: (data ?? []).map((row) => ({ ...row, id: row.public_id })) });
    }
    if (action === 'media') {
      const { data: media, error } = await admin.from('media')
        .select('id,owner_user_id,post_public_id,storage_path,file_size_bytes,created_at')
        .order('created_at', { ascending: false }).limit(60);
      if (error) return json({ error: 'Could not load campus images for review.' }, 503);
      const userIds = [...new Set((media ?? []).map((row) => row.owner_user_id))];
      const [identities, signed] = await Promise.all([
        userIds.length ? admin.from('anonymous_identities').select('user_id,display_name').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
        media?.length ? admin.storage.from('unseen-media').createSignedUrls(media.map((row) => row.storage_path), 300) : Promise.resolve({ data: [], error: null }),
      ]);
      if (identities.error || signed.error) return json({ error: 'Could not prepare images for moderation review.' }, 503);
      const names = new Map((identities.data ?? []).map((row) => [row.user_id, row.display_name]));
      const urls = new Map((signed.data ?? []).flatMap((row) => row.path && row.signedUrl ? [[row.path, row.signedUrl] as const] : []));
      return json({ rows: (media ?? []).map((row) => ({
        id: row.id,
        post_public_id: row.post_public_id,
        author_name: names.get(row.owner_user_id) ?? 'Anonymous Ghost',
        signed_url: urls.get(row.storage_path) ?? null,
        file_size_bytes: row.file_size_bytes,
        created_at: row.created_at,
      })) });
    }
    if (action === 'chat-reports') {
      const { data: reports, error } = await admin.from('random_chat_reports').select('id,session_id,reporter_id,reported_id,reason,detail,status,created_at').eq('status', 'OPEN').order('created_at', { ascending: false }).limit(40);
      if (error) return json({ error: 'Could not load Random Chat reports.' }, 503);
      const sessionIds = [...new Set((reports ?? []).map((row) => row.session_id))];
      const userIds = [...new Set((reports ?? []).flatMap((row) => [row.reporter_id, row.reported_id]))];
      const [profileRows, messages] = await Promise.all([
        userIds.length ? admin.from('anonymous_identities').select('user_id,display_name').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
        sessionIds.length ? admin.from('random_chat_messages').select('session_id,sender_profile,body,created_at').in('session_id', sessionIds).order('created_at', { ascending: true }).limit(200) : Promise.resolve({ data: [], error: null }),
      ]);
      if (profileRows.error || messages.error) return json({ error: 'Could not load the reported chat context.' }, 503);
      const names = new Map((profileRows.data ?? []).map((row) => [row.user_id, row.display_name]));
      const chats = new Map<string, Array<{ from: string; body: string; created_at: string }>>();
      for (const row of messages.data ?? []) {
        const list = chats.get(row.session_id) ?? [];
        const sender = row.sender_profile && typeof row.sender_profile === 'object' ? row.sender_profile as { name?: string } : {};
        list.push({ from: sender.name ?? 'Anonymous Ghost', body: row.body, created_at: row.created_at });
        chats.set(row.session_id, list);
      }
      return json({ rows: (reports ?? []).map((row) => ({ ...row, id: row.id, reporter: names.get(row.reporter_id) ?? 'Unavailable', reported: names.get(row.reported_id) ?? 'Unavailable', messages: chats.get(row.session_id) ?? [] })) });
    }
    if (action === 'invitations') {
      const { data, error } = await admin.from('invitation_codes').select('id,status,created_at,claimed_at').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: 'Could not load invitation status.' }, 503);
      return json({ rows: data ?? [] });
    }
    if (action === 'audit') {
      const { data, error } = await admin.from('admin_actions').select('id,admin_identity,action,target_type,target_id,reason,metadata,created_at').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: 'Could not load the moderation log.' }, 503);
      return json({ rows: data ?? [] });
    }
    if (action === 'create-invitation') {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const parts = Array.from({ length: 4 }, (_, part) => [...bytes.slice(part * 4, part * 4 + 4)].map((byte) => alphabet[byte % alphabet.length]).join(''));
      const code = `UNSEEN-${parts.join('-')}`;
      const codeDigest = await digest(code.toUpperCase());
      const { data, error } = await admin.from('invitation_codes').insert({ code_digest: codeDigest, digest_algorithm: 'sha256', status: 'UNUSED', created_by: profile.id }).select('id').single();
      if (error) return json({ error: 'Could not create an invitation.' }, 503);
      try { await recordAction('ADMIN_CREATED_INVITATION', 'invitation', data.id, '', {}); }
      catch { await admin.from('invitation_codes').delete().eq('id', data.id); throw new Error('The invitation was removed because its audit entry could not be written.'); }
      return json({ invitation: { id: data.id, code } }, 201);
    }
    const id = String(body.id ?? '');
    const reason = safeReason(body.reason);
    if (!id) return json({ error: 'A target is required.' }, 400);
    if (action === 'set-user-status') {
      const status = body.status;
      if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(String(status))) return json({ error: 'Invalid account status.' }, 400);
      if (id === profile.id && status !== 'ACTIVE') return json({ error: 'You cannot restrict your own administrator account.' }, 409);
      const { data: target, error: targetError } = await admin.from('profiles').select('id,role,moderation_status').eq('id', id).maybeSingle();
      if (targetError || !target) return json({ error: 'Account not found.' }, 404);
      if (target.role === 'ADMIN' && status !== 'ACTIVE') {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ADMIN').eq('moderation_status', 'ACTIVE');
        if ((count ?? 0) <= 1) return json({ error: 'The final active administrator cannot be restricted.' }, 409);
      }
      const { error } = await admin.from('profiles').update({ moderation_status: status, moderation_reason: reason || null, suspended_at: status === 'ACTIVE' ? null : new Date().toISOString() }).eq('id', id);
      if (error) return json({ error: 'Could not update the account status.' }, 503);
      await recordAction(`ADMIN_${status}_USER`, 'user', id, reason, { status });
      if (status !== 'ACTIVE') {
        await admin.from('random_chat_queue').delete().eq('user_id', id);
        const { data: rooms } = await admin.from('random_chat_sessions').select('id').eq('status', 'ACTIVE').or(`user_a_id.eq.${id},user_b_id.eq.${id}`);
        const roomIds = (rooms ?? []).map((room) => room.id);
        if (roomIds.length) {
          await admin.from('random_chat_sessions').update({ status: 'ENDED', ended_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }).in('id', roomIds);
          await admin.from('random_chat_messages').update({ expires_at: new Date(Date.now() + 86_400_000).toISOString() }).in('session_id', roomIds).is('expires_at', null);
        }
      }
      await admin.from('moderation_actions').insert({ account_id: id, action: `account-${String(status).toLowerCase()}`, admin_user_id: profile.id });
      return json({ success: true });
    }
    if (action === 'set-user-role') {
      const role = body.role;
      if (!['USER', 'ADMIN'].includes(String(role))) return json({ error: 'Invalid account role.' }, 400);
      const { data: target, error: targetError } = await admin.from('profiles').select('id,role,moderation_status').eq('id', id).maybeSingle();
      if (targetError || !target) return json({ error: 'Account not found.' }, 404);
      if (target.role === 'ADMIN' && role === 'USER' && target.moderation_status === 'ACTIVE') {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ADMIN').eq('moderation_status', 'ACTIVE');
        if ((count ?? 0) <= 1) return json({ error: 'The final active administrator cannot be demoted.' }, 409);
      }
      const { error } = await admin.from('profiles').update({ role }).eq('id', id);
      if (error) return json({ error: 'Could not update this account role.' }, 503);
      await recordAction(role === 'ADMIN' ? 'ADMIN_PROMOTED_USER' : 'ADMIN_DEMOTED_USER', 'user', id, reason, { role });
      return json({ success: true });
    }
    if (action === 'delete-user') {
      if (body.confirmation !== 'DELETE USER') return json({ error: 'Type DELETE USER to confirm permanent account deletion.' }, 400);
      if (id === profile.id) return json({ error: 'You cannot delete your own administrator account.' }, 409);
      const { data: target, error: targetError } = await admin.from('profiles').select('id,role').eq('id', id).maybeSingle();
      if (targetError || !target) return json({ error: 'Account not found.' }, 404);
      if (target.role === 'ADMIN') {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ADMIN');
        if ((count ?? 0) <= 1) return json({ error: 'The final administrator account cannot be deleted.' }, 409);
      }
      await recordAction('ADMIN_DELETE_USER_STARTED', 'user', id, reason, {});
      const { data: media, error: mediaError } = await admin.from('media').select('storage_path').eq('owner_user_id', id);
      if (mediaError) return json({ error: 'Could not prepare the account for deletion.' }, 503);
      const paths = (media ?? []).map((row) => row.storage_path).filter((path): path is string => typeof path === 'string');
      if (paths.length) {
        const { error } = await admin.storage.from('unseen-media').remove(paths);
        if (error) return json({ error: 'The account remains intact, but its images could not be deleted.' }, 503);
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: 'Could not delete this account.' }, 503);
      await recordAction('ADMIN_DELETED_USER', 'user', id, reason, {});
      return json({ success: true });
    }
    if (action === 'moderate-post') {
      const postAction = String(body.postAction ?? '');
      const status = postAction === 'hide' ? 'hidden' : postAction === 'delete' ? 'deleted' : postAction === 'restore' ? 'approved' : null;
      if (!status) return json({ error: 'Invalid post action.' }, 400);
      const now = new Date().toISOString();
      const patch = { status, hidden_at: status === 'hidden' ? now : null, hidden_by: status === 'hidden' ? profile.id : null, deleted_at: status === 'deleted' ? now : null, deleted_by: status === 'deleted' ? profile.id : null, deletion_reason: status === 'deleted' ? reason || 'Removed by campus moderation' : null };
      const { data, error } = await admin.from('posts').update(patch).eq('public_id', id).select('id').maybeSingle();
      if (error || !data) return json({ error: 'Could not update this post.' }, 503);
      await recordAction(`ADMIN_${postAction.toUpperCase()}_POST`, 'post', id, reason, { status });
      await admin.from('moderation_actions').insert({ post_public_id: id, action: `post-${postAction}`, admin_user_id: profile.id });
      if (status !== 'approved') await admin.from('reports').update({ status: 'resolved', reviewed_by: profile.id, reviewed_at: now, moderation_action: postAction }).eq('post_public_id', id).eq('status', 'open');
      return json({ success: true });
    }
    if (action === 'resolve-report') {
      const status = body.status;
      if (!['resolved', 'dismissed'].includes(String(status))) return json({ error: 'Invalid report status.' }, 400);
      const { error } = await admin.from('reports').update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), moderation_action: safeReason(body.action) || String(status) }).eq('id', id).eq('status', 'open');
      if (error) return json({ error: 'Could not update this report.' }, 503);
      await recordAction(`ADMIN_${String(status).toUpperCase()}_REPORT`, 'report', id, reason, {});
      return json({ success: true });
    }
    if (action === 'resolve-chat-report') {
      const status = body.status;
      if (!['REVIEWED', 'DISMISSED'].includes(String(status))) return json({ error: 'Invalid chat report status.' }, 400);
      const { data: report, error } = await admin.from('random_chat_reports').update({ status }).eq('id', id).eq('status', 'OPEN').select('session_id').maybeSingle();
      if (error || !report) return json({ error: 'Could not update this chat report.' }, 503);
      const { count } = await admin.from('random_chat_reports').select('id', { count: 'exact', head: true }).eq('session_id', report.session_id).eq('status', 'OPEN');
      if ((count ?? 0) === 0) {
        await admin.from('random_chat_sessions').update({ moderation_hold: false, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }).eq('id', report.session_id);
        await admin.from('random_chat_messages').update({ expires_at: new Date(Date.now() + 86_400_000).toISOString() }).eq('session_id', report.session_id).is('expires_at', null);
      }
      await recordAction(`ADMIN_${String(status)}_RANDOM_CHAT_REPORT`, 'random_chat_report', id, reason, {});
      return json({ success: true });
    }
    if (action === 'moderate-comment') {
      const { data: comment, error: findError } = await admin.from('comments').select('id,post_public_id').eq('public_id', id).maybeSingle();
      if (findError || !comment) return json({ error: 'Comment not found.' }, 404);
      const { error } = await admin.from('comments').delete().eq('id', comment.id);
      if (error) return json({ error: 'Could not remove this comment.' }, 503);
      await recordAction('ADMIN_DELETED_COMMENT', 'comment', id, reason, { post_public_id: comment.post_public_id });
      return json({ success: true });
    }
    if (action === 'remove-media') {
      const { data: media, error: mediaError } = await admin.from('media')
        .select('id,owner_user_id,post_public_id,storage_path').eq('id', id).maybeSingle();
      if (mediaError || !media) return json({ error: 'Image not found.' }, 404);
      await recordAction('ADMIN_MEDIA_REMOVAL_STARTED', 'media', id, reason, { post_public_id: media.post_public_id });
      const { error: storageError } = await admin.storage.from('unseen-media').remove([media.storage_path]);
      if (storageError) return json({ error: 'The image is still attached to its post because storage removal failed.' }, 503);
      const { error: deleteError } = await admin.from('media').delete().eq('id', id);
      if (deleteError) return json({ error: 'The image file is gone, but its metadata still needs moderation cleanup.' }, 503);
      await recordAction('ADMIN_REMOVED_MEDIA', 'media', id, reason, { post_public_id: media.post_public_id });
      return json({ success: true });
    }
    if (action === 'revoke-invitation') {
      const { data, error } = await admin.from('invitation_codes').update({ status: 'REVOKED' }).eq('id', id).eq('status', 'UNUSED').select('id').maybeSingle();
      if (error || !data) return json({ error: 'Only an unused invitation can be revoked.' }, 409);
      await recordAction('ADMIN_REVOKED_INVITATION', 'invitation', id, reason, {});
      return json({ success: true });
    }
    return json({ error: 'Unknown moderation action.' }, 400);
  } catch {
    return json({ error: 'The moderation action could not be completed.' }, 500);
  }
});
