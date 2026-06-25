-- Entities: people, orgs, dates, locations, clauses, concepts
create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('person','organisation','location','date','clause','concept')),
  normalized_name text not null,
  created_at timestamptz not null default now(),
  unique(user_id, normalized_name, type)
);
create index if not exists entities_user_id_idx on entities(user_id);
create index if not exists entities_type_idx on entities(type);

-- Entity mentions: which document mentions which entity
create table if not exists entity_mentions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  context text,
  created_at timestamptz not null default now(),
  unique(entity_id, document_id)
);
create index if not exists entity_mentions_document_id_idx on entity_mentions(document_id);
create index if not exists entity_mentions_entity_id_idx on entity_mentions(entity_id);

-- Entity relations: directed edges between entities
create table if not exists entity_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_entity_id uuid not null references entities(id) on delete cascade,
  to_entity_id uuid not null references entities(id) on delete cascade,
  relation_type text not null,
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(from_entity_id, to_entity_id, relation_type, document_id)
);
create index if not exists entity_relations_from_idx on entity_relations(from_entity_id);
create index if not exists entity_relations_to_idx on entity_relations(to_entity_id);

-- Grants
grant all on table entities to authenticated;
grant all on table entities to service_role;
grant all on table entity_mentions to authenticated;
grant all on table entity_mentions to service_role;
grant all on table entity_relations to authenticated;
grant all on table entity_relations to service_role;

-- RLS
alter table entities enable row level security;
alter table entity_mentions enable row level security;
alter table entity_relations enable row level security;

drop policy if exists "entities_owner" on entities;
create policy "entities_owner" on entities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "entity_mentions_owner" on entity_mentions;
create policy "entity_mentions_owner" on entity_mentions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "entity_relations_owner" on entity_relations;
create policy "entity_relations_owner" on entity_relations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
