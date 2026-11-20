-- Enterprise batch publication gate.
-- Only a fully verified external batch can be published for consumer access.

create table if not exists truthpass_enterprise_batch_publications (
  publication_id text primary key,
  tenant_id text not null,
  brand_id text not null,
  product_id text not null,
  batch_id text not null,
  status text not null default 'published' check (status = 'published'),
  data_mode text not null check (data_mode = 'external'),
  evidence_root text not null,
  payload jsonb not null,
  published_at timestamptz not null,
  unique (tenant_id, batch_id, evidence_root)
);

create index if not exists truthpass_enterprise_batch_publications_scope_idx
  on truthpass_enterprise_batch_publications (tenant_id, batch_id, published_at desc);

alter table truthpass_enterprise_batch_publications enable row level security;
