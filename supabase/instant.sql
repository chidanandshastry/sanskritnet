-- =====================================================================
-- Instant feedback: the student sees the right answer as soon as they choose.
-- Run AFTER features.sql (and the others). Safe to re-run.
-- The first choice for a question is LOCKED on the server, so revealing an answer
-- cannot be used to change it. Marking at submit uses the locked choices.
-- =====================================================================

create table if not exists public.session_answers (
  session_id  uuid not null references public.test_sessions(id) on delete cascade,
  question_id int  not null,
  choice      text not null check (choice in ('A','B','C','D')),
  primary key (session_id, question_id)
);
alter table public.session_answers enable row level security;   -- no policies: only check_answer / submit_attempt use it

create or replace function public.check_answer(p_session uuid, p_question int, p_choice text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.test_sessions%rowtype; v_choice text := upper(trim(coalesce(p_choice, ''))); v_locked text; q public.questions%rowtype;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if v_choice not in ('A','B','C','D') then raise exception 'Choose A, B, C or D'; end if;

  select * into s from public.test_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'Test session not found'; end if;
  if s.submitted then raise exception 'This test was already submitted'; end if;
  if not (p_question = any(s.question_ids)) then raise exception 'That question is not part of this test'; end if;

  insert into public.session_answers (session_id, question_id, choice) values (p_session, p_question, v_choice)
  on conflict do nothing;
  select choice into v_locked from public.session_answers where session_id = p_session and question_id = p_question;

  select * into q from public.questions where id = p_question;
  return jsonb_build_object('choice', v_locked, 'correct', v_locked = q.correct, 'right', q.correct, 'explanation', q.explanation);
end $$;

-- Marking: locked choices win over whatever the browser sends.
create or replace function public.submit_attempt(p_session uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.test_sessions%rowtype;
  v_ans jsonb := coalesce(p_answers, '{}'::jsonb);
  v_total int; v_correct int; v_answered int; v_dur int; v_late boolean; v_aid bigint;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if jsonb_typeof(v_ans) <> 'object' or pg_column_size(v_ans) > 20000 then raise exception 'Invalid answers'; end if;

  select * into s from public.test_sessions where id = p_session and user_id = auth.uid() for update;
  if not found then raise exception 'Test session not found'; end if;
  if s.submitted then raise exception 'This test was already submitted'; end if;

  v_ans := v_ans || coalesce((select jsonb_object_agg(a.question_id::text, a.choice)
                                from public.session_answers a where a.session_id = s.id), '{}'::jsonb);

  v_total := array_length(s.question_ids, 1);
  select count(*) filter (where v_ans->>(q.id::text) = q.correct),
         count(*) filter (where v_ans->>(q.id::text) in ('A','B','C','D'))
    into v_correct, v_answered
    from public.questions q where q.id = any(s.question_ids);

  v_dur  := extract(epoch from (now() - s.started_at))::int;
  v_late := v_dur > v_total * 72 + 120;

  update public.test_sessions set submitted = true where id = s.id;
  insert into public.attempts
    (user_id, session_id, unit, kind, total, correct, wrong, unattempted, score, answers, question_ids, duration_sec, late)
  values
    (auth.uid(), s.id, s.unit, s.kind, v_total, v_correct, v_answered - v_correct,
     v_total - v_answered, v_correct * 2, v_ans, s.question_ids, v_dur, v_late)
  returning id into v_aid;
  return public.get_attempt_review(v_aid);
end $$;

revoke execute on function public.check_answer(uuid, int, text)  from public, anon;
revoke execute on function public.submit_attempt(uuid, jsonb)    from public, anon;
grant  execute on function public.check_answer(uuid, int, text)  to authenticated;
grant  execute on function public.submit_attempt(uuid, jsonb)    to authenticated;
