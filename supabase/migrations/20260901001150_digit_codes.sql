-- Codes students type are 6 digits, shown without a dash: a lesson's join code, a
-- class code and a Challenge code. (Teacher invites, lesson share links and device
-- pairing codes keep letters too.) Codes already handed out keep working; a teacher
-- can give a class a new digit code with "New code".
-- Same as 0600, with the digit branch.
create or replace function app.unique_code(p_len int, p_table text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text; v_taken boolean; v_bytes bytea;
begin
  for i in 1 .. 30 loop
    if p_table in ('classes', 'class_sessions', 'game_sessions') then
      -- Digits only, never starting with 0 (so it can't lose a digit in a spreadsheet).
      v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      v := ((get_byte(v_bytes, 0) % 9) + 1)::text;
      for j in 1 .. 5 loop v := v || (get_byte(v_bytes, j) % 10)::text; end loop;
    else
      v := app.gen_code(p_len);
    end if;
    execute format('select exists (select 1 from public.%I where %I = $1)', p_table,
                   case when p_table = 'device_pairing_codes' then 'code'
                        when p_table in ('invites','lesson_shares') then 'code'
                        else 'join_code' end)
      into v_taken using v;
    if not v_taken then return v; end if;
  end loop;
  raise exception 'Could not allocate a unique code; try again.' using errcode = 'P0001';
end$$;

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1150')
$$;
