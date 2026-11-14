-- =====================================================================
-- No repeats: a student never sees the same question twice in full-mock or unit
-- tests until they restart. Run AFTER daily.sql. Safe to re-run.
-- A question counts as seen once it is in a submitted full or unit attempt made
-- after that unit's last restart. Practice and daily tests do not count.
-- =====================================================================

create table if not exists public.unit_resets (
  user_id  uuid not null references auth.users(id) on delete cascade,
  unit     int  not null references public.units(id) on delete cascade,
  reset_at timestamptz not null default now(),
  primary key (user_id, unit)
);
alter table public.unit_resets enable row level security;   -- no policies: only the functions below use it

-- Internal: question ids this student has already used up.
create or replace function public.seen_ids()
returns setof int language sql security definer stable set search_path = public as $$
  select distinct x.qid
  from public.attempts a
  cross join lateral unnest(a.question_ids) as x(qid)
  join public.questions q on q.id = x.qid
  where a.user_id = auth.uid() and a.kind in ('full','unit')
    and a.created_at > coalesce((select r.reset_at from public.unit_resets r where r.user_id = a.user_id and r.unit = q.unit), '-infinity'::timestamptz);
$$;
revoke execute on function public.seen_ids() from public, anon, authenticated;

-- Per unit: how many questions exist and how many are still new to this student.
create or replace function public.unit_remaining()
returns table(unit int, total bigint, remaining bigint)
language sql security definer stable set search_path = public as $$
  with seen as (select s as id from public.seen_ids() s)
  select u.id, count(q.id), count(q.id) filter (where q.id not in (select id from seen))
  from public.units u left join public.questions q on q.unit = u.id
  where auth.uid() is not null
  group by u.id order by u.id;
$$;

-- Start a unit over (p_unit null = every unit). Past scores and the leaderboard are untouched.
create or replace function public.restart_unit(p_unit int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  insert into public.unit_resets (user_id, unit, reset_at)
  select auth.uid(), u.id, now() from public.units u where p_unit is null or u.id = p_unit
  on conflict (user_id, unit) do update set reset_at = now();
end $$;

create or replace function public.start_test(p_unit int default null, p_count int default 100, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n       int  := greatest(1, least(coalesce(p_count, 100), 100));
  v_kind    text := coalesce(p_kind, case when p_unit is null then 'full' else 'unit' end);
  v_ids     int[];
  v_sid     uuid;
  v_elapsed int  := 0;
  v_day     date := public.today_ist();
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if v_kind not in ('full','unit','mistakes','saved','daily') then raise exception 'Unknown test type'; end if;

  if v_kind = 'full' then
    select array_agg(t.id) into v_ids from (
      select s.id from (
        select q.id, row_number() over (partition by q.unit order by random()) as rn from public.questions q
         where q.id not in (select public.seen_ids())
      ) s
      order by (s.rn <= ceil(v_n / 10.0)) desc, random()
      limit v_n) t;
    if coalesce(array_length(v_ids, 1), 0) < v_n then
      raise exception 'Not enough new questions are left for a full mock. Restart some units to continue.';
    end if;
  elsif v_kind = 'unit' then
    if p_unit is null then raise exception 'Choose a unit'; end if;
    select array_agg(t.id) into v_ids from (
      select q.id from public.questions q where q.unit = p_unit and q.id not in (select public.seen_ids())
       order by random() limit v_n) t;
    if v_ids is null then raise exception 'You have finished every question in this unit. Restart the unit to practise it again.'; end if;
  elsif v_kind = 'mistakes' then
    select array_agg(t.id) into v_ids from (
      select q.id from public.questions q where q.id in (select public.mistake_ids()) order by random() limit v_n) t;
    if v_ids is null then raise exception 'No mistakes to practise yet. Take a test first.'; end if;
  elsif v_kind = 'saved' then
    select array_agg(t.id) into v_ids from (
      select q.id from public.questions q join public.bookmarks b on b.question_id = q.id and b.user_id = auth.uid()
      order by random() limit v_n) t;
    if v_ids is null then raise exception 'You have not saved any questions yet.'; end if;
  else
    -- daily
    if exists (select 1 from public.attempts a join public.test_sessions s on s.id = a.session_id
               where a.user_id = auth.uid() and s.kind = 'daily'
                 and (s.started_at at time zone 'Asia/Kolkata')::date = v_day) then
      raise exception 'You have already taken today''s test. A new one opens at midnight.';
    end if;
    select s.id, s.question_ids, extract(epoch from now() - s.started_at)::int
      into v_sid, v_ids, v_elapsed
      from public.test_sessions s
     where s.user_id = auth.uid() and s.kind = 'daily' and not s.submitted
       and (s.started_at at time zone 'Asia/Kolkata')::date = v_day
     order by s.started_at desc limit 1;
    if v_sid is null then
      select array_agg(t.id order by t.h) into v_ids from (
        select s.id, s.h from (
          select q.id, md5(q.id::text || v_day::text) as h,
                 row_number() over (partition by q.unit order by md5(q.id::text || v_day::text)) as rn
          from public.questions q) s
        order by (s.rn <= 2) desc, s.h
        limit 20) t;
    end if;
  end if;

  if v_ids is null then raise exception 'No questions available yet for this test'; end if;

  if v_sid is null then
    insert into public.test_sessions (user_id, unit, kind, question_ids)
    values (auth.uid(), case when v_kind = 'unit' then p_unit else null end, v_kind, v_ids)
    returning id into v_sid;
  end if;

  return jsonb_build_object(
    'session_id', v_sid, 'unit', case when v_kind = 'unit' then p_unit else null end, 'kind', v_kind,
    'elapsed_sec', coalesce(v_elapsed, 0),
    'questions', (
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'unit', q.unit, 'question', q.question,
                           'a', q.option_a, 'b', q.option_b, 'c', q.option_c, 'd', q.option_d)
        order by array_position(v_ids, q.id))
      from public.questions q where q.id = any(v_ids)));
end $$;


revoke execute on function public.start_test(int, int, text) from public, anon;
revoke execute on function public.unit_remaining()           from public, anon;
revoke execute on function public.restart_unit(int)          from public, anon;
grant  execute on function public.start_test(int, int, text) to authenticated;
grant  execute on function public.unit_remaining()           to authenticated;
grant  execute on function public.restart_unit(int)          to authenticated;
