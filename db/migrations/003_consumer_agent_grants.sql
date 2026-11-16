create table if not exists public.truthpass_consumer_agent_grants (
  grant_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  label text not null,
  scopes jsonb not null default '[]'::jsonb,
  batch_ids jsonb not null default '[]'::jsonb,
  product_ids jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  data_class text not null default 'personal',
  constraint truthpass_consumer_agent_grants_data_class check (data_class = 'personal')
);

create index if not exists truthpass_consumer_agent_grants_user_idx
  on public.truthpass_consumer_agent_grants(user_id, created_at desc);

alter table public.truthpass_consumer_agent_grants enable row level security;

drop policy if exists truthpass_consumer_agent_grants_owner_select on public.truthpass_consumer_agent_grants;
create policy truthpass_consumer_agent_grants_owner_select
  on public.truthpass_consumer_agent_grants
  for select using (auth.uid() = user_id);

drop policy if exists truthpass_consumer_agent_grants_owner_update on public.truthpass_consumer_agent_grants;
create policy truthpass_consumer_agent_grants_owner_update
  on public.truthpass_consumer_agent_grants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
