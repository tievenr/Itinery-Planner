-- Trip Planner: schema
-- Run this first in the Supabase SQL editor, then run functions.sql.
-- Money is stored as integer minor units (cents).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  destination text,
  start_date  date,
  end_date    date,
  currency    text not null default 'USD',
  code_hash   text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.travelers (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  name       text not null,
  color      text,
  sort_order int not null default 0,
  archived   boolean not null default false
);

create table if not exists public.days (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  date       date,
  title      text,
  sort_order int not null default 0
);

create table if not exists public.activities (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  day_id     uuid references public.days(id) on delete cascade,
  start_time time,
  end_time   time,
  title      text not null,
  category   text not null default 'activity',
  notes      text,
  link       text,
  cost       bigint not null default 0,
  currency   text,
  lat        double precision,
  lng        double precision,
  sort_order int not null default 0,
  updated_at timestamptz default now(),
  updated_by text
);

create table if not exists public.budget_items (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  category    text not null default 'other',
  label       text not null default '',
  planned     bigint not null default 0,
  actual      bigint not null default 0,
  currency    text,
  day_id      uuid references public.days(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null
);

create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  type            text not null default 'other',
  title           text not null,
  provider        text,
  confirmation_no text,
  start_at        timestamp,   -- local time at the destination, no timezone
  end_at          timestamp,
  cost            bigint not null default 0,
  currency        text,
  link            text,
  notes           text
);

create table if not exists public.bills (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips(id) on delete cascade,
  title     text not null,
  bill_date date,
  paid_by   uuid references public.travelers(id) on delete set null,
  tax       bigint not null default 0,
  tip       bigint not null default 0,
  fees      bigint not null default 0,
  currency  text,
  notes     text
);

create table if not exists public.bill_items (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips(id) on delete cascade,
  bill_id   uuid not null references public.bills(id) on delete cascade,
  name      text not null default '',
  price     bigint not null default 0,
  shared_by uuid[] not null default '{}'
);

create index if not exists travelers_trip_idx    on public.travelers(trip_id);
create index if not exists days_trip_idx         on public.days(trip_id);
create index if not exists activities_trip_idx   on public.activities(trip_id);
create index if not exists activities_day_idx    on public.activities(day_id);
create index if not exists budget_items_trip_idx on public.budget_items(trip_id);
create index if not exists bookings_trip_idx     on public.bookings(trip_id);
create index if not exists bills_trip_idx        on public.bills(trip_id);
create index if not exists bill_items_bill_idx   on public.bill_items(bill_id);

-- Lock the tables: no direct access for the public API roles.
-- All reads/writes go through SECURITY DEFINER functions (functions.sql).
alter table public.trips        enable row level security;
alter table public.travelers    enable row level security;
alter table public.days         enable row level security;
alter table public.activities   enable row level security;
alter table public.budget_items enable row level security;
alter table public.bookings     enable row level security;
alter table public.bills        enable row level security;
alter table public.bill_items   enable row level security;

revoke all on all tables in schema public from anon, authenticated;
