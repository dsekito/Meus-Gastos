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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entries
  add column if not exists updated_at timestamptz not null default now();

create index if not exists entries_user_id_date_idx
  on public.entries (user_id, date, id);

create index if not exists entries_user_id_updated_at_idx
  on public.entries (user_id, updated_at);

alter table public.entries enable row level security;

drop policy if exists "Usuário acessa apenas seus lançamentos" on public.entries;
create policy "Usuário acessa apenas seus lançamentos"
on public.entries
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.entries to authenticated;

create table if not exists public.financial_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  current_balance numeric(12,2) not null default 10000,
  balance_reference_date date not null default current_date,
  income_day_15 numeric(12,2) not null default 9365.96,
  income_last_business_day numeric(12,2) not null default 8011.84,
  types jsonb not null default '[]'::jsonb,
  descriptions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.financial_settings
  add column if not exists balance_reference_date date not null default current_date;

alter table public.financial_settings
  add column if not exists types jsonb not null default '[]'::jsonb,
  add column if not exists descriptions jsonb not null default '[]'::jsonb;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_entries_updated_at on public.entries;
create trigger set_entries_updated_at
before update on public.entries
for each row execute function public.set_updated_at();

drop trigger if exists set_financial_settings_updated_at on public.financial_settings;
create trigger set_financial_settings_updated_at
before update on public.financial_settings
for each row execute function public.set_updated_at();

alter table public.financial_settings enable row level security;

drop policy if exists "Usuário acessa apenas suas configurações" on public.financial_settings;
create policy "Usuário acessa apenas suas configurações"
on public.financial_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.financial_settings to authenticated;
