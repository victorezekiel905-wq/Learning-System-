-- 1010: moving to another slide moves the class on.
--
-- A launched activity (and "Share results", which Reveal turns on) used to stay
-- on after the teacher moved to another slide, so the projector and students'
-- screens kept showing that question or its results: the slides seemed stuck.
-- Now changing slide closes the launched activity and hides results, unless the
-- same change launches one or shares results itself. The new slide's own
-- activity, if it has one, shows as usual.

create or replace function app.session_timing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.current_slide is distinct from old.current_slide or (new.phase = 'active' and old.phase = 'lobby') then
    new.slide_changed_at := now();
  end if;
  if new.current_slide is distinct from old.current_slide then
    if new.active_activity_id is not distinct from old.active_activity_id then new.active_activity_id := null; end if;
    if new.responses_visible is not distinct from old.responses_visible then new.responses_visible := false; end if;
  end if;
  if new.active_activity_id is not null and new.active_activity_id is distinct from old.active_activity_id then
    new.activity_opened_at := now();
  end if;
  return new;
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1010')
$$;
