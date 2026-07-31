-- Execute este arquivo no SQL Editor do Supabase.
create table if not exists public.entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  date date not null,
  value numeric(12,2) not null,
  type text not null,
  description text not null,
  detail text not null default '',
  paid boolean not null default false,
  installment jsonb,
  created_at timestamptz not null default now()
);

alter table public.entries enable row level security;

drop policy if exists "Usuário acessa apenas seus lançamentos" on public.entries;
create policy "Usuário acessa apenas seus lançamentos"
on public.entries
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.entries to authenticated;
