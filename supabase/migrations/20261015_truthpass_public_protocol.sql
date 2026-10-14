-- TruthPass v1.4.0 public protocol persistence.
-- Raw reports, nonce values and private keys are intentionally excluded.

create table if not exists public.truthpass_product_policies (
  policy_id text not null,
  policy_version text not null,
  policy_hash text not null,
  product_category text not null,
  status text not null check (status in ('active','draft','revoked')),
  policy jsonb not null,
  created_at timestamptz not null default now(),
  primary key (policy_id, policy_version)
);

create table if not exists public.truthpass_consumer_credentials (
  credential_id text primary key,
  subject_commitment text not null,
  scopes text[] not null,
  issued_at timestamptz not null,
  expires_at timestamptz,
  status text not null check (status in ('active','revoked','expired')),
  credential_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.truthpass_consumer_feedback (
  feedback_id text primary key,
  credential_id text not null references public.truthpass_consumer_credentials(credential_id),
  batch_id text not null,
  rating integer not null check (rating between 1 and 5),
  categories text[] not null default '{}',
  evidence_refs text[] not null default '{}',
  comment_hash text,
  created_at timestamptz not null,
  feedback_hash text not null,
  unique (credential_id, batch_id)
);

create table if not exists public.truthpass_session_chain_transactions (
  tx_id text primary key,
  action text not null,
  event_name text not null,
  wallet_address text not null,
  contract_address text not null,
  tx_hash text not null unique,
  batch_id text,
  block_number bigint,
  receipt_status text not null,
  event_verified boolean not null default false,
  explorer_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists truthpass_policy_status_idx
  on public.truthpass_product_policies (status, product_category);
create index if not exists truthpass_feedback_batch_idx
  on public.truthpass_consumer_feedback (batch_id, created_at desc);
create index if not exists truthpass_chain_tx_batch_idx
  on public.truthpass_session_chain_transactions (batch_id, created_at desc);

alter table public.truthpass_product_policies enable row level security;
alter table public.truthpass_consumer_credentials enable row level security;
alter table public.truthpass_consumer_feedback enable row level security;
alter table public.truthpass_session_chain_transactions enable row level security;

drop policy if exists truthpass_policy_public_read on public.truthpass_product_policies;
create policy truthpass_policy_public_read on public.truthpass_product_policies
  for select using (status = 'active');

drop policy if exists truthpass_feedback_public_read on public.truthpass_consumer_feedback;
create policy truthpass_feedback_public_read on public.truthpass_consumer_feedback
  for select using (true);

-- Credential and transaction writes are performed by the server-side service role.
-- No anon/authenticated insert policy is created for these tables.
