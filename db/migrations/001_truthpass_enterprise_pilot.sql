-- TruthPass enterprise pilot storage.
-- Raw reports stay in object storage; these tables keep metadata, hashes,
-- verification state and an append-only audit trail.

create table if not exists truthpass_enterprise_evidence (
  tenant_id text not null,
  brand_id text not null,
  product_id text not null,
  batch_id text not null,
  sample_id text,
  evidence_id text not null,
  kind text not null,
  issuer_id text not null,
  source_kind text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  data_mode text not null check (data_mode in ('demo/synthetic', 'external')),
  attestation jsonb,
  raw_object_ref text,
  payload_hash text not null,
  status text not null default 'submitted' check (status in ('submitted', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, evidence_id)
);

create index if not exists truthpass_enterprise_evidence_batch_idx
  on truthpass_enterprise_evidence (tenant_id, batch_id, created_at);

create table if not exists truthpass_enterprise_audit_events (
  event_id text primary key,
  tenant_id text not null,
  request_id text not null,
  event_type text not null,
  evidence_id text,
  batch_id text,
  payload_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists truthpass_enterprise_audit_tenant_idx
  on truthpass_enterprise_audit_events (tenant_id, created_at, event_id);
