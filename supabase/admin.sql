-- =====================================================================
-- Admin dashboard + student stats (run AFTER schema.sql; safe to re-run)
-- Admins are listed in public.admins. Add yourself with:
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'your-email@example.com'
--   on conflict do nothing;
-- =====================================================================

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Admin: overview -------------------------------------------
create or replace function public.admin_stats()
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'students',    (select count(*) from public.profiles),
    'attempts',    (select count(*) from public.attempts),
    'attempts_7d', (select count(*) from public.attempts where created_at > now() - interval '7 days'),
    'questions',   (select count(*) from public.questions),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'n', x.n) order by x.id), '[]'::jsonb)
              from (select u.id, u.title, count(q.id) n from public.units u
                    left join public.questions q on q.unit = u.id group by u.id, u.title) x),
    'recent', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
                 select coalesce(p.name, 'Student') as name, a.unit, a.score, a.total, a.created_at
                 from public.attempts a left join public.profiles p on p.id = a.user_id
                 order by a.created_at desc limit 10) r)
  );
end $$;

-- ---------- Admin: questions ------------------------------------------
create or replace function public.admin_list_questions(
  p_unit int default null, p_search text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_total bigint; v_rows jsonb; v_s text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select count(*) into v_total from public.questions q
   where (p_unit is null or q.unit = p_unit)
     and (v_s is null or q.question ilike '%' || v_s || '%');
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc), '[]'::jsonb) into v_rows from (
    select q.id, q.unit, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct, q.explanation
    from public.questions q
    where (p_unit is null or q.unit = p_unit)
      and (v_s is null or q.question ilike '%' || v_s || '%')
    order by q.id desc
    limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset)) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.admin_save_question(
  p_id int, p_unit int, p_question text, p_a text, p_b text, p_c text, p_d text,
  p_correct text, p_expl text)
returns int language plpgsql security definer set search_path = public as $$
declare v_id int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(trim(p_question), '') = '' or coalesce(trim(p_a), '') = '' or coalesce(trim(p_b), '') = ''
     or coalesce(trim(p_c), '') = '' or coalesce(trim(p_d), '') = '' then
    raise exception 'Question and all four options are required';
  end if;
  if upper(trim(p_correct)) not in ('A','B','C','D') then raise exception 'Correct answer must be A, B, C or D'; end if;
  if not exists (select 1 from public.units where id = p_unit) then raise exception 'Unit % does not exist', p_unit; end if;

  if p_id is null then
    insert into public.questions (unit, question, option_a, option_b, option_c, option_d, correct, explanation)
    values (p_unit, trim(p_question), trim(p_a), trim(p_b), trim(p_c), trim(p_d), upper(trim(p_correct)), nullif(trim(coalesce(p_expl, '')), ''))
    returning id into v_id;
  else
    update public.questions set unit = p_unit, question = trim(p_question), option_a = trim(p_a), option_b = trim(p_b),
      option_c = trim(p_c), option_d = trim(p_d), correct = upper(trim(p_correct)),
      explanation = nullif(trim(coalesce(p_expl, '')), '')
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Question not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_question(p_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.questions where id = p_id;
end $$;

-- Bulk import: p_rows = [{unit, question, option_a..option_d, correct, explanation}, ...]
create or replace function public.admin_import_questions(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; ok int := 0; errs jsonb := '[]'::jsonb; v_unit int; v_cor text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Expected a list of questions'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Import at most 2000 questions at a time'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_unit := nullif(trim(r->>'unit'), '')::int;
      v_cor  := upper(trim(coalesce(r->>'correct', '')));
      if v_unit is null or not exists (select 1 from public.units where id = v_unit) then raise exception 'unit must be 1-10'; end if;
      if coalesce(trim(r->>'question'), '') = '' then raise exception 'question is empty'; end if;
      if coalesce(trim(r->>'option_a'), '') = '' or coalesce(trim(r->>'option_b'), '') = ''
         or coalesce(trim(r->>'option_c'), '') = '' or coalesce(trim(r->>'option_d'), '') = '' then
        raise exception 'all four options are required';
      end if;
      if v_cor not in ('A','B','C','D') then raise exception 'correct must be A, B, C or D'; end if;
      insert into public.questions (unit, question, option_a, option_b, option_c, option_d, correct, explanation)
      values (v_unit, trim(r->>'question'), trim(r->>'option_a'), trim(r->>'option_b'), trim(r->>'option_c'),
              trim(r->>'option_d'), v_cor, nullif(trim(coalesce(r->>'explanation', '')), ''));
      ok := ok + 1;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', ok, 'errors', errs);
end $$;

-- ---------- Admin: units & students -----------------------------------
create or replace function public.admin_rename_unit(p_id int, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Title cannot be empty'; end if;
  update public.units set title = trim(p_title) where id = p_id;
end $$;

create or replace function public.admin_list_students()
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(s order by s.last_active desc nulls last), '[]'::jsonb) from (
    select p.name, u.email, p.created_at as joined,
           count(a.id) as attempts,
           max(round(100.0 * a.score / nullif(a.total * 2, 0), 1)) as best_pct,
           max(a.created_at) as last_active
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.attempts a on a.user_id = p.id
    group by p.id, p.name, u.email, p.created_at
    order by max(a.created_at) desc nulls last
    limit 500) s);
end $$;

-- ---------- Student: personal progress --------------------------------
create or replace function public.my_stats()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_attempts int; v_avg numeric; v_best numeric; v_streak int := 0;
  v_answered int := 0; v_correct int := 0;
  v_rank int; v_players int; v_units jsonb; v_trend jsonb;
begin
  if v_uid is null then raise exception 'Please log in first'; end if;

  select count(*), round(avg(100.0 * score / nullif(total * 2, 0)), 1), max(round(100.0 * score / nullif(total * 2, 0), 1))
    into v_attempts, v_avg, v_best from public.attempts where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object('unit', x.unit, 'answered', x.answered, 'correct', x.correct, 'seen', x.seen) order by x.unit), '[]'::jsonb),
         coalesce(sum(x.answered), 0), coalesce(sum(x.correct), 0)
    into v_units, v_answered, v_correct
  from (
    select q.unit,
           count(*) as seen,
           count(*) filter (where a.answers->>(q.id::text) in ('A','B','C','D')) as answered,
           count(*) filter (where a.answers->>(q.id::text) = q.correct) as correct
    from public.attempts a
    cross join lateral unnest(a.question_ids) as qid
    join public.questions q on q.id = qid
    where a.user_id = v_uid
    group by q.unit) x;

  with d as (select distinct (created_at at time zone 'Asia/Kolkata')::date as day from public.attempts where user_id = v_uid),
       g as (select day, day - (row_number() over (order by day))::int as grp from d),
       isl as (select count(*) as n, max(day) as last_day from g group by grp)
  select coalesce(max(n) filter (where last_day >= (now() at time zone 'Asia/Kolkata')::date - 1), 0) into v_streak from isl;

  with per_user as (
    select user_id, max(round(100.0 * score / nullif(total * 2, 0), 1)) as best
    from public.attempts where unit is null and not late group by user_id)
  select (select count(*) + 1 from per_user o where o.best > m.best)::int, (select count(*) from per_user)::int
    into v_rank, v_players
  from per_user m where m.user_id = v_uid;

  select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb) into v_trend from (
    select unit, round(100.0 * score / nullif(total * 2, 0), 1) as pct, created_at
    from public.attempts where user_id = v_uid order by created_at desc limit 10) t;

  return jsonb_build_object(
    'attempts', v_attempts, 'avg_pct', v_avg, 'best_pct', v_best, 'streak', v_streak,
    'answered', v_answered, 'correct', v_correct,
    'units', v_units, 'trend', v_trend, 'rank', v_rank, 'players', v_players);
end $$;

-- ---------- Who may call what -----------------------------------------
revoke execute on function public.is_admin()                                   from public, anon;
revoke execute on function public.admin_stats()                                from public, anon;
revoke execute on function public.admin_list_questions(int, text, int, int)    from public, anon;
revoke execute on function public.admin_save_question(int, int, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.admin_delete_question(int)                   from public, anon;
revoke execute on function public.admin_import_questions(jsonb)                from public, anon;
revoke execute on function public.admin_rename_unit(int, text)                 from public, anon;
revoke execute on function public.admin_list_students()                        from public, anon;
revoke execute on function public.my_stats()                                   from public, anon;
grant  execute on function public.is_admin()                                   to authenticated;
grant  execute on function public.admin_stats()                                to authenticated;
grant  execute on function public.admin_list_questions(int, text, int, int)    to authenticated;
grant  execute on function public.admin_save_question(int, int, text, text, text, text, text, text, text) to authenticated;
grant  execute on function public.admin_delete_question(int)                   to authenticated;
grant  execute on function public.admin_import_questions(jsonb)                to authenticated;
grant  execute on function public.admin_rename_unit(int, text)                 to authenticated;
grant  execute on function public.admin_list_students()                        to authenticated;
grant  execute on function public.my_stats()                                   to authenticated;
