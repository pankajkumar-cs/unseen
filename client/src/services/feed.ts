import type { Session } from '@supabase/supabase-js';
import { requireSupabase } from '../lib/supabase';
import type { FeedCommentRow, FeedPostRow, PostCategory } from '../types/database';

export interface PostView {
  id: string;
  category: PostCategory;
  body: string;
  authorName: string;
  authorEmoji: string;
  authorColor: string;
  location: string | null;
  branch: string | null;
  createdAt: string;
  likes: number;
  commentsCount: number;
  liked: boolean;
  owned: boolean;
  bookmarked: boolean;
  imagePath: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface CommentView {
  id: string;
  authorName: string;
  authorEmoji: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface FeedCursor { createdAt: string; publicId: string }
export interface PostPage { posts: PostView[]; cursor: FeedCursor | null }

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function signedMedia(paths: Array<string | null>) {
  const client = requireSupabase();
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (!uniquePaths.length) return new Map<string, string>();
  const { data, error } = await client.storage.from('unseen-media').createSignedUrls(uniquePaths, 3600);
  if (error || !data) return new Map<string, string>();
  return new Map(data.flatMap((entry) => entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : []));
}

function toPostView(row: FeedPostRow, urls: Map<string, string>): PostView {
  return {
    id: row.public_id,
    category: row.category,
    body: row.body,
    authorName: row.author_name,
    authorEmoji: row.author_emoji,
    authorColor: row.author_color,
    location: row.location,
    branch: row.branch,
    createdAt: row.created_at,
    likes: row.likes_count,
    commentsCount: row.comments_count,
    liked: row.viewer_liked,
    owned: row.viewer_owned,
    bookmarked: row.viewer_bookmarked,
    imagePath: row.storage_path,
    imageUrl: row.storage_path ? urls.get(row.storage_path) ?? null : null,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
  };
}

export async function loadPostPage(category: PostCategory | null, cursor: FeedCursor | null, limit = 20): Promise<PostPage> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('feed_posts_page', {
    ...(cursor ? { p_before_created_at: cursor.createdAt, p_before_public_id: cursor.publicId } : {}),
    ...(category ? { p_category: category } : {}),
    p_limit: limit,
  });
  throwIfError(error);
  const rows = data ?? [];
  const urls = await signedMedia(rows.map((row) => row.storage_path));
  const posts = rows.map((row) => toPostView(row, urls));
  const last = rows.at(-1);
  return {
    posts,
    cursor: last ? { createdAt: last.created_at, publicId: last.public_id } : null,
  };
}

export async function getPostUsage() {
  const { data, error } = await requireSupabase().rpc('get_post_usage');
  throwIfError(error);
  return data?.[0] ?? null;
}

export async function createPost(category: PostCategory, body: string, mediaPublicId: string | null) {
  const { data, error } = await requireSupabase().rpc('create_post', {
    p_category: category,
    p_body: body,
    p_location: 'Campus',
    ...(mediaPublicId ? { p_media_public_id: mediaPublicId } : {}),
  });
  throwIfError(error);
  if (!data?.[0]) throw new Error('Your post could not be published.');
  return data[0];
}

export async function loadComments(postId: string, limit = 50): Promise<CommentView[]> {
  const { data, error } = await requireSupabase().rpc('feed_comments_page', {
    p_post_public_id: postId,
    p_limit: limit,
  });
  throwIfError(error);
  return (data ?? []).map((row: FeedCommentRow) => ({
    id: row.public_id,
    authorName: row.author_name,
    authorEmoji: row.author_emoji,
    body: row.body,
    createdAt: row.created_at,
    mine: row.mine,
  }));
}

export async function toggleLike(postId: string, liked: boolean) {
  const { data, error } = await requireSupabase().rpc('set_post_like', {
    p_post_public_id: postId,
    p_liked: liked,
  });
  throwIfError(error);
  const result = data?.[0];
  if (!result) throw new Error('Like update could not be confirmed.');
  return result;
}

export async function createComment(postId: string, body: string): Promise<CommentView> {
  const { data, error } = await requireSupabase().rpc('create_comment', {
    p_post_public_id: postId,
    p_body: body,
  });
  throwIfError(error);
  const row = data?.[0];
  if (!row) throw new Error('Comment could not be saved.');
  return { id: row.public_id, authorName: row.author_name, authorEmoji: row.author_emoji, body: row.body, createdAt: row.created_at, mine: true };
}

export async function removeComment(commentId: string) {
  const { error } = await requireSupabase().rpc('delete_comment', { p_comment_public_id: commentId });
  throwIfError(error);
}

export async function deleteOwnPost(postId: string) {
  const { error } = await requireSupabase().rpc('delete_own_post', { p_post_public_id: postId });
  throwIfError(error);
}

export async function toggleBookmark(userId: string, postId: string) {
  const client = requireSupabase();
  const { data: existing, error: readError } = await client.from('bookmarks')
    .select('post_public_id')
    .eq('user_id', userId)
    .eq('post_public_id', postId)
    .maybeSingle();
  throwIfError(readError);
  if (existing) {
    const { error } = await client.from('bookmarks').delete().eq('user_id', userId).eq('post_public_id', postId);
    throwIfError(error);
    return false;
  }
  const { error } = await client.from('bookmarks').insert({ user_id: userId, post_public_id: postId });
  throwIfError(error);
  return true;
}

export async function submitReport(postId: string, targetType: 'post' | 'comment' | 'account', commentId: string | null, reason: string, detail: string) {
  const { error } = await requireSupabase().rpc('submit_report', {
    p_post_public_id: postId,
    p_target_type: targetType,
    p_comment_public_id: commentId,
    p_reason: reason,
    p_detail: detail,
  });
  throwIfError(error);
}

export interface UploadedMedia {
  publicId: string;
  storagePath: string;
  signedUrl: string;
  width: number;
  height: number;
  file: File;
}

export async function compressImage(file: File): Promise<{ file: File; width: number; height: number }> {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the selected image.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image preparation failed.')), 'image/webp', 0.82);
  });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image preparation failed.')), file.type, 0.82);
    });
  }
  const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) ? blob.type : file.type;
  const extension = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/png' ? 'png' : 'jpg';
  const compressed = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: mimeType, lastModified: Date.now() });
  if (compressed.size > 5 * 1024 * 1024) throw new Error('The prepared image is still too large. Choose a smaller image.');
  return { file: compressed, width, height };
}

function uploadWithProgress(path: string, file: File, session: Session, onProgress: (percent: number) => void) {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${url}/storage/v1/object/unseen-media/${path.split('/').map(encodeURIComponent).join('/')}`);
    request.setRequestHeader('apikey', key);
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('x-upsert', 'false');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error('Image upload failed. Check your connection and try again.'));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = 'Image upload failed. Please try again.';
      try {
        const response = JSON.parse(request.responseText) as { message?: string; error?: string };
        message = response.message ?? response.error ?? message;
      } catch { /* Keep the safe fallback for non-JSON storage errors. */ }
      reject(new Error(message));
    };
    request.send(file);
  });
}

export async function uploadPostImage(file: File, session: Session, onProgress: (percent: number) => void, onPreparing?: () => void): Promise<UploadedMedia> {
  const client = requireSupabase();
  const prepared = await compressImage(file);
  onPreparing?.();
  const ext = prepared.file.type === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
  await uploadWithProgress(storagePath, prepared.file, session, onProgress);

  const publicId = crypto.randomUUID();
  const { error: metadataError } = await client.from('media').insert({
    public_id: publicId,
    owner_user_id: session.user.id,
    storage_path: storagePath,
    mime_type: prepared.file.type,
    file_size_bytes: prepared.file.size,
    width: prepared.width,
    height: prepared.height,
  });
  if (metadataError) {
    await client.storage.from('unseen-media').remove([storagePath]);
    throw new Error(metadataError.message);
  }
  const { data: signed, error: signedError } = await client.storage.from('unseen-media').createSignedUrl(storagePath, 3600);
  if (signedError || !signed?.signedUrl) {
    await client.from('media').delete().eq('public_id', publicId);
    await client.storage.from('unseen-media').remove([storagePath]);
    throw new Error('The image was uploaded but could not be previewed. Please try again.');
  }
  return { publicId, storagePath, signedUrl: signed.signedUrl, width: prepared.width, height: prepared.height, file: prepared.file };
}

export async function discardPostImage(media: UploadedMedia) {
  const client = requireSupabase();
  await client.from('media').delete().eq('public_id', media.publicId);
  await client.storage.from('unseen-media').remove([media.storagePath]);
}
