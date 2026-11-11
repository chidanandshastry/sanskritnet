-- =====================================================================
-- Test of the Day. Run AFTER schema.sql, admin.sql and features.sql.
-- One 20-question test per day (India time), the same for every student,
-- one attempt each, with its own daily leaderboard (score, then speed).
-- Safe to re-run.
-- =====================================================================

alter table public.test_sessions drop constraint if exists test_sessions_kind_check;
alter table public.test_sessions add constraint test_sessions_kind_check
  check (kind in ('full','unit','mistakes','saved','daily'));
alter table public.attempts drop constraint if exists attempts_kind_check;
alter table public.attempts add constraint attempts_kind_check
  check (kind in ('full','unit','mistakes','saved','daily'));

create index if not exists test_sessions_daily_idx on public.test_sessions (started_at) where kind = 'daily';

create or replace function public.today_ist()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;
revoke execute on function public.today_ist() from public, anon, authenticated;

-- start_test: adds the 'daily' kind. Reopening an unfinished daily test returns
-- the same session with the time already used, so the clock cannot be reset.
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
      ) s
      order by (s.rn <= ceil(v_n / 10.0)) desc, random()
      limit v_n) t;
  elsif v_kind = 'unit' then
    if p_unit is null then raise exception 'Choose a unit'; end if;
    select array_agg(t.id) into v_ids from (
      select q.id from public.questions q where q.unit = p_unit order by random() limit v_n) t;
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

-- What the dashboard card needs.
create or replace function public.daily_status()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_day date := public.today_ist();
  v_att record; v_rank int; v_players int; v_prog boolean;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;

  select a.id, a.score, a.total, a.correct, a.duration_sec, a.late into v_att
    from public.attempts a join public.test_sessions s on s.id = a.session_id
   where a.user_id = auth.uid() and s.kind = 'daily'
     and (s.started_at at time zone 'Asia/Kolkata')::date = v_day
   limit 1;

  select count(*) into v_players
    from public.attempts a join public.test_sessions s on s.id = a.session_id
   where s.kind = 'daily' and (s.started_at at time zone 'Asia/Kolkata')::date = v_day and not a.late;

  if v_att.id is not null and not v_att.late then
    select count(*) + 1 into v_rank
      from public.attempts a join public.test_sessions s on s.id = a.session_id
     where s.kind = 'daily' and (s.started_at at time zone 'Asia/Kolkata')::date = v_day and not a.late
       and (a.score > v_att.score or (a.score = v_att.score and a.duration_sec < v_att.duration_sec));
  end if;

  select exists (select 1 from public.test_sessions s
                  where s.user_id = auth.uid() and s.kind = 'daily' and not s.submitted
                    and (s.started_at at time zone 'Asia/Kolkata')::date = v_day) into v_prog;

  return jsonb_build_object(
    'day', v_day,
    'count', least(20, (select count(*) from public.questions)),
    'done', v_att.id is not null,
    'in_progress', coalesce(v_prog, false),
    'attempt_id', v_att.id, 'score', v_att.score, 'total', v_att.total, 'correct', v_att.correct,
    'late', coalesce(v_att.late, false), 'rank', v_rank, 'players', v_players);
end $$;

-- Daily leaderboard: higher score first, then faster time.
create or replace function public.get_daily_leaderboard(p_day date default null)
returns table(rank bigint, name text, score int, pct numeric, duration_sec int)
language sql security definer stable set search_path = public as $$
  select row_number() over (order by a.score desc, a.duration_sec asc, p.name)::bigint,
         coalesce(p.name, 'Student'), a.score,
         round(100.0 * a.score / nullif(a.total * 2, 0), 1), a.duration_sec
  from public.attempts a
  join public.test_sessions s on s.id = a.session_id
  left join public.profiles p on p.id = a.user_id
  where s.kind = 'daily' and not a.late
    and (s.started_at at time zone 'Asia/Kolkata')::date = coalesce(p_day, public.today_ist())
  order by 1
  limit 50;
$$;

revoke execute on function public.start_test(int, int, text)  from public, anon;
revoke execute on function public.daily_status()              from public, anon;
revoke execute on function public.get_daily_leaderboard(date) from public, anon;
grant  execute on function public.start_test(int, int, text)  to authenticated;
grant  execute on function public.daily_status()              to authenticated;
grant  execute on function public.get_daily_leaderboard(date) to authenticated;
