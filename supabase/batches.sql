-- =====================================================================
-- Upload batches: every CSV import is remembered, so an admin can delete a
-- whole upload (or every question in a unit) in one step.
-- Run AFTER admin.sql. Safe to re-run.
-- =====================================================================

create table if not exists public.import_batches (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.import_batches enable row level security;   -- no policies: only the admin functions below can touch it

alter table public.questions add column if not exists batch_id uuid references public.import_batches(id) on delete set null;
create index if not exists questions_batch_idx on public.questions (batch_id);

create or replace function public.admin_create_batch(p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  insert into public.import_batches (label, created_by)
  values (left(coalesce(nullif(trim(p_label), ''), 'Upload'), 120), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Same as before, plus an optional batch the new questions are filed under.
drop function if exists public.admin_import_questions(jsonb);
create or replace function public.admin_import_questions(p_rows jsonb, p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; ok int := 0; errs jsonb := '[]'::jsonb; v_unit int; v_cor text;
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
      v_unit := nullif(trim(r->>'unit'), '')::int;
      v_cor  := upper(trim(coalesce(r->>'correct', '')));
      if v_unit is null or not exists (select 1 from public.units where id = v_unit) then raise exception 'unit must be 1-10'; end if;
      if coalesce(trim(r->>'question'), '') = '' then raise exception 'question is empty'; end if;
      if coalesce(trim(r->>'option_a'), '') = '' or coalesce(trim(r->>'option_b'), '') = ''
         or coalesce(trim(r->>'option_c'), '') = '' or coalesce(trim(r->>'option_d'), '') = '' then
        raise exception 'all four options are required';
      end if;
      if v_cor not in ('A','B','C','D') then raise exception 'correct must be A, B, C or D'; end if;
      insert into public.questions (unit, question, option_a, option_b, option_c, option_d, correct, explanation, batch_id)
      values (v_unit, trim(r->>'question'), trim(r->>'option_a'), trim(r->>'option_b'), trim(r->>'option_c'),
              trim(r->>'option_d'), v_cor, nullif(trim(coalesce(r->>'explanation', '')), ''), p_batch);
      ok := ok + 1;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('inserted', ok, 'errors', errs);
end $$;

-- Uploads, newest first, each with its question count and per-unit split.
-- Questions that belong to no upload (added by hand or imported earlier) come back as one row with id = null.
create or replace function public.admin_list_batches()
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc nulls last) from (
      select jsonb_build_object(
               'id', b.id, 'label', b.label, 'created_at', b.created_at,
               'n', coalesce(s.n, 0), 'units', coalesce(s.units, '[]'::jsonb)) as x
      from public.import_batches b
      left join (
        select batch_id, sum(c)::int as n, jsonb_agg(jsonb_build_object('unit', unit, 'n', c) order by unit) as units
        from (select batch_id, unit, count(*) as c from public.questions where batch_id is not null group by 1, 2) g
        group by batch_id) s on s.batch_id = b.id
      union all
      select jsonb_build_object('id', null, 'label', 'Earlier uploads and questions added by hand', 'created_at', null,
               'n', s2.n, 'units', s2.units)
      from (
        select sum(c)::int as n, jsonb_agg(jsonb_build_object('unit', unit, 'n', c) order by unit) as units
        from (select unit, count(*) as c from public.questions where batch_id is null group by 1) g2) s2
      where s2.n > 0
    ) t), '[]'::jsonb);
end $$;

-- Delete one upload and every question that came with it.
create or replace function public.admin_delete_batch(p_batch uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.questions where batch_id = p_batch;
  get diagnostics v_n = row_count;
  delete from public.import_batches where id = p_batch;
  return v_n;
end $$;

-- Delete every question in a unit (optionally only those not filed under any upload).
create or replace function public.admin_delete_unit_questions(p_unit int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_unit is null then raise exception 'Choose a unit'; end if;
  delete from public.questions where unit = p_unit;
  get diagnostics v_n = row_count;
  delete from public.import_batches b where not exists (select 1 from public.questions q where q.batch_id = b.id);
  return v_n;
end $$;

revoke execute on function public.admin_create_batch(text)             from public, anon;
revoke execute on function public.admin_import_questions(jsonb, uuid)  from public, anon;
revoke execute on function public.admin_list_batches()                 from public, anon;
revoke execute on function public.admin_delete_batch(uuid)             from public, anon;
revoke execute on function public.admin_delete_unit_questions(int)     from public, anon;
grant  execute on function public.admin_create_batch(text)             to authenticated;
grant  execute on function public.admin_import_questions(jsonb, uuid)  to authenticated;
grant  execute on function public.admin_list_batches()                 to authenticated;
grant  execute on function public.admin_delete_batch(uuid)             to authenticated;
grant  execute on function public.admin_delete_unit_questions(int)     to authenticated;
