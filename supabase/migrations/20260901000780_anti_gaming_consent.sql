-- =============================================================================
-- SwiftCipher — 0780 anti-gaming + parental monitoring consent
--
-- 1. Games: a much larger list of game sites, a pattern check for game-site
--    copies ("unblocked games", "...games.io", game pages on free hosting such as
--    sites.google.com / github.io), used by the policy engine for managed browsers.
-- 2. Every school gets a ready-made environment "Lesson focus: no games or
--    social media" (games, social, chat, streaming, gambling, adult blocked).
-- 3. Parental monitoring consent: schools record the signed undertakings parents
--    gave (bulk, with a reference), parents can confirm or withdraw in the parent
--    portal, and a school may require consent before a student's screen is shown.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Game sites
-- ---------------------------------------------------------------------------
insert into public.domain_categories (domain, category) values
  ('roblox.com','games'),('rbxcdn.com','games'),('minecraft.net','games'),('fortnite.com','games'),('epicgames.com','games'),
  ('ea.com','games'),('origin.com','games'),('ubisoft.com','games'),('blizzard.com','games'),('battle.net','games'),
  ('riotgames.com','games'),('leagueoflegends.com','games'),('playvalorant.com','games'),('steampowered.com','games'),
  ('steamcommunity.com','games'),('xbox.com','games'),('playstation.com','games'),('nintendo.com','games'),
  ('coolmathgames.com','games'),('coolmath-games.com','games'),('poki.com','games'),('poki.io','games'),('crazygames.com','games'),
  ('miniclip.com','games'),('friv.com','games'),('friv.io','games'),('y8.com','games'),('kizi.com','games'),('agame.com','games'),
  ('armorgames.com','games'),('kongregate.com','games'),('newgrounds.com','games'),('addictinggames.com','games'),
  ('gamepix.com','games'),('gamedistribution.com','games'),('silvergames.com','games'),('mathplayground.com','games'),
  ('hoodamath.com','games'),('abcya.com','games'),('pbskids.org','games'),('nitrotype.com','games'),('typeracer.com','games'),
  ('itch.io','games'),('gamejolt.com','games'),('kbhgames.com','games'),('twoplayergames.org','games'),('1001games.com','games'),
  ('mousebreaker.com','games'),('bigfishgames.com','games'),('pogo.com','games'),('arkadium.com','games'),('msn-games.com','games'),
  ('games.co.uk','games'),('gameflare.com','games'),('lagged.com','games'),('snokido.com','games'),('gogy.com','games'),
  ('bgames.com','games'),('funnygames.org','games'),('gamesgames.com','games'),('spelletjes.nl','games'),('jeux.fr','games'),
  ('slither.io','games'),('agar.io','games'),('diep.io','games'),('krunker.io','games'),('shellshock.io','games'),
  ('zombsroyale.io','games'),('surviv.io','games'),('moomoo.io','games'),('paper-io.com','games'),('paper.io','games'),
  ('hole-io.com','games'),('skribbl.io','games'),('gartic.io','games'),('gartic.com','games'),('smashkarts.io','games'),
  ('bloxd.io','games'),('ev.io','games'),('venge.io','games'),('narrow.one','games'),('1v1.lol','games'),('justbuild.lol','games'),
  ('taming.io','games'),('starve.io','games'),('mope.io','games'),('wings.io','games'),('yohoho.io','games'),('iogames.space','games'),
  ('io-games.io','games'),('slope-game.com','games'),('slopegame.io','games'),('run3.io','games'),('retrobowl.me','games'),
  ('retro-bowl.com','games'),('geometrydash.io','games'),('geometry-dash.io','games'),('subway-surfers.org','games'),
  ('subwaysurfers.com','games'),('templerun.io','games'),('cookieclicker.eu','games'),('orteil.dashnet.org','games'),
  ('chess.com','games'),('lichess.org','games'),('chess24.com','games'),('solitaired.com','games'),('solitr.com','games'),
  ('freecell.net','games'),('2048game.com','games'),('play2048.co','games'),('tetris.com','games'),('jstris.jezevec10.com','games'),
  ('tetr.io','games'),('pacman.live','games'),('snake.io','games'),('googlesnakemods.com','games'),('neal.fun','games'),
  ('powerlinegames.com','games'),('scratch.mit.edu','education'),('code.org','education'),
  ('unblocked-games.s3.amazonaws.com','games'),('unblockedgames66.com','games'),('unblockedgames76.com','games'),
  ('unblockedgames77.com','games'),('unblockedgames911.com','games'),('tyrone-games.com','games'),('classroom6x.com','games'),
  ('now.gg','games'),('now.us','games'),('xbox.gg','games'),('geforcenow.com','games'),('play.geforcenow.com','games'),
  ('boosteroid.com','games'),('shadow.tech','games'),('luna.amazon.com','games'),('stadia.google.com','games'),
  ('bet9ja.com','gambling'),('sportybet.com','gambling'),('betking.com','gambling'),('1xbet.com','gambling'),
  ('betway.com','gambling'),('bet365.com','gambling'),('nairabet.com','gambling'),('merrybet.com','gambling'),
  ('stake.com','gambling'),('pokerstars.com','gambling')
on conflict (domain) do update set category = excluded.category;

-- Free-hosting sites where game copies live: judge them by the page address.
create or replace function app.url_category(p_url text) returns text
language sql stable set search_path = '' as $$
  with h as (select app.url_host(p_url) as host, lower(coalesce(p_url, '')) as url)
  select coalesce(
    app.domain_category(h.host),
    case
      -- the host name itself says "games"/"unblocked"/"arcade" (e.g. unblocked-games-66.github.io, slope-games.io)
      when h.host ~ '(^|[.-])(unblocked|games?|gaming|arcade|minigames?|freegames|playgames|poki|friv|y8|kizi)([0-9]*)([.-]|$)' then 'games'
      when h.host ~ '(^|\.)[a-z0-9-]*(games?|arcade)[a-z0-9-]*\.(io|lol|gg|fun|online|xyz|site|space|club|app|me)$' then 'games'
      -- game pages on free hosting (Google Sites, GitHub Pages, Glitch, Netlify, Vercel, Weebly, Wix, Replit)
      when h.host ~ '(^|\.)(sites\.google\.com|github\.io|gitlab\.io|glitch\.me|netlify\.app|vercel\.app|pages\.dev|weebly\.com|wixsite\.com|replit\.app|repl\.co|firebaseapp\.com|web\.app)$'
           and h.url ~ '(unblocked|[^a-z](games?|gaming|arcade)([^a-z]|$)|slope|retro-?bowl|1v1|minecraft|roblox|fortnite|subway|geometry-?dash|cookie-?clicker|drift|moto-?x3m|basketball-?stars|run-?3|smash-?karts)'
        then 'games'
    end)
  from h
$$;

-- The policy engine now uses url_category (domain list + patterns).

create or replace function app.evaluate_url(
  p_policy public.environment_policies, p_url text, p_tab_count int, p_app_host text
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_host text := app.url_host(p_url);
  v_cat  text;
  v_hit  text;
begin
  if v_host is null then
    return jsonb_build_object('verdict', 'neutral', 'rule', 'Browser page', 'domain', null);
  end if;
  v_cat := app.url_category(p_url);
  if p_app_host is not null and app.domain_matches(v_host, p_app_host) then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'SwiftCipher', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.id is null then
    return jsonb_build_object('verdict', 'allowed', 'rule', 'No environment active', 'domain', v_host, 'category', v_cat);
  end if;

  v_hit := app.domain_in(v_host, p_policy.blocked_domains);
  if v_hit is not null then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'critical',
                              'rule', 'Blocked domain: ' || app.normalize_domain(v_hit), 'domain', v_host, 'category', v_cat);
  end if;
  if v_cat is not null and v_cat = any (p_policy.blocked_categories) then
    return jsonb_build_object('verdict', 'violation', 'kind', 'domain_blocked', 'severity', 'warning',
                              'rule', 'Blocked category: ' || v_cat, 'domain', v_host, 'category', v_cat);
  end if;

  if app.domain_in(v_host, p_policy.allowed_domains) is not null
     or app.domain_in(v_host, p_policy.required_urls) is not null
     or (p_policy.lesson_url is not null and app.domain_matches(v_host, p_policy.lesson_url)) then
    if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
      return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                                'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
    end if;
    return jsonb_build_object('verdict', 'allowed', 'rule', 'Allowed domain', 'domain', v_host, 'category', v_cat);
  end if;

  if p_policy.focus_mode or p_policy.lock_screen then
    return jsonb_build_object('verdict', 'violation', 'kind', 'environment_left', 'severity', 'warning',
                              'rule', 'Outside the class environment', 'domain', v_host, 'category', v_cat);
  end if;

  if v_cat in ('games','social','video','streaming','shopping','chat','gambling','adult') then
    return jsonb_build_object('verdict', 'off_task', 'kind', 'off_task', 'severity', 'info',
                              'rule', 'Looks unrelated to ' || coalesce(nullif(p_policy.subject, ''), 'the lesson') || ' (' || v_cat || ')',
                              'domain', v_host, 'category', v_cat);
  end if;

  if coalesce(array_length(p_policy.allowed_domains, 1), 0) + coalesce(array_length(p_policy.required_urls, 1), 0) > 0 then
    return jsonb_build_object('verdict', 'warning', 'kind', 'environment_left', 'severity', 'info',
                              'rule', 'Not on the class resource list', 'domain', v_host, 'category', v_cat);
  end if;
  if p_policy.tab_limit is not null and coalesce(p_tab_count, 0) > p_policy.tab_limit then
    return jsonb_build_object('verdict', 'warning', 'kind', 'tab_limit', 'severity', 'info',
                              'rule', 'More than ' || p_policy.tab_limit || ' tabs open', 'domain', v_host, 'category', v_cat);
  end if;
  return jsonb_build_object('verdict', 'allowed', 'rule', 'No rule matched', 'domain', v_host, 'category', v_cat);
end$$;

-- ---------------------------------------------------------------------------
-- 2. Ready-made "Lesson focus" environment for every school
-- ---------------------------------------------------------------------------
create or replace function app.ensure_lesson_focus(p_tenant uuid, p_owner uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_owner is null or exists (select 1 from public.environment_policies
                                where tenant_id = p_tenant and name = 'Lesson focus: no games or social media') then
    return;
  end if;
  insert into public.environment_policies (tenant_id, owner_id, name, description, blocked_categories, grace_seconds, is_template, notify)
    values (p_tenant, p_owner, 'Lesson focus: no games or social media',
            'Blocks game, social media, chat, streaming, gambling and adult sites on school-managed browsers during the lesson. Students who open one are sent back and the teacher is alerted.',
            array['games','social','chat','streaming','gambling','adult'], 5, true,
            '{"banner":true,"sound":true,"browser":true,"email":false}'::jsonb);
end$$;

-- Existing schools: owned by their first administrator.
select app.ensure_lesson_focus(t.id, (select u.id from public.users u where u.tenant_id = t.id and u.role = 'school_admin'
                                        order by u.created_at limit 1))
from public.tenants t;

-- New schools: as soon as their first administrator exists.
create or replace function app.on_admin_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'school_admin' then perform app.ensure_lesson_focus(new.tenant_id, new.id); end if;
  return null;
end$$;
drop trigger if exists users_lesson_focus on public.users;
create trigger users_lesson_focus after insert or update of role on public.users
  for each row execute function app.on_admin_created();

-- ---------------------------------------------------------------------------
-- 3. Parental monitoring consent
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists require_monitoring_consent boolean not null default false;

create table if not exists public.monitoring_consents (
  student_id  uuid primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  method      text not null check (method in ('signed_undertaking','parent_portal')),
  reference   text check (length(reference) <= 200),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid,
  revoke_reason text check (length(revoke_reason) <= 500),
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index if not exists monitoring_consents_tenant_idx on public.monitoring_consents(tenant_id);
alter table public.monitoring_consents enable row level security;
revoke all on public.monitoring_consents from anon, authenticated;
grant select on public.monitoring_consents to authenticated;
drop policy if exists monitoring_consents_read on public.monitoring_consents;
create policy monitoring_consents_read on public.monitoring_consents for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and (student_id = (select auth.uid()) or (select app.is_admin()) or app.is_parent_of(student_id) or app.teaches_student(student_id)));

create or replace function app.has_monitoring_consent(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.monitoring_consents c where c.student_id = p_student and c.revoked_at is null)
$$;

-- Admin: record signed undertakings (all students, or a list), with a reference such as "Admissions pack 2026".
create or replace function public.record_monitoring_consent(p_reference text, p_students uuid[] default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reference), '') = '' then raise exception 'Give a reference for the signed undertakings (e.g. "Admissions pack 2026").' using errcode = '22023'; end if;
  insert into public.monitoring_consents (student_id, tenant_id, method, reference, recorded_by)
    select u.id, u.tenant_id, 'signed_undertaking', left(btrim(p_reference), 200), auth.uid()
    from public.users u
    where u.tenant_id = app.tenant_id() and u.role = 'student'
      and (p_students is null or u.id = any (p_students))
  on conflict (student_id) do update
    set method = 'signed_undertaking', reference = excluded.reference, recorded_by = excluded.recorded_by,
        recorded_at = now(), revoked_at = null, revoked_by = null, revoke_reason = null;
  get diagnostics v_n = row_count;
  perform app.audit('privacy.monitoring_consent_recorded', 'tenant', app.tenant_id()::text,
                    jsonb_build_object('students', v_n, 'reference', left(btrim(p_reference), 200)));
  return v_n;
end$$;

-- Parent (linked, portal enabled): confirm or withdraw consent for their child.
create or replace function public.parent_monitoring_consent(p_student uuid, p_consent boolean, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if not app.is_parent_of(p_student) then raise exception 'Not your child.' using errcode = '42501'; end if;
  select tenant_id into v_tenant from public.users where id = p_student;
  if p_consent then
    insert into public.monitoring_consents (student_id, tenant_id, method, reference, recorded_by)
      values (p_student, v_tenant, 'parent_portal', 'Confirmed in the parent portal', auth.uid())
      on conflict (student_id) do update set method = 'parent_portal', reference = excluded.reference,
        recorded_by = excluded.recorded_by, recorded_at = now(), revoked_at = null, revoked_by = null, revoke_reason = null;
  else
    update public.monitoring_consents set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(p_reason, 500)
     where student_id = p_student and revoked_at is null;
  end if;
  perform app.audit(case when p_consent then 'privacy.monitoring_consent_given' else 'privacy.monitoring_consent_withdrawn' end,
                    'user', p_student::text, '{}'::jsonb, v_tenant, auth.uid());
end$$;

-- Admin: withdraw (e.g. a parent asked in writing).
create or replace function public.revoke_monitoring_consent(p_student uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  update public.monitoring_consents set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(p_reason, 500)
   where student_id = p_student and tenant_id = app.tenant_id() and revoked_at is null;
  perform app.audit('privacy.monitoring_consent_withdrawn', 'user', p_student::text, jsonb_build_object('reason', left(p_reason, 500)));
end$$;

-- Admin overview: how many students have consent on file, and who doesn't (first 200).
create or replace function public.monitoring_consent_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'Administrators only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'required', (select require_monitoring_consent from public.tenant_settings where tenant_id = app.tenant_id()),
    'students', (select count(*) from public.users where tenant_id = app.tenant_id() and role = 'student'),
    'with_consent', (select count(*) from public.monitoring_consents c where c.tenant_id = app.tenant_id() and c.revoked_at is null),
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'email', u.email) order by u.full_name), '[]'::jsonb)
                from (select * from public.users u where u.tenant_id = app.tenant_id() and u.role = 'student'
                      and not app.has_monitoring_consent(u.id) order by u.full_name limit 200) u));
end$$;

revoke execute on function public.record_monitoring_consent(text, uuid[]), public.parent_monitoring_consent(uuid, boolean, text),
                           public.revoke_monitoring_consent(uuid, text), public.monitoring_consent_summary(),
                           app.has_monitoring_consent(uuid), app.url_category(text), app.ensure_lesson_focus(uuid, uuid)
  from public, anon;
grant execute on function public.record_monitoring_consent(text, uuid[]), public.parent_monitoring_consent(uuid, boolean, text),
                          public.revoke_monitoring_consent(uuid, text), public.monitoring_consent_summary()
  to authenticated, service_role;
grant execute on function app.has_monitoring_consent(uuid), app.url_category(text) to authenticated, service_role;

-- Screens are only requested from students whose consent is on file, when the school requires it.
create or replace function public.student_report(
  p_session uuid, p_visible boolean, p_fullscreen boolean, p_sharing boolean,
  p_surface text default null, p_unsupported boolean default false,
  p_slide int default null, p_idle boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s        public.class_sessions;
  v_p        public.session_participants;
  v_old      public.session_participants;
  v_set      public.tenant_settings;
  v_reason   text;
  v_setup    boolean := false;
  v_status   text := case when p_idle then 'idle' else 'online' end;
  v_slide    int;
  v_changed  boolean;
  v_returned int;
  v_capture  boolean;
begin
  select * into v_s from public.class_sessions where id = p_session;
  if v_s.id is null or not app.in_class(v_s.class_id) then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_s.status <> 'live' then return jsonb_build_object('status', v_s.status, 'state_version', v_s.state_version); end if;
  select * into v_set from public.tenant_settings where tenant_id = v_s.tenant_id;
  -- Screen sharing is requested only if the school allows it and, where the school
  -- requires it, a parent/guardian monitoring consent is on file for this student.
  v_capture := v_set.allow_screen_capture and (not v_set.require_monitoring_consent or app.has_monitoring_consent(auth.uid()));

  v_reason := case
    when not v_s.lockdown then null
    when not coalesce(p_visible, true) then 'Left the lesson (switched tab, app or window)'
    when not coalesce(p_fullscreen, false) and not p_unsupported then 'Left full-screen mode'
    when v_capture and not coalesce(p_sharing, false) and not p_unsupported then 'Stopped sharing their screen'
  end;

  select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  if v_old.session_id is null then
    insert into public.session_participants (session_id, user_id, tenant_id, status, current_slide)
      values (p_session, auth.uid(), v_s.tenant_id, v_status, v_s.current_slide)
      on conflict (session_id, user_id) do nothing;
    select * into v_old from public.session_participants where session_id = p_session and user_id = auth.uid();
  end if;

  if v_reason is not null and v_old.ready_at is null then
    if v_old.joined_at > now() - interval '2 minutes' then v_reason := null; v_setup := true;
    else v_reason := 'Did not start the lesson (screen share and full screen are required)'; end if;
  end if;

  v_slide := case when v_s.mode = 'student_paced' then coalesce(case when p_slide >= 0 then p_slide end, v_old.current_slide)
                  else v_s.current_slide end;

  v_changed := v_old.left_at is not null
    or v_old.status is distinct from v_status
    or v_old.current_slide is distinct from v_slide
    or v_old.tab_visible is distinct from coalesce(p_visible, true)
    or v_old.fullscreen is distinct from coalesce(p_fullscreen, false)
    or v_old.screen_sharing is distinct from coalesce(p_sharing, false)
    or v_old.share_unsupported is distinct from coalesce(p_unsupported, false)
    or v_old.screen_surface is distinct from left(p_surface, 20)
    or v_old.away_reason is distinct from v_reason
    or (v_reason is null and not v_setup and v_old.ready_at is null);

  -- Presence only needs a write every 15 s; everything else writes on change.
  if v_changed or v_old.last_seen_at < now() - make_interval(secs => app.tick_seconds() * 1.5) then
    update public.session_participants set
      last_seen_at = now(), left_at = null, status = v_status, current_slide = v_slide,
      tab_visible = coalesce(p_visible, true), fullscreen = coalesce(p_fullscreen, false),
      screen_sharing = coalesce(p_sharing, false), share_unsupported = coalesce(p_unsupported, false),
      screen_surface = left(p_surface, 20),
      ready_at = case when v_reason is null and not v_setup then coalesce(ready_at, now()) else ready_at end,
      away_since = case when v_reason is null then null else coalesce(away_since, now()) end,
      away_reason = v_reason
    where session_id = p_session and user_id = auth.uid()
    returning * into v_p;
  else
    v_p := v_old;
  end if;

  if v_setup then
    null;
  elsif v_reason is null then
    -- Only look for alerts to close if the student may have had one.
    if v_old.away_since is not null or v_old.left_at is not null or v_old.last_seen_at < now() - interval '40 seconds' then
      update public.environment_events set resolved_at = now()
       where class_session_id = p_session and student_id = auth.uid() and resolved_at is null
         and kind = 'environment_left' and device_id is null;
      get diagnostics v_returned = row_count;
      if v_returned > 0 then
        perform app.notify(v_s.teacher_id, 'student_returned',
          (select full_name from public.users where id = auth.uid()) || ' returned to the class', null,
          '/teacher/live/' || p_session, 'info', jsonb_build_object('student_id', auth.uid()));
      end if;
    end if;
  else
    perform app.web_leave_check(v_s);
  end if;

  return jsonb_build_object(
    'status', v_s.status,
    'lockdown', v_s.lockdown,
    'away', v_reason is not null,
    'reason', v_reason,
    'setting_up', v_setup,
    'tick_seconds', app.tick_seconds(),
    'state_version', v_s.state_version,
    'current_slide', v_s.current_slide,
    'active_activity_id', v_s.active_activity_id,
    'capture', jsonb_build_object(
      'enabled', v_capture,
      -- frames are only worth sending while a teacher has the live room open
      'send', v_capture and coalesce(v_s.teacher_seen_at > now() - interval '45 seconds', false),
      'interval_seconds', greatest(v_set.thumbnail_interval_seconds, 5),
      'high_quality', v_p.hq_requested_at is not null and v_p.hq_requested_at > now() - interval '30 seconds'
                      or exists (select 1 from public.spotlights sp where sp.session_id = p_session
                                 and sp.student_id = auth.uid() and sp.ended_at is null)));
end$$;

-- Admins change the new setting from Admin → Settings (column-level grant, like the others).
grant update (require_monitoring_consent) on public.tenant_settings to authenticated;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '0780')
$$;
