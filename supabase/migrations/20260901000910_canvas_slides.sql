-- 0910: designed slides (docs/LIVE_ENGINE.md, deck builder).
--
-- * A new slide kind, 'canvas': a 16:9 slide laid out freely with text boxes,
--   pictures and shapes, like a PowerPoint slide. Its content is
--   { background: {color, media_path}, elements: [...] } in a 1600 x 900 grid.
-- * Slide content is capped at 256 KB so one slide can't bloat a lesson
--   (existing slides are not checked).
-- * Guests in a live lesson can see the pictures on its designed slides.

alter table public.lesson_slides drop constraint if exists lesson_slides_kind_check;
alter table public.lesson_slides add constraint lesson_slides_kind_check check (kind in (
  'title','text','image','video','audio','embed','link','attachment',
  'shapes','whiteboard','activity','canvas'));

alter table public.lesson_slides drop constraint if exists lesson_slides_content_size;
alter table public.lesson_slides add constraint lesson_slides_content_size
  check (octet_length(content::text) <= 262144) not valid;

-- Guests may read the pictures placed on designed slides (and their background) in their live lesson.
create or replace function app.guest_can_read_media(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_guests g
      join public.class_sessions s on s.id = g.session_id and s.status = 'live'
     where g.user_id = auth.uid() and g.removed_at is null and s.lesson_id is not null
       and (exists (select 1 from public.lesson_slides sl where sl.lesson_id = s.lesson_id
                    and (p_name in (sl.content ->> 'media_path', sl.content ->> 'captions_path', sl.content -> 'background' ->> 'media_path')
                         or sl.content @> jsonb_build_object('elements', jsonb_build_array(jsonb_build_object('media_path', p_name)))))
            or exists (select 1 from public.lesson_media lm where lm.lesson_id = s.lesson_id and lm.storage_path = p_name)))
$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0910')
$$;
