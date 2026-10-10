-- 1060: the SwiftCipher lesson library, shared by every school.
--
-- Ready-made lessons (slides and quizzes) any teacher can copy into their own
-- school and change. A library lesson belongs to no school: it is a snapshot
-- (payload) that library_copy turns into an ordinary lesson in the teacher's
-- school. The super admin publishes lessons into it (library_publish) and can hide
-- them; a starter set on the Nigerian curriculum is included below.

create table if not exists public.library_lessons (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 200),
  subject     text not null check (length(btrim(subject)) between 1 and 60),
  level       text not null check (length(btrim(level)) between 1 and 60),
  description text,
  payload     jsonb not null check (jsonb_typeof(payload -> 'slides') = 'array'),
  published   boolean not null default true,
  uses        int not null default 0,
  source_lesson uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists library_lessons_browse_idx on public.library_lessons(subject, level) where published;
alter table public.library_lessons enable row level security;
revoke all on public.library_lessons from anon, authenticated;
-- Read through library_list / library_copy only.

/** A lesson as a library payload: its slides in order, each activity with its questions and options. */
create or replace function app.library_payload(p_lesson uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'default_mode', l.default_mode,
    'slides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', s.kind, 'content', s.content, 'notes', s.notes,
               'activity', case when a.id is null then null else jsonb_build_object(
                 'kind', a.kind, 'title', a.title, 'instructions', a.instructions, 'settings', a.settings,
                 'questions', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'kind', q.kind, 'prompt', q.prompt, 'media', q.media, 'config', q.config, 'answer_key', q.answer_key,
                            'explanation', q.explanation, 'points', q.points, 'tags', q.tags, 'difficulty', q.difficulty, 'topic', q.topic,
                            'options', coalesce((select jsonb_agg(jsonb_build_object('label', o.label, 'is_correct', o.is_correct, 'feedback', o.feedback) order by o.position)
                                                   from public.question_options o where o.question_id = q.id), '[]'::jsonb))
                          order by q.position)
                   from public.questions q where q.activity_id = a.id), '[]'::jsonb)) end)
             order by s.position)
      from public.lesson_slides s left join public.activities a on a.id = s.activity_id
      where s.lesson_id = l.id), '[]'::jsonb))
  from public.lessons l where l.id = p_lesson
$$;
revoke execute on function app.library_payload(uuid) from public, anon, authenticated;

/** Browse the library (staff): optional subject, level and words to search for. */
create or replace function public.library_list(p_subject text default null, p_level text default null, p_query text default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'title', b.title, 'subject', b.subject, 'level', b.level, 'description', b.description,
           'slides', jsonb_array_length(b.payload -> 'slides'),
           'questions', (select coalesce(sum(jsonb_array_length(coalesce(s -> 'activity' -> 'questions', '[]'::jsonb))), 0)
                           from jsonb_array_elements(b.payload -> 'slides') s),
           'uses', b.uses, 'published', b.published)
         order by b.subject, b.level, b.title), '[]'::jsonb)
    from public.library_lessons b
   where (app.is_teacher() or app.is_super_admin())
     and (b.published or app.is_super_admin())
     and (p_subject is null or b.subject = p_subject)
     and (p_level is null or b.level = p_level)
     and (p_query is null or btrim(p_query) = '' or b.title ilike '%' || btrim(p_query) || '%' or b.description ilike '%' || btrim(p_query) || '%')
$$;

/** Copy a library lesson into the teacher's school as their own draft. Returns the new lesson. */
create or replace function public.library_copy(p_item uuid, p_title text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me   public.users := app.me();
  v_item public.library_lessons;
  v_new  uuid;
  v_act  uuid;
  v_q    uuid;
  v_pos  int := 0;
  v_qpos int;
  v_opos int;
  s      jsonb;
  q      jsonb;
  o      jsonb;
begin
  if v_me.id is null or not app.is_teacher() then raise exception 'Only teachers can use library lessons.' using errcode = '42501'; end if;
  select * into v_item from public.library_lessons where id = p_item and (published or app.is_super_admin());
  if v_item.id is null then raise exception 'That library lesson is not available.' using errcode = 'P0002'; end if;

  insert into public.lessons (tenant_id, owner_id, title, description, subject, grade_level, default_mode)
    values (v_me.tenant_id, v_me.id, coalesce(nullif(btrim(p_title), ''), v_item.title), v_item.description, v_item.subject, v_item.level,
            coalesce(v_item.payload ->> 'default_mode', 'live_participation'))
    returning id into v_new;

  for s in select value from jsonb_array_elements(v_item.payload -> 'slides') loop
    v_act := null;
    if jsonb_typeof(s -> 'activity') = 'object' then
      insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, instructions, settings)
        values (v_me.tenant_id, v_new, v_me.id, coalesce(s -> 'activity' ->> 'kind', 'quiz'), coalesce(s -> 'activity' ->> 'title', 'Activity'),
                s -> 'activity' ->> 'instructions', coalesce(s -> 'activity' -> 'settings', '{}'::jsonb))
        returning id into v_act;
      v_qpos := 0;
      for q in select value from jsonb_array_elements(coalesce(s -> 'activity' -> 'questions', '[]'::jsonb)) loop
        insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, media, config, answer_key, explanation, points, position, tags, difficulty, topic)
          values (v_me.tenant_id, v_act, v_me.id, q ->> 'kind', q ->> 'prompt', coalesce(q -> 'media', '{}'::jsonb), coalesce(q -> 'config', '{}'::jsonb),
                  coalesce(q -> 'answer_key', '{}'::jsonb), q ->> 'explanation', coalesce((q ->> 'points')::numeric, 1), v_qpos,
                  coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(q -> 'tags', '[]'::jsonb)) t), '{}'::text[]),
                  (q ->> 'difficulty')::smallint, q ->> 'topic')
          returning id into v_q;
        v_opos := 0;
        for o in select value from jsonb_array_elements(coalesce(q -> 'options', '[]'::jsonb)) loop
          insert into public.question_options (tenant_id, question_id, label, is_correct, feedback, position)
            values (v_me.tenant_id, v_q, o ->> 'label', coalesce((o ->> 'is_correct')::boolean, false), o ->> 'feedback', v_opos);
          v_opos := v_opos + 1;
        end loop;
        v_qpos := v_qpos + 1;
      end loop;
    end if;
    insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content, notes, activity_id)
      values (v_me.tenant_id, v_new, v_pos, coalesce(s ->> 'kind', 'text'), coalesce(s -> 'content', '{}'::jsonb), s ->> 'notes', v_act);
    v_pos := v_pos + 1;
  end loop;

  update public.library_lessons set uses = uses + 1 where id = p_item;
  perform app.audit('lesson.from_library', 'lesson', v_new::text, jsonb_build_object('library_lesson', p_item));
  return v_new;
end$$;

/** Super admin: put one of their lessons into the library (or refresh it), shown to every school. */
create or replace function public.library_publish(p_lesson uuid, p_subject text, p_level text, p_description text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_l public.lessons; v_id uuid;
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner can publish to the library.' using errcode = '42501'; end if;
  select * into v_l from public.lessons where id = p_lesson;
  if v_l.id is null then raise exception 'Lesson not found.' using errcode = 'P0002'; end if;
  select id into v_id from public.library_lessons where source_lesson = p_lesson;
  if v_id is null then
    insert into public.library_lessons (title, subject, level, description, payload, source_lesson)
      values (v_l.title, btrim(p_subject), btrim(p_level), coalesce(nullif(btrim(p_description), ''), v_l.description), app.library_payload(p_lesson), p_lesson)
      returning id into v_id;
  else
    update public.library_lessons set title = v_l.title, subject = btrim(p_subject), level = btrim(p_level),
           description = coalesce(nullif(btrim(p_description), ''), v_l.description), payload = app.library_payload(p_lesson), updated_at = now()
     where id = v_id;
  end if;
  perform app.audit('library.published', 'library_lesson', v_id::text, jsonb_build_object('lesson', p_lesson));
  return v_id;
end$$;

/** Super admin: show or hide a library lesson. */
create or replace function public.library_set_published(p_item uuid, p_published boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner can change the library.' using errcode = '42501'; end if;
  update public.library_lessons set published = p_published, updated_at = now() where id = p_item;
  if not found then raise exception 'Library lesson not found.' using errcode = 'P0002'; end if;
end$$;

revoke execute on function public.library_list(text, text, text), public.library_copy(uuid, text),
  public.library_publish(uuid, text, text, text), public.library_set_published(uuid, boolean) from public, anon;
grant execute on function public.library_list(text, text, text), public.library_copy(uuid, text),
  public.library_publish(uuid, text, text, text), public.library_set_published(uuid, boolean) to authenticated;

-- >>> starter lessons (generated by scripts/build-library-sql.mjs from supabase/library/starter-lessons.mjs; do not edit by hand)
insert into public.library_lessons (id, title, subject, level, description, payload) values
  ('5c1f0a00-0000-4000-8000-000000000001', 'Light: where it comes from', 'Basic Science', 'JSS 1', 'Luminous and non-luminous objects, light travelling in straight lines, shadows, and transparent, translucent and opaque materials.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Light","body":"Where light comes from, and how we see things"},"notes":null},{"kind":"text","content":{"heading":"Luminous and non-luminous objects","body":"- **Luminous** objects give out their own light: the Sun, a candle flame, a torch bulb, a firefly.\n- **Non-luminous** objects do not make light. We see them because light bounces off them into our eyes: the Moon, a mirror, a book, your desk."},"notes":null},{"kind":"text","content":{"heading":"Light travels in straight lines","body":"- Light moves in straight lines. That is why we cannot see round corners.\n- When an opaque object blocks light, a **shadow** forms behind it.\n- **Transparent** materials (clear glass) let light through. **Translucent** materials (frosted glass) let some through. **Opaque** materials (wood) let none through."},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"Which of these gives out its own light?","config":{},"answer_key":{},"explanation":"The Sun makes its own light. The Moon only reflects sunlight.","points":1,"tags":[],"topic":"Sources of light","options":[{"label":"The Moon","is_correct":false},{"label":"The Sun","is_correct":true},{"label":"A mirror","is_correct":false},{"label":"A window","is_correct":false}]},{"kind":"mcq","prompt":"Why can we see the Moon at night?","config":{},"answer_key":{},"explanation":"The Moon is non-luminous: sunlight bounces off it to our eyes.","points":1,"tags":[],"topic":"Sources of light","options":[{"label":"It makes its own light","is_correct":false},{"label":"It reflects light from the Sun","is_correct":true},{"label":"It is very hot","is_correct":false},{"label":"It is close to the Earth","is_correct":false}]},{"kind":"true_false","prompt":"Light travels in straight lines.","config":{},"answer_key":{},"explanation":"That is why shadows have sharp edges and we cannot see round corners.","points":1,"tags":[],"topic":"How light travels","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"Which material is opaque?","config":{},"answer_key":{},"explanation":"Wood lets no light through, so it is opaque.","points":1,"tags":[],"topic":"Materials and light","options":[{"label":"Clear glass","is_correct":false},{"label":"Frosted glass","is_correct":false},{"label":"Wood","is_correct":true},{"label":"Clean water","is_correct":false}]},{"kind":"mcq","prompt":"A shadow forms when…","config":{},"answer_key":{},"explanation":"Light cannot pass through an opaque object, so the space behind it is dark.","points":1,"tags":[],"topic":"Shadows","options":[{"label":"light passes through glass","is_correct":false},{"label":"an opaque object blocks light","is_correct":true},{"label":"a mirror reflects light","is_correct":false},{"label":"a candle is lit","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000002', 'Equivalent fractions', 'Mathematics', 'JSS 1', 'Fractions with the same value, making them by multiplying or dividing, and simplifying.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Equivalent fractions","body":"Same value, different names"},"notes":null},{"kind":"text","content":{"heading":"What makes fractions equivalent?","body":"- Equivalent fractions have the **same value**.\n- Multiply or divide the **top and bottom by the same number**: 1/2 = 2/4 = 3/6 = 5/10.\n- To simplify, divide the top and bottom by a common factor: 6/8 = 3/4 (both divided by 2)."},"notes":null},{"kind":"text","content":{"heading":"Worked example","body":"Is 3/4 equal to 9/12?\n\nMultiply the top and bottom of 3/4 by 3: 3 × 3 = 9 and 4 × 3 = 12.\n\nSo **3/4 = 9/12**."},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"Which fraction is equivalent to 1/2?","config":{},"answer_key":{},"explanation":"3/6: the top and bottom of 1/2 are both multiplied by 3.","points":1,"tags":[],"topic":"Equivalent fractions","options":[{"label":"2/3","is_correct":false},{"label":"3/6","is_correct":true},{"label":"2/5","is_correct":false},{"label":"1/4","is_correct":false}]},{"kind":"mcq","prompt":"Simplify 6/8.","config":{},"answer_key":{},"explanation":"Divide the top and bottom by 2: 6/8 = 3/4.","points":1,"tags":[],"topic":"Simplifying fractions","options":[{"label":"3/4","is_correct":true},{"label":"2/3","is_correct":false},{"label":"1/2","is_correct":false},{"label":"6/4","is_correct":false}]},{"kind":"true_false","prompt":"2/3 and 4/6 are equivalent fractions.","config":{},"answer_key":{},"explanation":"Multiply the top and bottom of 2/3 by 2 to get 4/6.","points":1,"tags":[],"topic":"Equivalent fractions","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"3/5 is equal to how many twentieths?","config":{},"answer_key":{},"explanation":"5 × 4 = 20, so multiply the top by 4 too: 3 × 4 = 12.","points":1,"tags":[],"topic":"Equivalent fractions","options":[{"label":"9/20","is_correct":false},{"label":"12/20","is_correct":true},{"label":"15/20","is_correct":false},{"label":"8/20","is_correct":false}]},{"kind":"mcq","prompt":"Which fraction is in its simplest form?","config":{},"answer_key":{},"explanation":"5 and 7 have no common factor except 1.","points":1,"tags":[],"topic":"Simplifying fractions","options":[{"label":"4/10","is_correct":false},{"label":"6/9","is_correct":false},{"label":"5/7","is_correct":true},{"label":"8/12","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000003', 'Simple interest', 'Mathematics', 'SS 1', 'The formula I = PRT ÷ 100, the amount at the end, and finding the time.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Simple interest","body":"What money earns, or costs, over time"},"notes":null},{"kind":"text","content":{"heading":"The formula","body":"Simple interest **I = P × R × T ÷ 100**\n\n- **P** is the principal: the money saved or borrowed.\n- **R** is the rate: the percentage per year.\n- **T** is the time in years."},"notes":null},{"kind":"text","content":{"heading":"Worked example","body":"Ada saves ₦20,000 at 5% simple interest a year for 3 years.\n\nI = 20,000 × 5 × 3 ÷ 100 = **₦3,000**\n\nThe amount at the end is 20,000 + 3,000 = **₦23,000**."},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"Find the simple interest on ₦10,000 at 10% a year for 2 years.","config":{},"answer_key":{},"explanation":"I = 10,000 × 10 × 2 ÷ 100 = ₦2,000.","points":1,"tags":[],"topic":"Simple interest","options":[{"label":"₦1,000","is_correct":false},{"label":"₦2,000","is_correct":true},{"label":"₦12,000","is_correct":false},{"label":"₦200","is_correct":false}]},{"kind":"mcq","prompt":"In I = PRT ÷ 100, what does P stand for?","config":{},"answer_key":{},"explanation":"P is the principal: the money saved or borrowed.","points":1,"tags":[],"topic":"Simple interest","options":[{"label":"Profit","is_correct":false},{"label":"Principal","is_correct":true},{"label":"Percentage","is_correct":false},{"label":"Period","is_correct":false}]},{"kind":"mcq","prompt":"₦5,000 is saved at 4% simple interest for 5 years. What is the amount at the end?","config":{},"answer_key":{},"explanation":"I = 5,000 × 4 × 5 ÷ 100 = ₦1,000, so the amount is ₦6,000.","points":1,"tags":[],"topic":"Amount","options":[{"label":"₦5,200","is_correct":false},{"label":"₦6,000","is_correct":true},{"label":"₦1,000","is_correct":false},{"label":"₦5,400","is_correct":false}]},{"kind":"true_false","prompt":"With simple interest, the interest is the same every year.","config":{},"answer_key":{},"explanation":"Simple interest is always worked out on the principal, so each year earns the same.","points":1,"tags":[],"topic":"Simple interest","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"How long will ₦8,000 take to earn ₦1,600 at 5% simple interest?","config":{},"answer_key":{},"explanation":"T = I × 100 ÷ (P × R) = 1,600 × 100 ÷ (8,000 × 5) = 4 years.","points":1,"tags":[],"topic":"Finding the time","options":[{"label":"2 years","is_correct":false},{"label":"4 years","is_correct":true},{"label":"5 years","is_correct":false},{"label":"8 years","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000004', 'Parts of speech', 'English', 'JSS 2', 'Nouns, verbs, adjectives and adverbs, and how to spot them in a sentence.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Parts of speech","body":"The jobs words do in a sentence"},"notes":null},{"kind":"text","content":{"heading":"Four key parts of speech","body":"- **Noun**: names a person, place or thing (Tunde, Kano, book).\n- **Verb**: shows an action or a state (run, write, is).\n- **Adjective**: describes a noun (tall, blue, clever).\n- **Adverb**: describes a verb, and often ends in -ly (quickly, quietly, well)."},"notes":null},{"kind":"text","content":{"heading":"Spot them","body":"In **The clever girl answered quickly**:\n\n- clever: adjective\n- girl: noun\n- answered: verb\n- quickly: adverb"},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"In \"The dog barked loudly\", which word is the verb?","config":{},"answer_key":{},"explanation":"Barked is the action.","points":1,"tags":[],"topic":"Verbs","options":[{"label":"dog","is_correct":false},{"label":"barked","is_correct":true},{"label":"loudly","is_correct":false},{"label":"The","is_correct":false}]},{"kind":"mcq","prompt":"Which word is an adjective?","config":{},"answer_key":{},"explanation":"Beautiful describes a noun, as in \"a beautiful song\".","points":1,"tags":[],"topic":"Adjectives","options":[{"label":"happily","is_correct":false},{"label":"beautiful","is_correct":true},{"label":"run","is_correct":false},{"label":"Lagos","is_correct":false}]},{"kind":"mcq","prompt":"In \"She sang sweetly\", what part of speech is \"sweetly\"?","config":{},"answer_key":{},"explanation":"Sweetly tells us how she sang, so it describes the verb.","points":1,"tags":[],"topic":"Adverbs","options":[{"label":"Noun","is_correct":false},{"label":"Verb","is_correct":false},{"label":"Adjective","is_correct":false},{"label":"Adverb","is_correct":true}]},{"kind":"true_false","prompt":"\"Abuja\" is a noun.","config":{},"answer_key":{},"explanation":"Abuja names a place.","points":1,"tags":[],"topic":"Nouns","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"Which sentence has an adjective describing a noun?","config":{},"answer_key":{},"explanation":"Red describes the noun car.","points":1,"tags":[],"topic":"Adjectives","options":[{"label":"He runs fast.","is_correct":false},{"label":"The red car stopped.","is_correct":true},{"label":"They laughed.","is_correct":false},{"label":"Come here now.","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000005', 'Nigeria: states and capital', 'Social Studies', 'JSS 1', 'The 36 states and the FCT, the capital, independence, and the six geopolitical zones.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Nigeria, our country","body":"States, capital and zones"},"notes":null},{"kind":"text","content":{"heading":"Key facts","body":"- Nigeria has **36 states** and the **Federal Capital Territory (FCT)**.\n- The capital is **Abuja**. It replaced Lagos as the capital in **1991**.\n- Nigeria became independent on **1 October 1960**.\n- The states are grouped into **six geopolitical zones**: North Central, North East, North West, South East, South South and South West."},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"How many states does Nigeria have?","config":{},"answer_key":{},"explanation":"36 states, plus the Federal Capital Territory.","points":1,"tags":[],"topic":"States","options":[{"label":"30","is_correct":false},{"label":"36","is_correct":true},{"label":"37","is_correct":false},{"label":"40","is_correct":false}]},{"kind":"mcq","prompt":"What is the capital of Nigeria?","config":{},"answer_key":{},"explanation":"Abuja has been the capital since 1991.","points":1,"tags":[],"topic":"Capital","options":[{"label":"Lagos","is_correct":false},{"label":"Abuja","is_correct":true},{"label":"Kano","is_correct":false},{"label":"Ibadan","is_correct":false}]},{"kind":"mcq","prompt":"When did Nigeria become independent?","config":{},"answer_key":{},"explanation":"Nigeria became independent on 1 October 1960.","points":1,"tags":[],"topic":"History","options":[{"label":"1 October 1960","is_correct":true},{"label":"1 October 1963","is_correct":false},{"label":"12 June 1993","is_correct":false},{"label":"29 May 1999","is_correct":false}]},{"kind":"true_false","prompt":"Lagos is still Nigeria''s capital.","config":{},"answer_key":{},"explanation":"Abuja replaced Lagos as the capital in 1991.","points":1,"tags":[],"topic":"Capital","options":[{"label":"True","is_correct":false},{"label":"False","is_correct":true}]},{"kind":"mcq","prompt":"How many geopolitical zones are there in Nigeria?","config":{},"answer_key":{},"explanation":"North Central, North East, North West, South East, South South and South West.","points":1,"tags":[],"topic":"Geopolitical zones","options":[{"label":"Four","is_correct":false},{"label":"Five","is_correct":false},{"label":"Six","is_correct":true},{"label":"Seven","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000006', 'Photosynthesis', 'Biology', 'SS 1', 'How green plants make food: raw materials, products, chlorophyll, chloroplasts and stomata.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Photosynthesis","body":"How green plants make their food"},"notes":null},{"kind":"text","content":{"heading":"What happens","body":"Green plants make glucose from **carbon dioxide** and **water**, using **light energy** trapped by **chlorophyll**. Oxygen is given off.\n\ncarbon dioxide + water → glucose + oxygen (in light, with chlorophyll)"},"notes":null},{"kind":"text","content":{"heading":"Where it happens","body":"- In the **chloroplasts**, mostly in the cells of leaves.\n- Carbon dioxide enters the leaf through tiny pores called **stomata**.\n- Water travels up from the roots through the **xylem**."},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"Which gas do plants take in for photosynthesis?","config":{},"answer_key":{},"explanation":"Carbon dioxide is one of the two raw materials, with water.","points":1,"tags":[],"topic":"Raw materials","options":[{"label":"Oxygen","is_correct":false},{"label":"Carbon dioxide","is_correct":true},{"label":"Nitrogen","is_correct":false},{"label":"Hydrogen","is_correct":false}]},{"kind":"mcq","prompt":"Which green pigment traps light energy?","config":{},"answer_key":{},"explanation":"Chlorophyll in the chloroplasts traps light.","points":1,"tags":[],"topic":"Chlorophyll","options":[{"label":"Haemoglobin","is_correct":false},{"label":"Chlorophyll","is_correct":true},{"label":"Melanin","is_correct":false},{"label":"Keratin","is_correct":false}]},{"kind":"mcq","prompt":"Which of these is a product of photosynthesis?","config":{},"answer_key":{},"explanation":"The products are glucose and oxygen.","points":1,"tags":[],"topic":"Products","options":[{"label":"Carbon dioxide","is_correct":false},{"label":"Water","is_correct":false},{"label":"Glucose","is_correct":true},{"label":"Nitrogen","is_correct":false}]},{"kind":"true_false","prompt":"Photosynthesis takes place in the chloroplasts.","config":{},"answer_key":{},"explanation":"Chloroplasts contain the chlorophyll that traps light.","points":1,"tags":[],"topic":"Where it happens","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"Through which openings does carbon dioxide enter a leaf?","config":{},"answer_key":{},"explanation":"Stomata are tiny pores, mostly on the underside of the leaf.","points":1,"tags":[],"topic":"Where it happens","options":[{"label":"Xylem","is_correct":false},{"label":"Stomata","is_correct":true},{"label":"Roots","is_correct":false},{"label":"Phloem","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000007', 'States of matter', 'Basic Science', 'Primary 5', 'Solids, liquids and gases, and melting, freezing, evaporation and condensation.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"States of matter","body":"Solids, liquids and gases"},"notes":null},{"kind":"text","content":{"heading":"Three states","body":"- **Solids** keep their shape (stone, ice, wood).\n- **Liquids** flow and take the shape of their container (water, oil, milk).\n- **Gases** spread out to fill any space (air, steam, cooking gas)."},"notes":null},{"kind":"text","content":{"heading":"Changing state","body":"- Heating ice makes it **melt** into water.\n- Heating water makes it **evaporate** into steam.\n- Cooling steam makes it **condense** back into water.\n- Cooling water makes it **freeze** into ice."},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"Which of these is a liquid?","config":{},"answer_key":{},"explanation":"Milk flows and takes the shape of its container.","points":1,"tags":[],"topic":"Liquids","options":[{"label":"Stone","is_correct":false},{"label":"Milk","is_correct":true},{"label":"Air","is_correct":false},{"label":"Ice","is_correct":false}]},{"kind":"mcq","prompt":"What happens when ice is heated?","config":{},"answer_key":{},"explanation":"Heat turns solid ice into liquid water: melting.","points":1,"tags":[],"topic":"Changing state","options":[{"label":"It freezes","is_correct":false},{"label":"It melts","is_correct":true},{"label":"It condenses","is_correct":false},{"label":"It stays the same","is_correct":false}]},{"kind":"true_false","prompt":"A gas spreads out to fill any space.","config":{},"answer_key":{},"explanation":"That is why you can smell cooking from another room.","points":1,"tags":[],"topic":"Gases","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"Water turning into steam is called…","config":{},"answer_key":{},"explanation":"Heating a liquid until it becomes a gas is evaporation.","points":1,"tags":[],"topic":"Changing state","options":[{"label":"freezing","is_correct":false},{"label":"melting","is_correct":false},{"label":"evaporation","is_correct":true},{"label":"condensation","is_correct":false}]},{"kind":"mcq","prompt":"Which of these is a solid?","config":{},"answer_key":{},"explanation":"Wood keeps its shape.","points":1,"tags":[],"topic":"Solids","options":[{"label":"Water","is_correct":false},{"label":"Steam","is_correct":false},{"label":"Wood","is_correct":true},{"label":"Oil","is_correct":false}]}]}}]}'::jsonb),
  ('5c1f0a00-0000-4000-8000-000000000008', 'Place value', 'Mathematics', 'Primary 4', 'Thousands, hundreds, tens and units, and the value of each digit.', '{"default_mode":"live_participation","slides":[{"kind":"title","content":{"heading":"Place value","body":"What each digit is worth"},"notes":null},{"kind":"text","content":{"heading":"Thousands, hundreds, tens and units","body":"In **4,725**:\n\n- 4 is in the **thousands** place: 4,000\n- 7 is in the **hundreds** place: 700\n- 2 is in the **tens** place: 20\n- 5 is in the **units** place: 5\n\n4,000 + 700 + 20 + 5 = 4,725"},"notes":null},{"kind":"activity","content":{},"notes":null,"activity":{"kind":"quiz","title":"Check your understanding","instructions":null,"settings":{},"questions":[{"kind":"mcq","prompt":"What is the value of 6 in 3,642?","config":{},"answer_key":{},"explanation":"6 is in the hundreds place, so it is worth 600.","points":1,"tags":[],"topic":"Place value","options":[{"label":"6","is_correct":false},{"label":"60","is_correct":false},{"label":"600","is_correct":true},{"label":"6,000","is_correct":false}]},{"kind":"mcq","prompt":"Which number has 8 in the tens place?","config":{},"answer_key":{},"explanation":"In 1,284 the digits are 1 thousand, 2 hundreds, 8 tens and 4 units.","points":1,"tags":[],"topic":"Place value","options":[{"label":"8,123","is_correct":false},{"label":"1,284","is_correct":true},{"label":"2,348","is_correct":false},{"label":"8,000","is_correct":false}]},{"kind":"mcq","prompt":"Write 5,000 + 300 + 40 + 2 as a number.","config":{},"answer_key":{},"explanation":"5 thousands, 3 hundreds, 4 tens and 2 units make 5,342.","points":1,"tags":[],"topic":"Expanded form","options":[{"label":"5,342","is_correct":true},{"label":"5,432","is_correct":false},{"label":"534","is_correct":false},{"label":"50,342","is_correct":false}]},{"kind":"true_false","prompt":"In 9,105, the digit 0 is in the tens place.","config":{},"answer_key":{},"explanation":"9 thousands, 1 hundred, 0 tens and 5 units.","points":1,"tags":[],"topic":"Place value","options":[{"label":"True","is_correct":true},{"label":"False","is_correct":false}]},{"kind":"mcq","prompt":"What is the value of 9 in 9,051?","config":{},"answer_key":{},"explanation":"9 is in the thousands place, so it is worth 9,000.","points":1,"tags":[],"topic":"Place value","options":[{"label":"9","is_correct":false},{"label":"90","is_correct":false},{"label":"900","is_correct":false},{"label":"9,000","is_correct":true}]}]}}]}'::jsonb)
on conflict (id) do update set title = excluded.title, subject = excluded.subject, level = excluded.level,
  description = excluded.description, payload = excluded.payload, updated_at = now();
-- <<< starter lessons

create or replace function public.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'db_time', now(), 'schema', '1060')
$$;
