import type { Database as SupabaseDatabase, Json as SupabaseJson } from './database.generated';

export type Json = SupabaseJson;
export type PostCategory = SupabaseDatabase['public']['Enums']['post_category'];
export type AccountRole = SupabaseDatabase['public']['Enums']['account_role'];
export type ModerationStatus = SupabaseDatabase['public']['Enums']['account_moderation_status'];

type GeneratedFunctions = SupabaseDatabase['public']['Functions'];
type ReportRpc = Omit<GeneratedFunctions['submit_report'], 'Args'> & {
  Args: Omit<GeneratedFunctions['submit_report']['Args'], 'p_comment_public_id'> & {
    p_comment_public_id: string | null;
  };
};
export type Database = Omit<SupabaseDatabase, 'public'> & {
  public: Omit<SupabaseDatabase['public'], 'Functions'> & {
    Functions: Omit<GeneratedFunctions, 'submit_report'> & { submit_report: ReportRpc };
  };
};

export type FeedPostRow = SupabaseDatabase['public']['Functions']['feed_posts_page']['Returns'][number];
export type FeedCommentRow = SupabaseDatabase['public']['Functions']['feed_comments_page']['Returns'][number];
export type FeedPollRow = SupabaseDatabase['public']['Functions']['feed_polls_page']['Returns'][number];
export type ProfileRow = SupabaseDatabase['public']['Functions']['get_my_profile']['Returns'][number];
export type AnonymousIdentityRow = SupabaseDatabase['public']['Functions']['ensure_anonymous_identity']['Returns'][number];
export type UsageRow = SupabaseDatabase['public']['Functions']['get_post_usage']['Returns'][number];
