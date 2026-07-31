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

create table if not exists public.financial_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  current_balance numeric(12,2) not null default 10000,
  income_day_15 numeric(12,2) not null default 9365.96,
  income_last_business_day numeric(12,2) not null default 8011.84,
  updated_at timestamptz not null default now()
);

alter table public.financial_settings enable row level security;

drop policy if exists "Usuário acessa apenas suas configurações" on public.financial_settings;
create policy "Usuário acessa apenas suas configurações"
on public.financial_settings
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.financial_settings to authenticated;
