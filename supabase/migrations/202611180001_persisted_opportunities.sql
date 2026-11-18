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
