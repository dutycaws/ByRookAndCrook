-- Private lossless masters and public, immutable reviewer evidence must never share a bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('source-masters', 'source-masters', false, 52428800, array['image/png']),
  ('review-evidence', 'review-evidence', true, 26214400, array['video/webm', 'image/webp', 'image/jpeg', 'image/png', 'application/json'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A restrictive policy is deliberately used rather than relying on the absence of a
-- policy: restrictive policies are ANDed with any older broad Storage policy, so a
-- legacy `bucket_id is not null` policy cannot reopen either media bucket to clients.
-- Public evidence remains readable through Supabase Storage's public-object endpoint;
-- direct anon/authenticated `storage.objects` reads remain blocked. Service/secret keys
-- bypass RLS and remain limited to the trusted local operator tooling.
drop policy if exists "media_bucket_client_deny_anon" on storage.objects;
drop policy if exists "media_bucket_client_deny_authenticated" on storage.objects;

create policy "media_bucket_client_deny_anon"
on storage.objects as restrictive
for all to anon
using (bucket_id not in ('source-masters', 'review-evidence'))
with check (bucket_id not in ('source-masters', 'review-evidence'));

create policy "media_bucket_client_deny_authenticated"
on storage.objects as restrictive
for all to authenticated
using (bucket_id not in ('source-masters', 'review-evidence'))
with check (bucket_id not in ('source-masters', 'review-evidence'));
