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

function manageUserError(error: { code?: string; message?: string }) {
  if (error.code === 'P0002') return { message: 'Account not found.', status: 404 };
  if (error.code === '42501') return { message: 'Administrator access is required.', status: 403 };
  if (error.code === '23514' || error.code === '22023') {
    const reason = error.message ?? '';
    if (reason.includes('demoted')) return { message: 'The final active administrator cannot be demoted.', status: 409 };
    if (reason.includes('restricted')) return { message: 'The final active administrator cannot be restricted.', status: 409 };
    if (reason.includes('deleted')) return { message: 'The final active administrator cannot be deleted.', status: 409 };
    return { message: 'The requested account change is invalid.', status: 409 };
  }
  return { message: 'Could not update this account. Please try again.', status: 503 };
}

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
  const requestedPage = Number(body.page ?? 0);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(0, Math.min(requestedPage, 100_000)) : 0;
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
      const [accounts, posts, polls, crushes, reports, media] = await Promise.all([
        admin.from('profiles').select('id', { count: 'exact', head: true }).eq('moderation_status', 'ACTIVE'),
        admin.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'approved').gt('expires_at', new Date().toISOString()),
        admin.from('polls').select('id', { count: 'exact', head: true }).eq('status', 'published').gt('expires_at', new Date().toISOString()),
        admin.from('crushes').select('id', { count: 'exact', head: true }).eq('status', 'published').gt('expires_at', new Date().toISOString()),
        admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        admin.from('media').select('id', { count: 'exact', head: true }),
      ]);
      if ([accounts, posts, polls, crushes, reports, media].some((result) => result.error)) return json({ error: 'Could not load the campus overview.' }, 503);
      return json({ overview: { activeAccounts: accounts.count ?? 0, posts: posts.count ?? 0, polls: polls.count ?? 0, crushes: crushes.count ?? 0, openReports: reports.count ?? 0, media: media.count ?? 0 } });
    }
    if (action === 'users') {
      const search = String(body.search ?? '').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
      let query = admin.from('profiles').select('id,username,role,moderation_status,moderation_reason,created_at', { count: 'exact' })
        .order('created_at', { ascending: false });
      if (search) query = query.ilike('username', `${search}%`);
      const { data, error, count } = await query.range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load campus accounts.' }, 503);
      return json({ rows: data ?? [], total: count ?? 0, pageSize: 100 });
    }
    if (action === 'posts') {
      const { data, error, count } = await admin.from('posts').select('public_id,category,body,status,author_name,created_at,expires_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load posts for review.' }, 503);
      return json({ rows: (data ?? []).map((row) => ({ ...row, id: row.public_id })), total: count ?? 0, pageSize: 100 });
    }
    if (action === 'polls') {
      const { data, error, count } = await admin.from('polls').select('public_id,question,tag,status,author_name,total_votes,created_at,expires_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load polls for review.' }, 503);
      return json({ rows: (data ?? []).map((row) => ({ ...row, id: row.public_id })), total: count ?? 0, pageSize: 100 });
    }
    if (action === 'crushes') {
      const { data, error, count } = await admin.from('crushes').select('public_id,recipient,location,message,status,author_name,ships_count,blushes_count,created_at,expires_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load spotted posts for review.' }, 503);
      return json({ rows: (data ?? []).map((row) => ({ ...row, id: row.public_id })), total: count ?? 0, pageSize: 100 });
    }
    if (action === 'reports') {
      const { data, error, count } = await admin.from('reports').select('id,target_type,post_public_id,comment_id,poll_public_id,crush_public_id,reported_user_id,reason,detail,status,created_at', { count: 'exact' })
        .eq('status', 'open').order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load open reports.' }, 503);
      const reports = data ?? [];
      const ids = (field: 'post_public_id' | 'comment_id' | 'poll_public_id' | 'crush_public_id' | 'reported_user_id') => [...new Set(reports.map((row) => row[field]).filter((value): value is string => typeof value === 'string'))];
      const postIds = ids('post_public_id');
      const commentIds = ids('comment_id');
      const pollIds = ids('poll_public_id');
      const crushIds = ids('crush_public_id');
      const accountIds = ids('reported_user_id');
      const [posts, comments, polls, crushes, accounts] = await Promise.all([
        postIds.length ? admin.from('posts').select('public_id,body').in('public_id', postIds) : Promise.resolve({ data: [], error: null }),
        commentIds.length ? admin.from('comments').select('id,public_id,body').in('id', commentIds) : Promise.resolve({ data: [], error: null }),
        pollIds.length ? admin.from('polls').select('public_id,question').in('public_id', pollIds) : Promise.resolve({ data: [], error: null }),
        crushIds.length ? admin.from('crushes').select('public_id,recipient,message').in('public_id', crushIds) : Promise.resolve({ data: [], error: null }),
        accountIds.length ? admin.from('profiles').select('id,username').in('id', accountIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if ([posts, comments, polls, crushes, accounts].some((result) => result.error)) return json({ error: 'Could not prepare reported content for review.' }, 503);
      const postBodies = new Map((posts.data ?? []).map((row) => [row.public_id, row.body]));
      const commentRows = new Map((comments.data ?? []).map((row) => [row.id, row]));
      const pollQuestions = new Map((polls.data ?? []).map((row) => [row.public_id, row.question]));
      const crushMessages = new Map((crushes.data ?? []).map((row) => [row.public_id, `${row.recipient}: ${row.message ?? ''}`.trim()]));
      const usernames = new Map((accounts.data ?? []).map((row) => [row.id, row.username]));
      const rows = reports.map((row) => {
        const comment = row.comment_id ? commentRows.get(row.comment_id) : null;
        const contentPreview = row.target_type === 'comment' ? comment?.body
          : row.target_type === 'post' ? postBodies.get(row.post_public_id ?? '')
            : row.target_type === 'poll' ? pollQuestions.get(row.poll_public_id ?? '')
              : row.target_type === 'crush' ? crushMessages.get(row.crush_public_id ?? '')
                : row.target_type === 'account' ? usernames.get(row.reported_user_id ?? '') : null;
        return { ...row, comment_public_id: comment?.public_id ?? null, content_preview: String(contentPreview ?? '[Content no longer available]').slice(0, 600) };
      });
      return json({ rows, total: count ?? 0, pageSize: 100 });
    }
    if (action === 'comments') {
      const { data, error, count } = await admin.from('comments').select('public_id,post_public_id,body,author_name,created_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load comments for review.' }, 503);
      return json({ rows: (data ?? []).map((row) => ({ ...row, id: row.public_id })), total: count ?? 0, pageSize: 100 });
    }
    if (action === 'media') {
      const { data: media, error, count } = await admin.from('media')
        .select('id,owner_user_id,post_public_id,storage_path,file_size_bytes,created_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 60, page * 60 + 59);
      if (error) return json({ error: 'Could not load campus images for review.' }, 503);
      const userIds = [...new Set((media ?? []).map((row) => row.owner_user_id))];
      const [identities, signed] = await Promise.all([
        userIds.length ? admin.from('anonymous_identities').select('user_id,display_name').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
        media?.length ? admin.storage.from('unseen-media').createSignedUrls(media.map((row) => row.storage_path), 300) : Promise.resolve({ data: [], error: null }),
      ]);
      if (identities.error || signed.error) return json({ error: 'Could not prepare images for moderation review.' }, 503);
      const names = new Map((identities.data ?? []).map((row) => [row.user_id, row.display_name]));
      const urls = new Map((signed.data ?? []).flatMap((row) => row.path && row.signedUrl ? [[row.path, row.signedUrl] as const] : []));
      const rows = (media ?? []).map((row) => ({
        id: row.id,
        post_public_id: row.post_public_id,
        author_name: names.get(row.owner_user_id) ?? 'Anonymous Ghost',
        signed_url: urls.get(row.storage_path) ?? null,
        file_size_bytes: row.file_size_bytes,
        created_at: row.created_at,
      }));
      return json({ rows, total: count ?? 0, pageSize: 60 });
    }
    if (action === 'invitations') {
      const { data, error, count } = await admin.from('invitation_codes').select('id,status,created_at,claimed_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load invitation status.' }, 503);
      return json({ rows: data ?? [], total: count ?? 0, pageSize: 100 });
    }
    if (action === 'audit') {
      const { data, error, count } = await admin.from('admin_actions').select('id,admin_identity,action,target_type,target_id,reason,metadata,created_at', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * 100, page * 100 + 99);
      if (error) return json({ error: 'Could not load the moderation log.' }, 503);
      return json({ rows: data ?? [], total: count ?? 0, pageSize: 100 });
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
      const { error } = await admin.rpc('admin_manage_user', {
        p_admin_user_id: profile.id, p_target_user_id: id, p_action: action,
        p_role: null, p_status: status, p_reason: reason,
      });
      if (error) { const mapped = manageUserError(error); return json({ error: mapped.message }, mapped.status); }
      const { error: moderationError } = await admin.from('moderation_actions').insert({ account_id: id, action: `account-${String(status).toLowerCase()}`, admin_user_id: profile.id });
      return json({ success: true, ...(moderationError ? { warning: 'The account status changed and was audited, but the secondary moderation log could not be updated.' } : {}) });
    }
    if (action === 'set-user-role') {
      const role = body.role;
      if (!['USER', 'ADMIN'].includes(String(role))) return json({ error: 'Invalid account role.' }, 400);
      if (id === profile.id && role !== 'ADMIN') return json({ error: 'You cannot remove your own administrator access.' }, 409);
      const { error } = await admin.rpc('admin_manage_user', {
        p_admin_user_id: profile.id, p_target_user_id: id, p_action: action,
        p_role: role, p_status: null, p_reason: reason,
      });
      if (error) { const mapped = manageUserError(error); return json({ error: mapped.message }, mapped.status); }
      return json({ success: true });
    }
    if (action === 'set-user-password') {
      const password = String(body.password ?? '');
      const confirmPassword = String(body.confirmPassword ?? '');
      if (password.length < 10 || password.length > 128) {
        return json({ error: 'Choose a password between 10 and 128 characters.' }, 400);
      }
      if (password !== confirmPassword) {
        return json({ error: 'Passwords do not match. Re-enter the same password in both fields.' }, 400);
      }
      const { data: target, error: targetError } = await admin.from('profiles').select('id,role').eq('id', id).maybeSingle();
      if (targetError || !target) return json({ error: 'Account not found.' }, 404);
      if (target.role === 'ADMIN') return json({ error: 'Administrator passwords cannot be reset here.' }, 409);
      try {
        await recordAction('ADMIN_PASSWORD_RESET_STARTED', 'user', id, reason, { role: target.role });
      } catch {
        return json({ error: 'Password was not changed because its audit entry could not be recorded.' }, 503);
      }
      const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password });
      if (passwordError) {
        return json({ error: 'Password could not be changed. Choose a different 10+ character password and try again.' }, 400);
      }
      const { error: revokeError } = await admin.rpc('revoke_user_sessions', { p_user_id: id });
      try {
        await recordAction('ADMIN_PASSWORD_RESET_COMPLETED', 'user', id, reason, { role: target.role, sessionsRevoked: !revokeError });
        if (revokeError) return json({ success: true, warning: 'Password changed, but active sessions could not be revoked. Sign the user out from the security dashboard and retry.' });
        return json({ success: true });
      } catch {
        return json({ success: true, warning: 'Password changed, but the completion audit entry failed. The reset attempt is still recorded.' });
      }
    }
    if (action === 'delete-user') {
      if (body.confirmation !== 'DELETE USER') return json({ error: 'Type DELETE USER to confirm permanent account deletion.' }, 400);
      if (id === profile.id) return json({ error: 'You cannot delete your own administrator account.' }, 409);
      const { data: target, error: targetError } = await admin.from('profiles').select('id,role').eq('id', id).maybeSingle();
      if (targetError || !target) return json({ error: 'Account not found.' }, 404);
      const { data: media, error: mediaError } = await admin.from('media').select('storage_path').eq('owner_user_id', id);
      if (mediaError) return json({ error: 'Could not prepare the account for deletion.' }, 503);
      const paths = (media ?? []).map((row) => row.storage_path).filter((path): path is string => typeof path === 'string');
      if (paths.length) {
        const { error } = await admin.storage.from('unseen-media').remove(paths);
        if (error) return json({ error: 'The account remains intact, but its images could not be deleted.' }, 503);
      }
      const { error } = await admin.rpc('admin_manage_user', {
        p_admin_user_id: profile.id, p_target_user_id: id, p_action: action,
        p_role: null, p_status: null, p_reason: reason,
      });
      if (error) { const mapped = manageUserError(error); return json({ error: mapped.message }, mapped.status); }
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
      const { data, error } = await admin.from('reports').update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString(), moderation_action: String(status) }).eq('id', id).eq('status', 'open').select('id').maybeSingle();
      if (error) return json({ error: 'Could not update this report.' }, 503);
      if (!data) return json({ error: 'This report is no longer open.' }, 409);
      await recordAction(`ADMIN_${String(status).toUpperCase()}_REPORT`, 'report', id, reason, {});
      return json({ success: true });
    }
    if (action === 'moderate-poll') {
      const pollAction = String(body.pollAction ?? '');
      const status = pollAction === 'hide' ? 'hidden' : pollAction === 'delete' ? 'deleted' : pollAction === 'restore' ? 'published' : null;
      if (!status) return json({ error: 'Invalid poll action.' }, 400);
      const now = new Date().toISOString();
      const { data, error } = await admin.from('polls').update({ status }).eq('public_id', id).select('public_id').maybeSingle();
      if (error || !data) return json({ error: 'Could not update this poll.' }, error ? 503 : 404);
      await recordAction(`ADMIN_${pollAction.toUpperCase()}_POLL`, 'poll', id, reason, { status });
      const { error: reportError } = status !== 'published'
        ? await admin.from('reports').update({ status: 'resolved', reviewed_by: profile.id, reviewed_at: now, moderation_action: pollAction }).eq('poll_public_id', id).eq('status', 'open')
        : { error: null };
      return json({ success: true, ...(reportError ? { warning: 'The poll changed and was audited, but its open reports could not be resolved automatically.' } : {}) });
    }
    if (action === 'moderate-crush') {
      const crushAction = String(body.crushAction ?? '');
      const status = crushAction === 'hide' ? 'hidden' : crushAction === 'delete' ? 'deleted' : crushAction === 'restore' ? 'published' : null;
      if (!status) return json({ error: 'Invalid spotted post action.' }, 400);
      const now = new Date().toISOString();
      const { data, error } = await admin.from('crushes').update({ status }).eq('public_id', id).select('public_id').maybeSingle();
      if (error || !data) return json({ error: 'Could not update this spotted post.' }, error ? 503 : 404);
      await recordAction(`ADMIN_${crushAction.toUpperCase()}_SPOTTED`, 'crush', id, reason, { status });
      const { error: reportError } = status !== 'published'
        ? await admin.from('reports').update({ status: 'resolved', reviewed_by: profile.id, reviewed_at: now, moderation_action: crushAction }).eq('crush_public_id', id).eq('status', 'open')
        : { error: null };
      return json({ success: true, ...(reportError ? { warning: 'The spotted post changed and was audited, but its open reports could not be resolved automatically.' } : {}) });
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
