-- =============================================================================
-- SwiftCipher — 0200 learning engine: Studio (§3.1) + Assess (§3.2)
-- =============================================================================

create table public.lessons (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  owner_id        uuid not null,
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text,
  subject         text,
  grade_level     text,
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  default_mode    text not null default 'live_participation'
                    check (default_mode in ('live_participation','student_paced','front_of_class')),
  is_template     boolean not null default false,
  current_version int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create index lessons_tenant_idx on public.lessons(tenant_id, updated_at desc);
create trigger lessons_touch before update on public.lessons
  for each row execute function app.touch_updated_at();

-- Immutable snapshot taken on every publish (§3.1 versioning).
create table public.lesson_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  lesson_id    uuid not null,
  version      int  not null,
  snapshot     jsonb not null,
  published_by uuid,
  created_at   timestamptz not null default now(),
  unique (lesson_id, version),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade
);

-- Activities can live inside a lesson or stand alone (question bank, games, assignments).
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  lesson_id     uuid,
  owner_id      uuid not null,
  kind          text not null check (kind in (
                  'multiple_choice','poll','open_ended','quiz','draw','fill_blank','matching',
                  'drag_drop','collab_board','file_upload','short_answer','code')),
  title         text not null check (length(btrim(title)) between 1 and 200),
  instructions  text,
  -- time_limit_seconds, attempts_allowed, shuffle_questions, shuffle_options,
  -- show_feedback ('immediately'|'after_submit'|'never'), rubric_id
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade,
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create index activities_lesson_idx on public.activities(lesson_id);
create trigger activities_touch before update on public.activities
  for each row execute function app.touch_updated_at();

-- Blueprint name for a competitive/multi-question assessment is "quiz".
create view public.quizzes with (security_invoker = true) as
  select * from public.activities where kind = 'quiz';

create table public.lesson_slides (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  lesson_id   uuid not null,
  position    int  not null check (position >= 0),
  kind        text not null check (kind in (
                'title','text','image','video','audio','embed','link','attachment',
                'shapes','whiteboard','activity')),
  -- kind-specific content: heading, body (markdown), media_id, url, alt, captions_url,
  -- shapes[], strokes[] ... Validated in the API layer.
  content     jsonb not null default '{}'::jsonb,
  notes       text,
  activity_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade,
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete set null (activity_id),
  check (kind <> 'activity' or activity_id is not null)
);
create index lesson_slides_lesson_idx on public.lesson_slides(lesson_id, position);
create trigger lesson_slides_touch before update on public.lesson_slides
  for each row execute function app.touch_updated_at();

-- Media library (§3.1): folders, tags, search.
-- array_to_string is only STABLE, so wrap it for use in a generated column.
create or replace function app.media_search_doc(p_title text, p_alt text, p_tags text[]) returns tsvector
language sql immutable set search_path = '' as $$
  select to_tsvector('simple'::regconfig,
    coalesce(p_title, '') || ' ' || coalesce(p_alt, '') || ' ' || coalesce(array_to_string(p_tags, ' '), ''))
$$;

create table public.media_folders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  owner_id    uuid not null,
  parent_id   uuid,
  name        text not null check (length(btrim(name)) between 1 and 120),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (parent_id, tenant_id) references public.media_folders(id, tenant_id) on delete cascade
);

create table public.lesson_media (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  owner_id      uuid not null,
  folder_id     uuid,
  lesson_id     uuid,
  storage_path  text not null unique,          -- "<tenant_id>/<owner_id>/<uuid>-<name>" in bucket lesson-media
  kind          text not null check (kind in ('image','video','audio','document','other')),
  mime_type     text not null,
  bytes         bigint not null check (bytes >= 0),
  title         text not null,
  alt_text      text,
  captions_path text,
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  search        tsvector generated always as (app.media_search_doc(title, alt_text, tags)) stored,
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id),
  foreign key (folder_id, tenant_id) references public.media_folders(id, tenant_id) on delete set null (folder_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete set null (lesson_id),
  check (storage_path like tenant_id::text || '/%')
);
create index lesson_media_search_idx on public.lesson_media using gin(search);
create index lesson_media_tenant_idx on public.lesson_media(tenant_id, created_at desc);

-- Secure share code/link with expiry (§3.1).
create table public.lesson_shares (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  lesson_id   uuid not null,
  class_id    uuid,
  code        text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  mode        text not null default 'student_paced' check (mode in ('student_paced','front_of_class')),
  created_by  uuid not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete cascade,
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Questions. Students never SELECT this table (answer keys live here);
-- they receive sanitised copies through RPCs in 0600.
-- ---------------------------------------------------------------------------
create table public.questions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  activity_id  uuid,                 -- null = question-bank only
  owner_id     uuid not null,
  kind         text not null check (kind in (
                 'mcq','multi_select','true_false','poll','open','short','fill_blank',
                 'matching','ordering','categorize','draw','file','code')),
  prompt       text not null check (length(btrim(prompt)) between 1 and 4000),
  media        jsonb not null default '{}'::jsonb,
  -- Public, non-secret structure: blanks, left/right items, categories, items to
  -- order, language/starter code, visible test descriptions.
  config       jsonb not null default '{}'::jsonb,
  -- Secret: accepted answers, pairs, correct order, category map, hidden tests.
  answer_key   jsonb not null default '{}'::jsonb,
  explanation  text,
  points       numeric(8,2) not null default 1 check (points >= 0),
  position     int not null default 0,
  in_bank      boolean not null default false,
  tags         text[] not null default '{}',
  difficulty   smallint check (difficulty between 1 and 5),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);
create index questions_activity_idx on public.questions(activity_id, position);
create index questions_bank_idx on public.questions(tenant_id) where in_bank;
create trigger questions_touch before update on public.questions
  for each row execute function app.touch_updated_at();

create table public.question_options (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  question_id  uuid not null,
  label        text not null check (length(label) between 1 and 1000),
  is_correct   boolean not null default false,
  feedback     text,
  position     int not null default 0,
  unique (id, tenant_id),
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);
create index question_options_question_idx on public.question_options(question_id, position);

-- ---------------------------------------------------------------------------
-- Assignments / rubrics / grading (§3.2, §23)
-- ---------------------------------------------------------------------------
create table public.rubrics (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  owner_id    uuid not null,
  title       text not null,
  -- [{ "id": "c1", "title": "Accuracy", "levels": [{ "label": "Strong", "points": 4 }] }]
  criteria    jsonb not null check (jsonb_typeof(criteria) = 'array'),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);

create table public.assignments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  class_id          uuid not null,
  activity_id       uuid,
  lesson_id         uuid,
  rubric_id         uuid,
  title             text not null check (length(btrim(title)) between 1 and 200),
  instructions      text,
  due_at            timestamptz,
  allow_late        boolean not null default true,
  max_resubmissions int not null default 0 check (max_resubmissions between 0 and 20),
  points_possible   numeric(8,2) not null default 100,
  status            text not null default 'published' check (status in ('draft','published','closed')),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (class_id, tenant_id) references public.classes(id, tenant_id) on delete cascade,
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete set null (activity_id),
  foreign key (lesson_id, tenant_id) references public.lessons(id, tenant_id) on delete set null (lesson_id),
  foreign key (rubric_id, tenant_id) references public.rubrics(id, tenant_id) on delete set null (rubric_id),
  foreign key (created_by, tenant_id) references public.users(id, tenant_id)
);
create index assignments_class_idx on public.assignments(class_id, due_at);

-- An attempt at any activity: in a live session, from an assignment, or student-paced.
create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  activity_id   uuid not null,
  student_id    uuid not null,
  session_id    uuid,              -- FK added in 0300
  assignment_id uuid,
  attempt_no    int not null default 1 check (attempt_no >= 1),
  seed          int not null,      -- drives reproducible question/option shuffling
  status        text not null default 'in_progress' check (status in ('in_progress','submitted','graded')),
  started_at    timestamptz not null default now(),
  deadline_at   timestamptz,
  submitted_at  timestamptz,
  score         numeric(10,2),
  max_score     numeric(10,2),
  unique (id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (assignment_id, tenant_id) references public.assignments(id, tenant_id) on delete cascade
);
create unique index quiz_attempts_unique_no
  on public.quiz_attempts(activity_id, student_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
                          coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid), attempt_no);
create index quiz_attempts_student_idx on public.quiz_attempts(student_id, started_at desc);

create table public.quiz_answers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  attempt_id    uuid not null,
  question_id   uuid not null,
  response      jsonb not null,
  is_correct    boolean,                 -- null for polls and manually graded work
  auto_score    numeric(8,2),
  manual_score  numeric(8,2),
  feedback      text,
  status        text not null check (status in ('auto_graded','ungraded','pending_review','reviewed')),
  elapsed_ms    int check (elapsed_ms >= 0),
  answered_at   timestamptz not null default now(),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  unique (attempt_id, question_id),
  foreign key (attempt_id, tenant_id) references public.quiz_attempts(id, tenant_id) on delete cascade,
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);
create index quiz_answers_question_idx on public.quiz_answers(question_id);
create index quiz_answers_review_idx on public.quiz_answers(tenant_id) where status = 'pending_review';

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  assignment_id uuid not null,
  student_id    uuid not null,
  attempt_no    int not null default 1,
  body          text,
  files         jsonb not null default '[]'::jsonb,   -- [{ path, name, bytes }] in bucket "submissions"
  attempt_id    uuid,
  status        text not null default 'submitted' check (status in ('submitted','returned','graded')),
  is_late       boolean not null default false,
  submitted_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (assignment_id, student_id, attempt_no),
  foreign key (assignment_id, tenant_id) references public.assignments(id, tenant_id) on delete cascade,
  foreign key (student_id, tenant_id) references public.users(id, tenant_id) on delete cascade,
  foreign key (attempt_id, tenant_id) references public.quiz_attempts(id, tenant_id) on delete set null (attempt_id)
);

create table public.grades (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  submission_id  uuid not null unique,
  grader_id      uuid not null,
  score          numeric(8,2) not null check (score >= 0),
  rubric_scores  jsonb not null default '{}'::jsonb,
  feedback       text,
  released_at    timestamptz,
  graded_at      timestamptz not null default now(),
  foreign key (submission_id, tenant_id) references public.submissions(id, tenant_id) on delete cascade,
  foreign key (grader_id, tenant_id) references public.users(id, tenant_id)
);

-- Interactive video (§3.1): questions pinned to timestamps of a video slide.
create table public.video_checkpoints (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  slide_id    uuid not null,
  question_id uuid not null,
  t_seconds   numeric(9,2) not null check (t_seconds >= 0),
  required    boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (slide_id, t_seconds),
  foreign key (slide_id, tenant_id) references public.lesson_slides(id, tenant_id) on delete cascade,
  foreign key (question_id, tenant_id) references public.questions(id, tenant_id) on delete cascade
);

-- Collaborative board (§3.2).
create table public.collab_boards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  activity_id uuid,
  session_id  uuid,                 -- FK added in 0300
  owner_id    uuid not null,
  title       text not null,
  locked      boolean not null default false,
  anonymous   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (activity_id, tenant_id) references public.activities(id, tenant_id) on delete cascade,
  foreign key (owner_id, tenant_id) references public.users(id, tenant_id)
);

create table public.collab_posts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  board_id    uuid not null,
  author_id   uuid not null,
  body        text not null check (length(body) between 1 and 2000),
  color       text not null default 'yellow' check (color in ('yellow','blue','green','pink','purple')),
  x           int not null default 0,
  y           int not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now(),
  foreign key (board_id, tenant_id) references public.collab_boards(id, tenant_id) on delete cascade,
  foreign key (author_id, tenant_id) references public.users(id, tenant_id) on delete cascade
);
create index collab_posts_board_idx on public.collab_posts(board_id, created_at);
