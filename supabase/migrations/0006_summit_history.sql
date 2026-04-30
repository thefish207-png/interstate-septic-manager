-- Interstate Septic Manager — Summit History (legacy work-order import)
-- Adds two tables for the read-only legacy work-order history pulled from
-- the prior scheduling software (TankTrack/Summit). Visible to every
-- authenticated user; only owners/office can insert/update/delete (the
-- upload script signs in as owner before pushing the bulk data).

-- =============================================================
-- WORK ORDER HISTORY (one row per legacy work order)
-- =============================================================
create table if not exists public.work_order_history (
  id                    uuid primary key default uuid_generate_v4(),
  legacy_work_order_id  text,
  legacy_customer_id    text,
  customer_name         text,
  customer_name_norm    text,
  customer_phone        text,
  customer_email        text,
  job_address           text,
  scheduled_date        text,
  scheduled_time        text,
  job_description       text,
  task_type             text,
  job_status            text,
  job_comments          text,
  planned_gallons       numeric,
  tank_location         text,
  disposal_site         text,
  disposal_amount       numeric,
  material_description  text,
  matched_customer_id   uuid,  -- nullable; soft-link to public.customers.id (no FK to avoid failures on orphans)
  created_at            timestamptz not null default now()
);

create unique index if not exists ix_woh_legacy_wo on public.work_order_history(legacy_work_order_id);
create index if not exists ix_woh_matched_customer on public.work_order_history(matched_customer_id);
create index if not exists ix_woh_name_norm on public.work_order_history(customer_name_norm);
create index if not exists ix_woh_legacy_customer on public.work_order_history(legacy_customer_id);
create index if not exists ix_woh_scheduled_date on public.work_order_history(scheduled_date desc);

-- =============================================================
-- WORK ORDER HISTORY CUSTOMERS (one row per unique legacy customer)
-- Used by the History search page for fast browsing without scanning
-- the full work-order table.
-- =============================================================
create table if not exists public.work_order_history_customers (
  id                    uuid primary key default uuid_generate_v4(),
  legacy_customer_id    text not null,
  name                  text,
  name_norm             text,
  phone                 text,
  email                 text,
  address               text,
  count                 integer,
  matched_customer_id   uuid,
  first_date            text,
  last_date             text,
  created_at            timestamptz not null default now()
);

create unique index if not exists ix_wohc_legacy_id on public.work_order_history_customers(legacy_customer_id);
create index if not exists ix_wohc_name on public.work_order_history_customers(lower(name));
create index if not exists ix_wohc_address on public.work_order_history_customers(lower(address));
create index if not exists ix_wohc_phone on public.work_order_history_customers(phone);
create index if not exists ix_wohc_matched on public.work_order_history_customers(matched_customer_id);

-- =============================================================
-- RLS — read for everyone authenticated, write for owner/office
-- =============================================================
alter table public.work_order_history enable row level security;
alter table public.work_order_history_customers enable row level security;

drop policy if exists "summit_history_read" on public.work_order_history;
create policy "summit_history_read" on public.work_order_history
  for select using (public.is_authenticated());

drop policy if exists "summit_history_write" on public.work_order_history;
create policy "summit_history_write" on public.work_order_history
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

drop policy if exists "summit_history_customers_read" on public.work_order_history_customers;
create policy "summit_history_customers_read" on public.work_order_history_customers
  for select using (public.is_authenticated());

drop policy if exists "summit_history_customers_write" on public.work_order_history_customers;
create policy "summit_history_customers_write" on public.work_order_history_customers
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());
