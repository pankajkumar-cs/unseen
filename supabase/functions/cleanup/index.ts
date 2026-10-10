import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

function matchesSecret(provided: string | null, expected: string) {
  if (!provided) return false;
  const left = new TextEncoder().encode(provided);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function isMissingObject(error: { message?: string; statusCode?: string | number }) {
  const message = `${error.statusCode ?? ''} ${error.message ?? ''}`.toLowerCase();
  return message.includes('404') || message.includes('not found') || message.includes('nosuchkey');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const expectedSecret = Deno.env.get('CRON_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!expectedSecret || !supabaseUrl || !serviceKey) {
    return json({ error: 'Cleanup service is not configured.' }, 503);
  }
  if (!matchesSecret(request.headers.get('x-cron-secret'), expectedSecret)) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimedRows, error: claimError } = await admin.rpc('claim_expired_media_cleanup', { p_limit: 100 });
  if (claimError) return json({ error: 'Could not prepare expired media cleanup.' }, 503);

  const paths = [...new Set((claimedRows ?? [])
    .map((row: { storage_path?: unknown }) => row.storage_path)
    .filter((path: unknown): path is string => typeof path === 'string' && path.length > 0))];
  const removedPaths: string[] = [];
  const failedPaths: string[] = [];

  if (paths.length) {
    const { error: bulkError } = await admin.storage.from('unseen-media').remove(paths);
    if (!bulkError) {
      removedPaths.push(...paths);
    } else {
      // A bulk failure may include one already-missing object. Retry paths
      // separately so one bad file cannot block other expired content.
      for (let offset = 0; offset < paths.length; offset += 10) {
        const batch = paths.slice(offset, offset + 10);
        const results = await Promise.all(batch.map(async (path) => {
          const { error } = await admin.storage.from('unseen-media').remove([path]);
          return { path, error };
        }));
        for (const result of results) {
          if (!result.error || isMissingObject(result.error)) removedPaths.push(result.path);
          else failedPaths.push(result.path);
        }
      }
    }

    if (removedPaths.length) {
      const { error: completeError } = await admin.rpc('complete_expired_media_cleanup', {
        p_storage_paths: removedPaths,
      });
      if (completeError) {
        return json({ error: 'Storage was cleaned, but media metadata could not be finalized. It will retry.' }, 503);
      }
    }
    if (failedPaths.length) {
      await admin.rpc('release_expired_media_cleanup', { p_storage_paths: failedPaths });
    }
  }

  // This runs after storage cleanup. The SQL function only removes posts after
  // their media metadata is gone, so a failed storage deletion preserves the row.
  const { data: deletedContent, error: contentError } = await admin.rpc('delete_expired_content');
  if (contentError) return json({ error: 'Expired content cleanup could not be completed.' }, 503);
  return json({ removedFiles: removedPaths.length, retryingFiles: failedPaths.length, deletedContent });
});
