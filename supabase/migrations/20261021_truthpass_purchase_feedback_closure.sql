-- Shared persistence for purchase verification, provider status and production improvements.
create table if not exists public.truthpass_payment_orders (
  order_id text primary key,
  batch_id text not null,
  provider text not null check (provider in ('alipay','paypal')),
  provider_order_id text,
  amount numeric(18,2) not null,
  currency text not null,
  status text not null check (status in ('quote_only','pending','paid','failed','refunded')) default 'quote_only',
  purchase_id text,
  tx_hash text,
  raw_status jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.truthpass_production_improvement_reports (
  report_id text primary key,
  batch_id text not null,
  data_mode text not null,
  evidence_root text,
  findings jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists truthpass_payment_orders_batch_idx on public.truthpass_payment_orders(batch_id, created_at desc);
create index if not exists truthpass_improvement_reports_batch_idx on public.truthpass_production_improvement_reports(batch_id, created_at desc);

alter table public.truthpass_payment_orders enable row level security;
alter table public.truthpass_production_improvement_reports enable row level security;
drop policy if exists truthpass_payment_orders_public_read on public.truthpass_payment_orders;
create policy truthpass_payment_orders_public_read on public.truthpass_payment_orders for select using (true);
drop policy if exists truthpass_improvement_reports_public_read on public.truthpass_production_improvement_reports;
create policy truthpass_improvement_reports_public_read on public.truthpass_production_improvement_reports for select using (true);
