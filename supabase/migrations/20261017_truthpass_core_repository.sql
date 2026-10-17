-- TruthPass core repository tables used by the production API reader.
-- Demo rows are explicitly marked demo/synthetic and remain replaceable by tenant imports.

create table if not exists public.products (
  product_id text primary key,
  name text not null,
  category text not null,
  supplier_id text not null,
  claims text[] not null default '{}',
  data_mode text not null check (data_mode in ('demo/synthetic', 'external'))
);

create table if not exists public.batches (
  batch_id text primary key,
  product_id text not null references public.products(product_id),
  supplier_id text not null,
  production_at timestamptz not null,
  filling_batch_id text not null,
  data_mode text not null check (data_mode in ('demo/synthetic', 'external'))
);

create table if not exists public.evidence (
  evidence_id text primary key,
  batch_id text not null references public.batches(batch_id),
  kind text not null,
  issuer_id text not null,
  source_kind text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  data_mode text not null check (data_mode in ('demo/synthetic', 'external')),
  attestation jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'revoked')),
  created_at timestamptz not null default now()
);

create index if not exists evidence_batch_idx on public.evidence (batch_id, created_at, evidence_id);

create table if not exists public.execution_evidence (
  id bigserial primary key,
  service_id text not null,
  task_id text not null,
  batch_id text not null,
  report_batch_id text not null,
  production_time timestamptz not null,
  report_time timestamptz not null,
  logistics_gap_hours double precision not null,
  signature_valid boolean not null,
  epa_dha_percent double precision,
  peroxide_value double precision,
  totox double precision,
  cold_chain_gap_hours double precision,
  payload jsonb not null default '{}'::jsonb,
  unique (task_id, service_id, report_time)
);

insert into public.products (product_id, name, category, supplier_id, claims, data_mode)
values ('fish-oil-demo-001', '高浓度鱼油软胶囊', 'fish-oil', 'supplier-demo-001', array['高浓度 EPA+DHA', '冷链交付'], 'demo/synthetic')
on conflict (product_id) do nothing;

insert into public.batches (batch_id, product_id, supplier_id, production_at, filling_batch_id, data_mode)
values ('FO-2026-001', 'fish-oil-demo-001', 'supplier-demo-001', '2026-10-06T08:00:00Z', 'FILL-2026-001', 'demo/synthetic')
on conflict (batch_id) do nothing;

insert into public.evidence (evidence_id, batch_id, kind, issuer_id, source_kind, occurred_at, payload, data_mode, created_at)
values
  ('ev-production-001', 'FO-2026-001', 'production', 'supplier-demo-001', 'manufacturer', '2026-10-06T08:00:00Z', '{"schemaVersion":"production.event.v1","stage":"raw_material_receipt","sequence":1,"startedAt":"2026-10-06T08:00:00Z","endedAt":"2026-10-06T08:30:00Z","inputs":[{"lotId":"FO-2026-001","quantity":100,"unit":"kg"}],"outputs":[{"lotId":"RAW-2026-001","quantity":98,"unit":"kg"}],"observations":[{"code":"temperature","value":4.5,"unit":"C"}],"deviations":[],"sourceEvidenceIds":[],"traceability":{"originRegion":"北太平洋海域"}}'::jsonb, 'demo/synthetic', '2026-10-06T08:00:00Z'),
  ('ev-inspection-001', 'FO-2026-001', 'inspection', 'lab-demo-001', 'third_party', '2026-10-06T10:20:00Z', '{"epaDhaPercent":78,"peroxideValue":2.1,"totox":11,"reportMode":"demo/synthetic"}'::jsonb, 'demo/synthetic', '2026-10-06T10:20:00Z'),
  ('ev-cold-chain-001', 'FO-2026-001', 'cold_chain', 'cold-chain-demo-001', 'platform_device', '2026-10-06T11:00:00Z', '{"maxGapHours":2,"sensorMode":"demo/synthetic"}'::jsonb, 'demo/synthetic', '2026-10-06T11:00:00Z'),
  ('ev-production-002', 'FO-2026-001', 'production', 'supplier-demo-001', 'manufacturer', '2026-10-06T09:00:00Z', '{"schemaVersion":"production.event.v1","stage":"refining","sequence":1,"startedAt":"2026-10-06T09:00:00Z","endedAt":"2026-10-06T10:00:00Z","inputs":[{"lotId":"RAW-2026-001","quantity":98,"unit":"kg"}],"outputs":[{"lotId":"REFINED-2026-001","quantity":90,"unit":"kg"}],"observations":[{"code":"yield","value":91.8,"unit":"%"}],"deviations":[],"sourceEvidenceIds":["ev-production-001"]}'::jsonb, 'demo/synthetic', '2026-10-06T12:00:00Z')
on conflict (evidence_id) do nothing;
