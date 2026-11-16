-- TruthPass expert Agent core.
-- Raw documents and private consumer data stay off-chain. These tables keep
-- versioned knowledge, pseudonymous needs, interaction audit and merchant
-- proposals. API service-role access is still guarded by tenant checks.

create table if not exists truthpass_knowledge_packs (
  pack_id text primary key,
  tenant_id text,
  scope text not null check (scope in ('public', 'tenant_private')),
  domain text not null,
  version text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists truthpass_knowledge_packs_scope_idx
  on truthpass_knowledge_packs (scope, tenant_id, domain, version);

create table if not exists truthpass_consumer_needs (
  need_id text primary key,
  tenant_id text,
  product_id text,
  batch_id text,
  anonymous_consumer_id text not null,
  consent_scope text not null check (consent_scope in ('none', 'personal_use', 'anonymous_research', 'industry_insight')),
  payload jsonb not null,
  created_at timestamptz not null
);

create index if not exists truthpass_consumer_needs_scope_idx
  on truthpass_consumer_needs (tenant_id, product_id, batch_id, consent_scope, created_at desc);

create table if not exists truthpass_interaction_events (
  event_id text primary key,
  tenant_id text,
  trace_id text not null,
  payload jsonb not null,
  created_at timestamptz not null
);

create index if not exists truthpass_interaction_events_trace_idx
  on truthpass_interaction_events (trace_id, created_at desc);

create table if not exists truthpass_product_specs (
  spec_id text primary key,
  tenant_id text not null,
  payload jsonb not null,
  created_at timestamptz not null
);

create table if not exists truthpass_brand_proposals (
  proposal_id text primary key,
  tenant_id text not null,
  payload jsonb not null,
  created_at timestamptz not null
);

-- Direct browser access is denied by default. The API service role performs
-- tenant checks before reading or writing these records.
alter table truthpass_knowledge_packs enable row level security;
alter table truthpass_consumer_needs enable row level security;
alter table truthpass_interaction_events enable row level security;
alter table truthpass_product_specs enable row level security;
alter table truthpass_brand_proposals enable row level security;
