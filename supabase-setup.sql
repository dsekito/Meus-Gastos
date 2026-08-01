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

create table if not exists public.recurrence_series (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  flow_type text not null check (flow_type in ('income', 'expense')),
  frequency text not null check (frequency in ('weekly', 'monthly', 'annual', 'custom')),
  interval_value smallint not null default 1 check (interval_value between 1 and 99),
  custom_unit text check (custom_unit is null or custom_unit in ('day', 'week', 'month', 'year')),
  weekdays smallint[] not null default '{}',
  start_date date not null,
  end_mode text not null default 'never' check (end_mode in ('never', 'on_date', 'after_occurrences')),
  end_date date,
  occurrence_count integer check (occurrence_count is null or occurrence_count > 0),
  business_day_adjustment text not null default 'none' check (business_day_adjustment in ('none', 'previous', 'next')),
  value numeric(12,2) not null check (value > 0),
  type text not null,
  description text not null,
  detail text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_mode <> 'on_date' or end_date is not null),
  check (end_mode <> 'after_occurrences' or occurrence_count is not null)
);

alter table public.entries
  add column if not exists flow_type text not null default 'expense',
  add column if not exists series_id uuid references public.recurrence_series(id) on delete set null,
  add column if not exists scheduled_date date,
  add column if not exists detached_from_series boolean not null default false,
  add column if not exists excluded_from_series boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entries_flow_type_check'
      and conrelid = 'public.entries'::regclass
  ) then
    alter table public.entries
      add constraint entries_flow_type_check
      check (flow_type in ('income', 'expense'));
  end if;
end;
$$;

create unique index if not exists entries_series_occurrence_idx
  on public.entries (user_id, series_id, scheduled_date)
  where series_id is not null and scheduled_date is not null;

create index if not exists entries_series_id_scheduled_date_idx
  on public.entries (series_id, scheduled_date)
  where series_id is not null;

create index if not exists recurrence_series_user_active_idx
  on public.recurrence_series (user_id, active, start_date);

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

-- Permite que dispositivos autenticados recebam atualizações dos seus lançamentos.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end;
$$;

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

drop trigger if exists set_recurrence_series_updated_at on public.recurrence_series;
create trigger set_recurrence_series_updated_at
before update on public.recurrence_series
for each row execute function public.set_updated_at();

alter table public.recurrence_series enable row level security;

revoke all privileges on public.recurrence_series from anon;

drop policy if exists "Usuário acessa apenas suas séries recorrentes" on public.recurrence_series;
create policy "Usuário acessa apenas suas séries recorrentes"
on public.recurrence_series
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.recurrence_series to authenticated;

alter table public.financial_settings enable row level security;

drop policy if exists "Usuário acessa apenas suas configurações" on public.financial_settings;
create policy "Usuário acessa apenas suas configurações"
on public.financial_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.financial_settings to authenticated;
