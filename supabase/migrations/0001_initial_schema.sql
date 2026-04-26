-- Interstate Septic Manager — Initial schema migration
-- Creates core tables matching existing JSON data structures
-- Phase 1: schema only. RLS policies and auth wiring come in 0002.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- =============================================================
-- USERS (techs, office staff, owner)
-- Mirrors users.json. NOTE: auth.users from Supabase Auth is separate;
-- we link via auth_user_id when a tech actually logs in.
-- =============================================================
create table if not exists public.users (
  id              uuid primary key default uuid_generate_v4(),
  auth_user_id    uuid unique,         -- links to auth.users when account is created
  name            text not null,
  username        text unique,
  phone           text,
  role            text not null default 'tech',  -- 'owner' | 'office' | 'tech'
  color           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_users_role on public.users(role);

-- =============================================================
-- CUSTOMERS
-- =============================================================
create table if not exists public.customers (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  company         text,
  phone           text,
  phone_home      text,
  phone_work      text,
  email           text,
  address         text,
  city            text,
  state           text,
  zip             text,
  notes           text,
  imported_from   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_customers_name on public.customers(lower(name));
create index if not exists idx_customers_company on public.customers(lower(company));
create index if not exists idx_customers_city on public.customers(city);

-- =============================================================
-- PROPERTIES (service locations linked to customers)
-- =============================================================
create table if not exists public.properties (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid references public.customers(id) on delete cascade,
  address         text,
  city            text,
  state           text,
  zip             text,
  county          text,
  company         text,
  notes           text,
  imported_from   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_properties_customer on public.properties(customer_id);
create index if not exists idx_properties_city on public.properties(city);
create index if not exists idx_properties_address on public.properties(lower(address));

-- =============================================================
-- TANK TYPES (catalog of tank/service categories)
-- =============================================================
create table if not exists public.tank_types (
  id                    uuid primary key default uuid_generate_v4(),
  name                  text not null,
  waste_code            text,
  disposal_label        text,
  pumping_price         numeric(10,2) default 0,
  disposal_price        numeric(10,2) default 0,
  generates_disposal    boolean default true,
  sort_order            integer default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_tank_types_sort on public.tank_types(sort_order);

-- =============================================================
-- TANKS (specific tanks at properties)
-- =============================================================
create table if not exists public.tanks (
  id              uuid primary key default uuid_generate_v4(),
  property_id     uuid references public.properties(id) on delete cascade,
  tank_type       text,
  volume_gallons  integer default 0,
  imported_from   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_tanks_property on public.tanks(property_id);

-- =============================================================
-- VEHICLES (trucks)
-- =============================================================
create table if not exists public.vehicles (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null,
  capacity_gallons    integer default 0,
  color               text,
  default_tech_id     uuid references public.users(id) on delete set null,
  plate               text,
  vin                 text,
  waste_hauler_id     text,
  date_in_service     date,
  sort_order          integer default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_vehicles_default_tech on public.vehicles(default_tech_id);

-- =============================================================
-- TRUCK DAY ASSIGNMENTS (which tech drives which truck on which day)
-- =============================================================
create table if not exists public.truck_day_assignments (
  id              uuid primary key default uuid_generate_v4(),
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  user_id         uuid references public.users(id) on delete set null,
  date            date not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (vehicle_id, date)
);

create index if not exists idx_truck_day_date on public.truck_day_assignments(date);
create index if not exists idx_truck_day_user on public.truck_day_assignments(user_id);

-- =============================================================
-- SCHEDULE ITEMS (the daily/weekly schedule rows — heart of the field-tech app)
-- =============================================================
create table if not exists public.schedule_items (
  id                  uuid primary key default uuid_generate_v4(),
  scheduled_date      date,
  customer_id         uuid references public.customers(id) on delete set null,
  property_id         uuid references public.properties(id) on delete set null,
  tank_id             uuid references public.tanks(id) on delete set null,
  vehicle_id          uuid references public.vehicles(id) on delete set null,
  assigned_user_id    uuid references public.users(id) on delete set null,
  service_type        text,
  notes               text,
  status              text default 'scheduled',  -- 'scheduled' | 'in_progress' | 'complete' | 'skipped' | 'cancelled'
  sort_order          integer default 0,
  estimated_gallons   integer,
  invoice_id          uuid,                       -- links to invoice when completed
  completed_at        timestamptz,
  completed_by        uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_schedule_items_date on public.schedule_items(scheduled_date);
create index if not exists idx_schedule_items_assigned on public.schedule_items(assigned_user_id, scheduled_date);
create index if not exists idx_schedule_items_vehicle on public.schedule_items(vehicle_id, scheduled_date);
create index if not exists idx_schedule_items_status on public.schedule_items(status);

-- =============================================================
-- JOBS (legacy table preserved — may overlap with schedule_items)
-- =============================================================
create table if not exists public.jobs (
  id              uuid primary key default uuid_generate_v4(),
  scheduled_date  date,
  customer_id     uuid references public.customers(id) on delete set null,
  property_id     uuid references public.properties(id) on delete set null,
  tank_id         uuid references public.tanks(id) on delete set null,
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  notes           text,
  status          text default 'scheduled',
  data            jsonb default '{}'::jsonb,  -- catch-all for additional fields
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_jobs_date on public.jobs(scheduled_date);
create index if not exists idx_jobs_assigned on public.jobs(assigned_user_id);

-- =============================================================
-- INVOICES (the big one — 7000+ historical records)
-- =============================================================
create table if not exists public.invoices (
  id                      uuid primary key default uuid_generate_v4(),
  invoice_number          text,
  customer_id             uuid references public.customers(id) on delete set null,
  customer_name           text,
  billing_company         text,
  billing_city            text,
  property_id             uuid references public.properties(id) on delete set null,
  property_company        text,
  property_address        text,
  property_city           text,
  svc_date                date,
  total                   numeric(12,2) default 0,
  amount_paid             numeric(12,2) default 0,
  status                  text,
  payment_status          text,
  payment_method          text,
  payment_due_date        date,
  products_services       text,
  product_sales           numeric(12,2) default 0,
  quantity                text,
  unit_cost               text,
  technician              text,
  tech_notes              text,
  job_notes               text,
  job_codes               text,
  gallons_pumped_total    integer default 0,
  truck                   text,
  tank_type               text,
  tank_size               integer default 0,
  waste_manifest          text,
  waste_site              text,
  disposal_date           date,
  check_numbers           text,
  complete                boolean default false,
  waiting_area            boolean default false,
  cancelled               boolean default false,
  imported_from           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_invoices_customer on public.invoices(customer_id);
create index if not exists idx_invoices_property on public.invoices(property_id);
create index if not exists idx_invoices_svc_date on public.invoices(svc_date);
create index if not exists idx_invoices_invoice_number on public.invoices(invoice_number);
create index if not exists idx_invoices_status on public.invoices(status);

-- =============================================================
-- DISPOSAL LOADS (waste manifests for trips to Juniper Ridge etc)
-- =============================================================
create table if not exists public.disposal_loads (
  id              uuid primary key default uuid_generate_v4(),
  date            date,
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  user_id         uuid references public.users(id) on delete set null,
  waste_site      text,
  manifest_number text,
  gallons         integer default 0,
  notes           text,
  data            jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_disposal_loads_date on public.disposal_loads(date);
create index if not exists idx_disposal_loads_vehicle on public.disposal_loads(vehicle_id);

-- =============================================================
-- PAYMENTS
-- =============================================================
create table if not exists public.payments (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid references public.customers(id) on delete set null,
  invoice_id      uuid references public.invoices(id) on delete set null,
  date            date,
  amount          numeric(12,2) default 0,
  method          text,
  reference       text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_payments_customer on public.payments(customer_id);
create index if not exists idx_payments_invoice on public.payments(invoice_id);
create index if not exists idx_payments_date on public.payments(date);

-- =============================================================
-- DAY NOTES
-- =============================================================
create table if not exists public.day_notes (
  id              uuid primary key default uuid_generate_v4(),
  date            date not null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (date)
);

-- =============================================================
-- REMINDERS
-- =============================================================
create table if not exists public.reminders (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid references public.customers(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete cascade,
  due_date        date,
  message         text,
  resolved        boolean default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_reminders_due_date on public.reminders(due_date);
create index if not exists idx_reminders_customer on public.reminders(customer_id);

-- =============================================================
-- SERVICE DUE NOTICES
-- =============================================================
create table if not exists public.service_due_notices (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid references public.customers(id) on delete cascade,
  property_id     uuid references public.properties(id) on delete cascade,
  tank_id         uuid references public.tanks(id) on delete cascade,
  due_date        date,
  status          text,
  data            jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_service_due_customer on public.service_due_notices(customer_id);
create index if not exists idx_service_due_due_date on public.service_due_notices(due_date);

-- =============================================================
-- updated_at trigger function (auto-update timestamps)
-- =============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply trigger to all tables that have updated_at
do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
