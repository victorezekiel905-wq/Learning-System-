-- =============================================================================
-- SwiftCipher — 0670 private Realtime broadcast channels
-- Topic "annot:<session_id>": the session's teacher may send; anyone in the
-- class may listen. Skipped where the realtime schema is absent (tests).
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute $p$
      create policy "session annotations: class can listen" on realtime.messages for select to authenticated
      using (
        realtime.topic() like 'annot:%'
        and (app.in_session(nullif(split_part(realtime.topic(), ':', 2), '')::uuid)
             or app.can_manage_session(nullif(split_part(realtime.topic(), ':', 2), '')::uuid))
      )$p$;
    execute $p$
      create policy "session annotations: teacher can send" on realtime.messages for insert to authenticated
      with check (
        realtime.topic() like 'annot:%'
        and app.can_manage_session(nullif(split_part(realtime.topic(), ':', 2), '')::uuid)
      )$p$;
  end if;
end$$;
