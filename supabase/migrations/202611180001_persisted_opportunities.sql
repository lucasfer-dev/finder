create table if not exists public.opportunities (
  source_id text not null,
  opportunity_id text not null,
  title text not null,
  source_name text not null,
  source_url text not null,
  official_url text not null,
  program_code text,
  agency text,
  executing_agency text,
  legal_nature text,
  proposal_start date,
  deadline date,
  deadline_state text not null check (deadline_state in ('open', 'not_started', 'expired', 'unknown')),
  deadline_status text not null check (deadline_status in ('confirmed', 'unconfirmed', 'unknown')),
  public_call_state text not null check (public_call_state in ('yes', 'no', 'unknown')),
  eligibility_status text not null default 'not_assessed' check (eligibility_status = 'not_assessed'),
  eligibility_criteria text,
  source_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_id, opportunity_id)
);

create index if not exists opportunities_deadline_idx on public.opportunities (deadline);

create table if not exists public.opportunity_history (
  id bigint generated always as identity primary key,
  source_id text not null,
  opportunity_id text not null,
  observed_at timestamptz not null default now(),
  snapshot jsonb not null,
  foreign key (source_id, opportunity_id) references public.opportunities(source_id, opportunity_id) on delete cascade
);
create index if not exists opportunity_history_lookup_idx on public.opportunity_history (source_id, opportunity_id, observed_at desc);

create table if not exists public.source_sync_state (
  source_id text primary key,
  cursor jsonb,
  status text not null default 'idle' check (status in ('idle', 'running', 'partial', 'complete', 'failed')),
  coverage jsonb not null default '{}'::jsonb,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.opportunities enable row level security;
alter table public.opportunity_history enable row level security;
alter table public.source_sync_state enable row level security;

-- Only the server-side Pages Functions use the service role. No browser-facing policies are created.
revoke all on public.opportunities, public.opportunity_history, public.source_sync_state from anon, authenticated;
grant all on public.opportunities, public.opportunity_history, public.source_sync_state to service_role;
grant usage, select on sequence public.opportunity_history_id_seq to service_role;


-- Scan reconciliation and single-writer lease. These functions are server-only RPCs.
alter table public.opportunities
  add column if not exists is_active boolean not null default true,
  add column if not exists inactive_reason text,
  add column if not exists last_seen_scan uuid,
  add column if not exists content_fingerprint text;
create index if not exists opportunities_active_deadline_idx on public.opportunities (is_active, deadline);

alter table public.source_sync_state
  add column if not exists scan_id uuid,
  add column if not exists lease_id uuid,
  add column if not exists lease_until timestamptz;

create or replace function public.radar_claim_sync(p_source_id text, p_lease_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare claimed public.source_sync_state%rowtype;
begin
  insert into public.source_sync_state(source_id, status)
  values (p_source_id, 'idle') on conflict do nothing;
  update public.source_sync_state
  set lease_id = p_lease_id,
      lease_until = now() + interval '10 minutes',
      scan_id = case when status in ('idle','complete') or scan_id is null
                     then gen_random_uuid() else scan_id end,
      cursor = case when status in ('idle','complete') then null else cursor end,
      coverage = case when status in ('idle','complete') then '{}'::jsonb else coverage end,
      status = 'running',
      last_started_at = now(),
      last_error = null,
      updated_at = now()
  where source_id = p_source_id
    and (status <> 'running' or lease_until < now() or lease_until is null)
  returning * into claimed;
  if not found then return null; end if;
  return jsonb_build_object('scanId', claimed.scan_id, 'cursor', claimed.cursor, 'coverage', claimed.coverage);
end $$;

-- A batch, its observation history, the cursor and final reconciliation commit atomically.
-- Only an owner holding the current unexpired lease can finish a batch.
create or replace function public.radar_commit_sync(
  p_source_id text, p_lease_id uuid, p_scan_id uuid, p_rows jsonb,
  p_cursor jsonb, p_coverage jsonb, p_complete boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  owner_state public.source_sync_state%rowtype;
  item jsonb;
  old_fingerprint text;
  old_active boolean;
  fingerprint text;
  visible boolean;
  reason text;
  affected record;
  changed_count integer := 0;
  withdrawn_count integer := 0;
begin
  select * into owner_state from public.source_sync_state
   where source_id = p_source_id for update;
  if not found or owner_state.lease_id is distinct from p_lease_id
       or owner_state.scan_id is distinct from p_scan_id
       or owner_state.status <> 'running' or owner_state.lease_until <= now()
  then raise exception 'Sync lease not owned or expired'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Rows must be an array';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if item->>'source_id' is distinct from p_source_id then
      raise exception 'Wrong source_id in batch';
    end if;
    fingerprint := md5(((item->'source_data') - 'discoveredAt')::text);
    visible := item->>'deadline_state' = 'open'
      and coalesce((item->'source_data'->>'sourceAvailable')::boolean, false);
    reason := case when visible then null else coalesce(item->>'deadline_state','unknown') end;
    select content_fingerprint, is_active into old_fingerprint, old_active
      from public.opportunities
      where source_id = p_source_id and opportunity_id = item->>'opportunity_id'
      for update;
    insert into public.opportunities (
      source_id, opportunity_id, title, source_name, source_url, official_url,
      program_code, agency, executing_agency, legal_nature, proposal_start, deadline,
      deadline_state, deadline_status, public_call_state, eligibility_status,
      eligibility_criteria, source_data, last_seen_at, updated_at,
      last_seen_scan, content_fingerprint, is_active, inactive_reason
    ) values (
      p_source_id, item->>'opportunity_id', item->>'title', item->>'source_name',
      item->>'source_url', item->>'official_url', item->>'program_code',
      item->>'agency', item->>'executing_agency', item->>'legal_nature',
      nullif(item->>'proposal_start','')::date, nullif(item->>'deadline','')::date,
      item->>'deadline_state', item->>'deadline_status', item->>'public_call_state',
      item->>'eligibility_status', item->>'eligibility_criteria',
      item->'source_data', now(), now(), p_scan_id, fingerprint, visible, reason
    ) on conflict (source_id, opportunity_id) do update set
      title = excluded.title, source_name = excluded.source_name,
      source_url = excluded.source_url, official_url = excluded.official_url,
      program_code = excluded.program_code, agency = excluded.agency,
      executing_agency = excluded.executing_agency, legal_nature = excluded.legal_nature,
      proposal_start = excluded.proposal_start, deadline = excluded.deadline,
      deadline_state = excluded.deadline_state, deadline_status = excluded.deadline_status,
      public_call_state = excluded.public_call_state,
      eligibility_status = excluded.eligibility_status,
      eligibility_criteria = excluded.eligibility_criteria,
      source_data = excluded.source_data, last_seen_at = now(),
      updated_at = case when public.opportunities.content_fingerprint is distinct from excluded.content_fingerprint
                         or public.opportunities.is_active is distinct from excluded.is_active
                         then now() else public.opportunities.updated_at end,
      last_seen_scan = p_scan_id, content_fingerprint = fingerprint,
      is_active = visible, inactive_reason = reason;
    if old_fingerprint is distinct from fingerprint or old_active is distinct from visible then
      insert into public.opportunity_history(source_id, opportunity_id, snapshot)
        values (p_source_id, item->>'opportunity_id',
                jsonb_build_object('event','source_changed','data',item->'source_data',
                                   'active',visible,'reason',reason,'scanId',p_scan_id));
      changed_count := changed_count + 1;
    end if;
  end loop;
  if p_complete then
    -- Never withdraw records based on a partial scan.
    for affected in
      update public.opportunities
        set is_active = false, inactive_reason = 'absent_after_complete_scan', updated_at = now()
        where source_id = p_source_id and is_active
          and last_seen_scan is distinct from p_scan_id
        returning opportunity_id
    loop
      insert into public.opportunity_history(source_id, opportunity_id, snapshot)
        values (p_source_id, affected.opportunity_id,
                jsonb_build_object('event','absent_after_complete_scan','scanId',p_scan_id));
      withdrawn_count := withdrawn_count + 1;
    end loop;
  end if;
  update public.source_sync_state set
    cursor = case when p_complete then null else p_cursor end,
    coverage = p_coverage,
    status = case when p_complete then 'complete' else 'partial' end,
    last_succeeded_at = now(), last_error = null, updated_at = now(),
    lease_id = null, lease_until = null
  where source_id = p_source_id;
  return jsonb_build_object('changed',changed_count,'withdrawn',withdrawn_count);
end $$;

create or replace function public.radar_fail_sync(p_source_id text, p_lease_id uuid, p_message text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.source_sync_state set status='failed',
    last_error=left(p_message,400), updated_at=now(), lease_id=null, lease_until=null
  where source_id=p_source_id and lease_id=p_lease_id and status='running';
  return found;
end $$;

revoke all on function public.radar_claim_sync(text,uuid) from public, anon, authenticated;
revoke all on function public.radar_commit_sync(text,uuid,uuid,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.radar_fail_sync(text,uuid,text) from public, anon, authenticated;
grant execute on function public.radar_claim_sync(text,uuid) to service_role;
grant execute on function public.radar_commit_sync(text,uuid,uuid,jsonb,jsonb,jsonb,boolean) to service_role;
grant execute on function public.radar_fail_sync(text,uuid,text) to service_role;
