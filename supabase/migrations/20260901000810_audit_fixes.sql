-- =============================================================================
-- SwiftCipher — 0810 fixes from the full-project audit
--
-- Slide order is written in one atomic statement. The editor used to renumber
-- slides with one UPDATE per slide from the browser; a dropped connection part
-- way through left duplicate or missing positions (slides shown out of order).
-- =============================================================================

-- p_order: every slide id of the lesson, in the new order. Positions become 0..n-1.
create or replace function public.reorder_slides(p_lesson uuid, p_order uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_count int;
begin
  if not app.can_edit_lesson(p_lesson) then raise exception 'You can''t edit this lesson.' using errcode = '42501'; end if;
  select count(*) into v_count from public.lesson_slides where lesson_id = p_lesson;
  if coalesce(array_length(p_order, 1), 0) <> v_count
     or (select count(distinct x) from unnest(p_order) x) <> v_count
     or exists (select 1 from unnest(p_order) x where not exists (
          select 1 from public.lesson_slides s where s.id = x and s.lesson_id = p_lesson)) then
    raise exception 'The slide list changed. Reload the lesson and try again.' using errcode = 'P0001';
  end if;
  update public.lesson_slides s set position = o.ord - 1
    from unnest(p_order) with ordinality o(id, ord)
   where s.id = o.id and s.lesson_id = p_lesson and s.position is distinct from o.ord - 1;
end$$;

revoke execute on function public.reorder_slides(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_slides(uuid, uuid[]) to authenticated, service_role;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0810')
$$;
