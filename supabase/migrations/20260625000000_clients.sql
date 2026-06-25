-- Clients table
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists clients_user_id_idx on clients(user_id);

-- Link documents to clients
alter table documents add column if not exists client_id uuid references clients(id) on delete set null;
create index if not exists documents_client_id_idx on documents(client_id);

-- RLS
alter table clients enable row level security;

drop policy if exists "clients_owner" on clients;
create policy "clients_owner" on clients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
