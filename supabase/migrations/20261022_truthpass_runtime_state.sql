-- Runtime state required by the receipt, feedback and lifecycle endpoints.
-- The API also creates these tables lazily for installations that have not
-- applied migrations yet; keeping the migration here makes the schema
-- reviewable and allows RLS to be configured before production traffic.

create table if not exists public.consumer_consents (
  consumer_id text not null,
  batch_id text not null,
  scopes text[] not null default '{}',
  consent_hash text not null,
  granted_at timestamptz not null,
  primary key (consumer_id, batch_id)
);

create table if not exists public.consumer_purchases (
  purchase_id text primary key,
  consumer_id text not null,
  batch_id text not null,
  purchase_proof_hash text not null,
  created_at timestamptz not null,
  unique (batch_id, purchase_proof_hash)
);

create table if not exists public.consumer_feedbacks (
  feedback_id text primary key,
  purchase_id text not null references public.consumer_purchases(purchase_id),
  consumer_id text not null,
  batch_id text not null,
  rating integer not null check (rating between 1 and 5),
  categories text[] not null default '{}',
  evidence_hash text not null,
  created_at timestamptz not null,
  contribution_points integer not null default 0,
  data_mode text not null default 'demo/synthetic' check (data_mode in ('demo/synthetic', 'external')),
  unique (purchase_id)
);

alter table public.consumer_feedbacks
  add column if not exists data_mode text not null default 'demo/synthetic';

create index if not exists consumer_feedbacks_batch_idx
  on public.consumer_feedbacks (batch_id, created_at desc);

create table if not exists public.truthpass_feedback_drafts (
  prepare_id text primary key,
  batch_id text not null,
  purchase_id text not null,
  purchase_tx_hash text not null,
  wallet_address text,
  rating integer not null check (rating between 1 and 5),
  categories text[] not null default '{}',
  comment text not null default '',
  feedback_hash text not null,
  data_mode text not null check (data_mode in ('demo/synthetic', 'external')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed boolean not null default false
);

create index if not exists truthpass_feedback_drafts_expiry_idx
  on public.truthpass_feedback_drafts (expires_at);

create table if not exists public.truthpass_payment_orders (
  order_id text primary key,
  tenant_id text not null default 'demo',
  product_id text not null default '',
  batch_id text not null,
  provider text not null check (provider in ('alipay', 'paypal')),
  provider_order_id text,
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('quote_only', 'pending', 'paid', 'failed', 'refunded')) default 'quote_only',
  purchase_id text,
  tx_hash text,
  receipt_status text,
  raw_status jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists truthpass_payment_provider_order_idx
  on public.truthpass_payment_orders (provider, provider_order_id)
  where provider_order_id is not null;

create index if not exists truthpass_payment_orders_batch_idx
  on public.truthpass_payment_orders (batch_id, created_at desc);

create table if not exists public.truthpass_lifecycle_states (
  batch_id text primary key,
  revision integer not null,
  synced_at timestamptz not null,
  events jsonb not null default '[]'::jsonb,
  data_mode text not null default 'demo/synthetic',
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_sites (
  slug text primary key,
  tenant_id text not null unique,
  site_status text not null check (site_status in ('draft','preview','published','archived')),
  template_version text not null,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_site_revisions (
  revision_id text primary key,
  slug text not null references public.tenant_sites(slug) on delete cascade,
  status text not null check (status in ('draft','preview','published','archived')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_site_revisions_slug_idx
  on public.tenant_site_revisions (slug, created_at desc);

create table if not exists public.tenant_site_assets (
  asset_id text primary key,
  slug text not null references public.tenant_sites(slug) on delete cascade,
  object_ref text not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_site_members (
  slug text not null references public.tenant_sites(slug) on delete cascade,
  user_id uuid not null,
  member_role text not null,
  created_at timestamptz not null default now(),
  primary key (slug, user_id)
);

create table if not exists public.tenant_site_domains (
  domain text primary key,
  slug text not null references public.tenant_sites(slug) on delete cascade,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Event identifiers (purchaseId, contributionId, evidenceRoot, etc.) are
-- needed to bind a feedback request to the exact verified receipt. They are
-- hashes or public IDs only; no private wallet material is stored here.
alter table public.truthpass_session_chain_transactions
  add column if not exists ids jsonb not null default '{}'::jsonb;

alter table public.consumer_consents enable row level security;
alter table public.consumer_purchases enable row level security;
alter table public.consumer_feedbacks enable row level security;
alter table public.truthpass_lifecycle_states enable row level security;
alter table public.truthpass_feedback_drafts enable row level security;
alter table public.truthpass_payment_orders enable row level security;
alter table public.tenant_sites enable row level security;
alter table public.tenant_site_revisions enable row level security;
alter table public.tenant_site_assets enable row level security;
alter table public.tenant_site_members enable row level security;
alter table public.tenant_site_domains enable row level security;

-- The server writes private purchase and feedback records with its service
-- connection. Public clients receive only batch-scoped aggregates.
drop policy if exists truthpass_consents_public_read on public.consumer_consents;
drop policy if exists truthpass_purchases_public_read on public.consumer_purchases;
drop policy if exists truthpass_feedbacks_public_read on public.consumer_feedbacks;
drop policy if exists truthpass_lifecycle_public_read on public.truthpass_lifecycle_states;
drop policy if exists truthpass_feedback_drafts_public_read on public.truthpass_feedback_drafts;
drop policy if exists truthpass_payment_orders_public_read on public.truthpass_payment_orders;
drop policy if exists tenant_sites_public_read on public.tenant_sites;
drop policy if exists tenant_site_revisions_public_read on public.tenant_site_revisions;
drop policy if exists tenant_site_assets_public_read on public.tenant_site_assets;
drop policy if exists tenant_site_members_public_read on public.tenant_site_members;
drop policy if exists tenant_site_domains_public_read on public.tenant_site_domains;
