-- Enterprise browser sessions map to a tenant through this server-side membership table.
-- The API reads it with the database service connection; it is never exposed to the
-- public client. Supabase Auth metadata can also carry tenant_id for small pilots.
create table if not exists public.truthpass_tenant_members (
  user_id text not null,
  tenant_id text not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists truthpass_tenant_members_tenant_idx
  on public.truthpass_tenant_members (tenant_id, status);

revoke all on public.truthpass_tenant_members from anon, authenticated;
