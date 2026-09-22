-- =============================================================================
-- SwiftCipher — 0680 audit triggers for tables edited directly under RLS
-- (§20: audit logs for policy changes; §19 feature flags; roster changes).
-- =============================================================================

create or replace function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_meta jsonb;
begin
  v_meta := jsonb_build_object('op', lower(tg_op));
  if tg_op = 'UPDATE' then
    v_meta := v_meta || jsonb_build_object('changed',
      (select coalesce(jsonb_object_agg(k, to_jsonb(new) -> k), '{}'::jsonb)
       from jsonb_object_keys(to_jsonb(new)) k
       where k not in ('updated_at') and to_jsonb(old) -> k is distinct from to_jsonb(new) -> k));
  elsif tg_op = 'INSERT' then
    v_meta := v_meta || jsonb_build_object('row', v_row - 'secret_hash');
  end if;
  perform app.audit(tg_table_name || '.' || lower(tg_op), tg_table_name,
                    coalesce(v_row ->> 'id', v_row ->> 'user_id'), v_meta,
                    (v_row ->> 'tenant_id')::uuid, auth.uid());
  return null;
end$$;

create trigger environment_policies_audit after insert or update or delete on public.environment_policies
  for each row execute function app.audit_row_change();
create trigger scenes_audit after insert or update or delete on public.scenes
  for each row execute function app.audit_row_change();
create trigger feature_flags_audit after insert or update or delete on public.feature_flags
  for each row execute function app.audit_row_change();
create trigger class_members_audit after insert or delete on public.class_members
  for each row execute function app.audit_row_change();
create trigger parent_links_audit after insert or update on public.parent_links
  for each row execute function app.audit_row_change();
