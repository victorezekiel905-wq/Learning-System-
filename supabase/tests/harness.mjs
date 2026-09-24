// In-process Postgres (PGlite) with a faithful-enough Supabase shim:
// roles + default privileges, auth.uid(), storage schema, realtime publication.
// Lets the migrations and RLS policies be exercised without Docker.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const SUPABASE_SHIM = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_storage_admin nologin;

create schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create publication supabase_realtime;

-- Realtime "Broadcast from Database": records what would be sent.
create schema realtime;
create table realtime.sent (id bigserial primary key, topic text, event text, payload jsonb, private boolean, at timestamptz default now());
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.sent (topic, event, payload, private) values (topic, event, payload, private) $$;

-- Supabase grants these by default on everything created in public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

export function migrationFiles() {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

/** `upTo`: apply only migrations whose file name sorts at or before it (to test upgrade paths). */
export async function createDb(upTo) {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles().filter((f) => !upTo || f <= upTo)) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      err.message = `migration ${file} failed: ${err.message}`;
      throw err;
    }
  }
  return new Db(db);
}

class Db {
  constructor(pg) { this.pg = pg; }

  /** Run as the postgres superuser (bypasses RLS) — for fixtures only. */
  async admin(sql, params = []) {
    await this.pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
    const r = await this.pg.query(sql, params);
    return r.rows;
  }

  /** Run as an authenticated end user, exactly like a PostgREST request. */
  async as(userId, sql, params = []) {
    await this.pg.exec("reset role;");
    await this.pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await this.pg.exec(userId ? "set role authenticated;" : "set role anon;");
    try {
      const r = await this.pg.query(sql, params);
      return r.rows;
    } finally {
      await this.pg.exec("reset role;");
    }
  }

  anon(sql, params = []) { return this.as(null, sql, params); }

  /** Call a public RPC as a user and return its single scalar/json result. */
  async rpc(userId, fn, args = {}) {
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    const rows = await this.as(userId, sql, names.map((n) => args[n]));
    return rows[0]?.r;
  }

  /** Create an auth.users row (what Supabase Auth does on sign-up). */
  async signUp(email, fullName = email.split("@")[0]) {
    const id = randomUUID();
    await this.admin(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
      [id, email, { full_name: fullName }]
    );
    return id;
  }
}
