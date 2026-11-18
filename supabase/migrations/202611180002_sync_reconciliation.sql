-- PR #2 follow-up: fenced scan lease and transactional reconciliation.
alter table public.opportunities
  add column if not exists is_active boolean not null default true,
  add column if not exists inactive_reason text,
  add column if not exists last_seen_scan_id uuid;
alter table public.source_sync_state
  add column if not exists scan_id uuid,
  add column if not exists lease_owner uuid,
  add column if not exists lease_expires_at timestamptz;

create index if not exists opportunities_active_deadline_idx on public.opportunities (is_active, deadline);

create or replace function public.acquire_source_sync(
  p_source_id text, p_lease_owner uuid, p_lease_seconds integer default 600
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.source_sync_state%rowtype;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'Invalid lease duration';
  end if;
  insert into public.source_sync_state(source_id) values (p_source_id)
    on conflict (source_id) do nothing;
  select * into s from public.source_sync_state where source_id = p_source_id for update;
  if s.lease_expires_at is not null and s.lease_expires_at > now() then
    return null;
  end if;
  if s.cursor is null then
    s.scan_id := gen_random_uuid();
    s.coverage := '{}'::jsonb;
  elsif s.scan_id is null then
    s.scan_id := gen_random_uuid();
  end if;
  update public.source_sync_state set
    status = 'running', scan_id = s.scan_id, coverage = s.coverage,
    lease_owner = p_lease_owner, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    last_started_at = now(), last_error = null, updated_at = now()
  where source_id = p_source_id;
  return jsonb_build_object('scanId', s.scan_id, 'cursor', s.cursor, 'coverage', s.coverage);
end $$;

create or replace function public.commit_source_sync_batch(
  p_source_id text, p_lease_owner uuid, p_rows jsonb,
  p_cursor jsonb, p_coverage jsonb, p_complete boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s public.source_sync_state%rowtype;
  r jsonb;
  previous jsonb;
  previous_active boolean;
  active_now boolean;
  reason text;
  canonical jsonb;
  key_id text;
  changes integer := 0;
  deactivated integer := 0;
begin
  select * into s from public.source_sync_state where source_id = p_source_id for update;
  if not found or s.lease_owner is distinct from p_lease_owner
    or s.lease_expires_at is null or s.lease_expires_at <= now() then
    raise exception 'Sync lease lost';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    key_id := r->>'opportunity_id';
    if key_id is null then raise exception 'Missing opportunity_id'; end if;
    canonical := (r->'source_data') - 'discoveredAt';
    active_now := coalesce((r->>'is_active')::boolean, false);
    reason := r->>'inactive_reason';
    select o.source_data, o.is_active into previous, previous_active
      from public.opportunities o
      where o.source_id = p_source_id and o.opportunity_id = key_id;
    insert into public.opportunities (
      source_id, opportunity_id, title, source_name, source_url, official_url,
      program_code, agency, executing_agency, legal_nature, proposal_start, deadline,
      deadline_state, deadline_status, public_call_state, eligibility_status,
      eligibility_criteria, source_data, last_seen_at, updated_at, last_seen_scan_id,
      is_active, inactive_reason
    ) values (
      p_source_id, key_id, r->>'title', r->>'source_name', r->>'source_url', r->>'official_url',
      r->>'program_code', r->>'agency', r->>'executing_agency', r->>'legal_nature',
      (r->>'proposal_start')::date, (r->>'deadline')::date,
      r->>'deadline_state', r->>'deadline_status', r->>'public_call_state',
      r->>'eligibility_status', r->>'eligibility_criteria', canonical,
      now(), now(), s.scan_id, active_now, reason
    ) on conflict (source_id, opportunity_id) do update set
      title=excluded.title, source_name=excluded.source_name, source_url=excluded.source_url,
      official_url=excluded.official_url, program_code=excluded.program_code,
      agency=excluded.agency, executing_agency=excluded.executing_agency,
      legal_nature=excluded.legal_nature, proposal_start=excluded.proposal_start,
      deadline=excluded.deadline, deadline_state=excluded.deadline_state,
      deadline_status=excluded.deadline_status, public_call_state=excluded.public_call_state,
      eligibility_status=excluded.eligibility_status,
      eligibility_criteria=excluded.eligibility_criteria, source_data=excluded.source_data,
      last_seen_at=now(), last_seen_scan_id=s.scan_id, updated_at=now(),
      is_active=excluded.is_active, inactive_reason=excluded.inactive_reason;
    if previous is null or previous is distinct from canonical or previous_active is distinct from active_now then
      insert into public.opportunity_history(source_id, opportunity_id, observed_at, snapshot)
        values (p_source_id, key_id, now(), jsonb_build_object(
          'event', case when previous is null then 'discovered'
            when previous_active = false and active_now then 'reactivated'
            when previous_active = true and not active_now then 'deactivated'
            else 'changed' end,
          'reason', reason, 'data', canonical));
      changes := changes + 1;
    end if;
  end loop;
  if p_complete then
    with removed as (
      update public.opportunities o set is_active = false,
        inactive_reason = 'not_seen_in_complete_scan', updated_at = now()
      where o.source_id = p_source_id and o.is_active
        and o.last_seen_scan_id is distinct from s.scan_id
      returning o.opportunity_id, o.source_data
    ), logged as (
      insert into public.opportunity_history(source_id, opportunity_id, observed_at, snapshot)
      select p_source_id, opportunity_id, now(),
        jsonb_build_object('event','deactivated','reason','not_seen_in_complete_scan','data',source_data)
      from removed returning 1
    )
    select count(*) into deactivated from logged;
  end if;
  update public.source_sync_state set status = case when p_complete then 'complete' else 'partial' end,
    cursor = p_cursor, coverage = p_coverage,
    lease_owner = null, lease_expires_at = null,
    last_succeeded_at = now(), last_error = null, updated_at = now()
  where source_id = p_source_id;
  return jsonb_build_object('changed',changes,'deactivated',deactivated,'scanId',s.scan_id);
end $$;

create or replace function public.fail_source_sync(
  p_source_id text, p_lease_owner uuid, p_error text
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.source_sync_state set status='failed', last_error=left(p_error, 500),
    lease_owner=null, lease_expires_at=null, updated_at=now()
  where source_id=p_source_id and lease_owner=p_lease_owner;
  return found;
end $$;

revoke all on function public.acquire_source_sync(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.commit_source_sync_batch(text,uuid,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.fail_source_sync(text,uuid,text) from public, anon, authenticated;
grant execute on function public.acquire_source_sync(text,uuid,integer) to service_role;
grant execute on function public.commit_source_sync_batch(text,uuid,jsonb,jsonb,jsonb,boolean) to service_role;
grant execute on function public.fail_source_sync(text,uuid,text) to service_role;

-- Compatibility API: the deployed Pages Function uses radar_* RPC names.
-- Delegate to the same fenced transactional implementation above.
create or replace function public.radar_claim_sync(
  p_source_id text, p_lease_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select public.acquire_source_sync(p_source_id, p_lease_id, 600);
$$;

create or replace function public.radar_commit_sync(
  p_source_id text, p_lease_id uuid, p_scan_id uuid, p_rows jsonb,
  p_cursor jsonb, p_coverage jsonb, p_complete boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_scan uuid;
begin
  select scan_id into current_scan from public.source_sync_state
    where source_id=p_source_id and lease_owner=p_lease_id;
  if current_scan is distinct from p_scan_id then
    raise exception 'Scan identifier mismatch';
  end if;
  return public.commit_source_sync_batch(
    p_source_id,p_lease_id,p_rows,p_cursor,p_coverage,p_complete);
end $$;

create or replace function public.radar_fail_sync(
  p_source_id text, p_lease_id uuid, p_message text
) returns boolean language sql security invoker set search_path = '' as $$
  select public.fail_source_sync(p_source_id,p_lease_id,p_message);
$$;

revoke all on function public.radar_claim_sync(text,uuid) from public, anon, authenticated;
revoke all on function public.radar_commit_sync(text,uuid,uuid,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.radar_fail_sync(text,uuid,text) from public, anon, authenticated;
grant execute on function public.radar_claim_sync(text,uuid) to service_role;
grant execute on function public.radar_commit_sync(text,uuid,uuid,jsonb,jsonb,jsonb,boolean) to service_role;
grant execute on function public.radar_fail_sync(text,uuid,text) to service_role;
