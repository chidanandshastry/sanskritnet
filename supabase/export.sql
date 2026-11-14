-- =====================================================================
-- Download questions for correction and re-upload. Run AFTER batches.sql.
-- A downloaded file has an "id" column; when it is uploaded again, rows that
-- carry an id UPDATE that question in place (so students' history, saved
-- questions and reports stay attached). Rows without an id are added as new.
-- Safe to re-run.
-- =====================================================================

-- Pages of questions (up to 1000 per call) for the admin download.
-- p_unit / p_batch narrow it down; p_only_reported keeps only questions with an open report.
create or replace function public.admin_export_questions(
  p_unit int default null, p_batch uuid default null, p_only_reported boolean default false,
  p_offset int default 0, p_limit int default 1000)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.questions q
               where (p_unit is null or q.unit = p_unit) and (p_batch is null or q.batch_id = p_batch)
                 and (not coalesce(p_only_reported, false) or exists (select 1 from public.question_reports r where r.question_id = q.id and r.status = 'open'))),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.id) from (
        select q.id, q.unit, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct, coalesce(q.explanation, '') as explanation
        from public.questions q
        where (p_unit is null or q.unit = p_unit) and (p_batch is null or q.batch_id = p_batch)
          and (not coalesce(p_only_reported, false) or exists (select 1 from public.question_reports r where r.question_id = q.id and r.status = 'open'))
        order by q.id
        offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 1000), 1), 1000)) t), '[]'::jsonb));
end $$;

-- Import: a row with an id updates that question; a row without one adds a new question.
create or replace function public.admin_import_questions(p_rows jsonb, p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; ok int := 0; upd int := 0; errs jsonb := '[]'::jsonb;
        v_unit int; v_cor text; v_id int; v_n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Expected a list of questions'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Import at most 2000 questions at a time'; end if;
  if p_batch is not null and not exists (select 1 from public.import_batches where id = p_batch) then
    raise exception 'Unknown upload';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_id   := nullif(trim(coalesce(r->>'id', '')), '')::int;
      v_unit := nullif(trim(r->>'unit'), '')::int;
      v_cor  := upper(trim(coalesce(r->>'correct', '')));
      if v_unit is null or not exists (select 1 from public.units where id = v_unit) then raise exception 'unit must be 1-10'; end if;
      if coalesce(trim(r->>'question'), '') = '' then raise exception 'question is empty'; end if;
      if coalesce(trim(r->>'option_a'), '') = '' or coalesce(trim(r->>'option_b'), '') = ''
         or coalesce(trim(r->>'option_c'), '') = '' or coalesce(trim(r->>'option_d'), '') = '' then
        raise exception 'all four options are required';
      end if;
      if v_cor not in ('A','B','C','D') then raise exception 'correct must be A, B, C or D'; end if;

      if v_id is not null then
        update public.questions set unit = v_unit, question = trim(r->>'question'),
               option_a = trim(r->>'option_a'), option_b = trim(r->>'option_b'),
               option_c = trim(r->>'option_c'), option_d = trim(r->>'option_d'),
               correct = v_cor, explanation = nullif(trim(coalesce(r->>'explanation', '')), '')
         where id = v_id;
        get diagnostics v_n = row_count;
        if v_n = 0 then raise exception 'no question with id % (it may have been deleted); remove the id to add it as new', v_id; end if;
        upd := upd + 1;
      else
        insert into public.questions (unit, question, option_a, option_b, option_c, option_d, correct, explanation, batch_id)
        values (v_unit, trim(r->>'question'), trim(r->>'option_a'), trim(r->>'option_b'), trim(r->>'option_c'),
                trim(r->>'option_d'), v_cor, nullif(trim(coalesce(r->>'explanation', '')), ''), p_batch);
        ok := ok + 1;
      end if;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', ok, 'updated', upd, 'errors', errs);
end $$;

revoke execute on function public.admin_export_questions(int, uuid, boolean, int, int) from public, anon;
revoke execute on function public.admin_import_questions(jsonb, uuid)                   from public, anon;
grant  execute on function public.admin_export_questions(int, uuid, boolean, int, int) to authenticated;
grant  execute on function public.admin_import_questions(jsonb, uuid)                   to authenticated;
