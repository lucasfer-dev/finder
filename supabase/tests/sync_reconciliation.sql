-- Manual regression suite for a Supabase development database.
-- Run AFTER the 0001 and 0002 migrations; all test writes are rolled back.
begin;
do $test$
declare
  source_key text := 'radar-integration-test';
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  lease jsonb;
  lease2 jsonb;
  result jsonb;
  row_data jsonb;
  history_before integer;
begin
  insert into public.opportunities(
    source_id, opportunity_id, title, source_name, source_url, official_url,
    deadline_state, deadline_status, public_call_state, eligibility_status, source_data,
    deadline, is_active
  ) values (
    source_key, 'test:1', 'Original', 'Transferegov', 'https://example.com',
    'https://example.com/item', 'open', 'confirmed', 'no', 'not_assessed',
    '{"title":"Original"}'::jsonb, current_date + 30, true
  );
  lease := public.acquire_source_sync(source_key, owner_a, 600);
  if lease is null then raise exception 'Failed to acquire initial lease'; end if;
  if public.acquire_source_sync(source_key, owner_b, 600) is not null then
    raise exception 'Two simultaneous owners acquired one lease';
  end if;

  -- Partial scan missing a program MUST NOT deactivate that program.
  result := public.commit_source_sync_batch(source_key, owner_a, '[]'::jsonb,
    '{"baseYear":2026,"yearIndex":1,"natureIndex":0,"page":1,"totalPages":null}'::jsonb,
    '{"pagesRead":4}'::jsonb, false);
  if not (select is_active from public.opportunities where source_id=source_key and opportunity_id='test:1') then
    raise exception 'Partial scan incorrectly deactivated a program';
  end if;

  lease2 := public.acquire_source_sync(source_key, owner_b, 600);
  if lease2 is null or lease->>'scanId' is distinct from lease2->>'scanId' then
    raise exception 'Resume did not preserve scan identifier';
  end if;
  -- A full scan missing the program MUST deactivate it and record the reason.
  result := public.commit_source_sync_batch(source_key, owner_b, '[]'::jsonb,
    null, '{"pagesRead":12}'::jsonb, true);
  if (select is_active from public.opportunities where source_id=source_key and opportunity_id='test:1') then
    raise exception 'Completed scan failed to deactivate missing program';
  end if;
  if (select inactive_reason from public.opportunities where source_id=source_key and opportunity_id='test:1')
    <> 'not_seen_in_complete_scan' then
    raise exception 'Missing deactivation reason';
  end if;
  if not exists (
    select 1 from public.opportunity_history where source_id=source_key
      and opportunity_id='test:1' and snapshot->>'event'='deactivated'
  ) then raise exception 'Deactivation was not audited'; end if;

  -- Reappearance restores visibility and writes a transition event.
  owner_a := gen_random_uuid();
  lease := public.acquire_source_sync(source_key, owner_a, 600);
  row_data := jsonb_build_array(jsonb_build_object(
    'opportunity_id','test:1','title','Restored','source_name','Transferegov',
    'source_url','https://example.com','official_url','https://example.com/item',
    'deadline_state','open','deadline_status','confirmed','public_call_state','no',
    'eligibility_status','not_assessed', 'is_active',true,
    'source_data',jsonb_build_object('title','Restored','deadlineState','open')
  ));
  result := public.commit_source_sync_batch(source_key, owner_a, row_data, null,
    '{"pagesRead":12}'::jsonb, true);
  if not (select is_active from public.opportunities where source_id=source_key and opportunity_id='test:1') then
    raise exception 'Reappearance failed to restore program';
  end if;
  if not exists (
    select 1 from public.opportunity_history where source_id=source_key
      and opportunity_id='test:1' and snapshot->>'event'='reactivated'
  ) then raise exception 'Reactivation was not audited'; end if;

  select count(*) into history_before from public.opportunity_history
    where source_id=source_key and opportunity_id='test:1';
  owner_b := gen_random_uuid();
  lease := public.acquire_source_sync(source_key, owner_b, 600);
  result := public.commit_source_sync_batch(source_key, owner_b, row_data, null,
    '{"pagesRead":12}'::jsonb, true);
  if (select count(*) from public.opportunity_history
      where source_id=source_key and opportunity_id='test:1') <> history_before then
    raise exception 'Unchanged snapshot was redundantly logged';
  end if;
end $test$;
rollback;
