-- =============================================================================
-- SwiftCipher — 0700 realtime channels + storage buckets
-- Realtime postgres_changes respects RLS, so subscribers only receive rows
-- they are allowed to select.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'class_sessions','session_participants','announcements','chat_messages','raise_hands',
    'environment_events','spotlights','browser_sessions','teacher_commands','notifications',
    'game_sessions','game_players','collab_posts','quiz_answers','rtc_signals']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;

-- ---------- Buckets ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('lesson-media', 'lesson-media', false, 524288000,
    array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml','video/mp4','video/webm',
          'audio/mpeg','audio/ogg','audio/wav','audio/webm','application/pdf','text/vtt',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('submissions', 'submissions', false, 52428800, null)
on conflict (id) do nothing;

-- lesson-media/<tenant_id>/<owner_id>/<file>: tenant members read, staff write their own folder.
create policy "lesson media read" on storage.objects for select to authenticated
  using (bucket_id = 'lesson-media' and (storage.foldername(name))[1] = (select app.tenant_id())::text);
create policy "lesson media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-media' and (select app.is_teacher())
              and (storage.foldername(name))[1] = (select app.tenant_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text);
create policy "lesson media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lesson-media' and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and ((storage.foldername(name))[2] = (select auth.uid())::text or (select app.is_admin())));

-- submissions/<tenant_id>/<student_id>/<assignment_id>/<file>
create policy "submission read" on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select app.tenant_id())::text
         and ((storage.foldername(name))[2] = (select auth.uid())::text
              or app.teaches_student(((storage.foldername(name))[2])::uuid)
              or (select app.is_admin())));
create policy "submission write" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select app.tenant_id())::text
              and (storage.foldername(name))[2] = (select auth.uid())::text
              and exists (select 1 from public.assignments a where a.id::text = (storage.foldername(name))[3]
                          and app.in_class(a.class_id)));
