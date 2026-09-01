-- =====================================================================
-- Deevi :: 007 :: Supabase Storage buckets
-- Verification documents and message attachments are PRIVATE. They are
-- only ever reachable through short-lived signed URLs minted by the API
-- after an ownership/permission check.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('portfolio', 'portfolio', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('job-media', 'job-media', true, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('message-attachments', 'message-attachments', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('verification-documents', 'verification-documents', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage RLS policies are created on purpose: every read/write goes
-- through the API using the service role, which enforces Deevi's own
-- ownership rules. Anonymous clients cannot touch private buckets at all.
