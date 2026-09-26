-- =============================================================================
-- SwiftCipher: make an account THE platform super admin
--
-- There can only be one super admin. No button in the app can grant it; only
-- this script (run by whoever controls the Supabase project) or
-- `node scripts/set-super-admin.mjs <email>`.
--
-- BEFORE YOU RUN
--   1. Create the account (use a dedicated address, e.g. Admin@synergyswift.com):
--      Supabase dashboard -> Authentication -> Users -> Add user -> Create new user,
--      tick "Auto Confirm User", set a strong password.
--      (Don't create a school with it: the super admin needs no school.)
--   2. Replace the email below with that address.
--
-- RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--   The result shows the email that now holds the role.
--
-- THEN
--   Sign in at https://<your-domain>/login with that account: you land on /super.
--   Anyone else who opens /super gets "page not found".
--
-- HAND OVER (e.g. a staff change): run this again with the new email; the old
-- account loses the role in the same statement. Every change is recorded in
-- the platform audit log.
-- =============================================================================

with target as (
  select id from auth.users where lower(email) = lower('Admin@synergyswift.com')   -- <-- change this
), assigned as (
  insert into public.platform_admins (singleton, user_id, assigned_at)
  select true, id, now() from target
  on conflict (singleton) do update set user_id = excluded.user_id, assigned_at = now()
  returning user_id
), logged as (
  insert into public.platform_audit (actor_id, action, target_type, target_id)
  select null, 'super_admin.assigned', 'user', user_id::text from assigned
  returning target_id
)
select coalesce((select u.email from auth.users u join assigned a on a.user_id = u.id),
                'NO ACCOUNT WITH THAT EMAIL: create it first (step 1), then run this again') as super_admin;
