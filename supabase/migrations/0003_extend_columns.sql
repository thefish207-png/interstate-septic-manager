-- Interstate Septic Manager — Extend columns to match existing app data
-- The original schema (0001) used a generic shape. This migration adds
-- columns that the running ISM app actually writes, so cloud upserts succeed.

-- =============================================================
-- JOBS — add fields the renderer writes
-- =============================================================
alter table public.jobs add column if not exists assigned_to uuid;
alter table public.jobs add column if not exists scheduled_time text;
alter table public.jobs add column if not exists service_type text;
alter table public.jobs add column if not exists line_items jsonb;
alter table public.jobs add column if not exists gallons_pumped jsonb;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists deleted_at timestamptz;
alter table public.jobs add column if not exists customer_confirmed_at timestamptz;
alter table public.jobs add column if not exists priority text;
alter table public.jobs add column if not exists arrival_window text;
alter table public.jobs add column if not exists invoice_id uuid;

-- =============================================================
-- INVOICES — add fields the renderer writes
-- =============================================================
alter table public.invoices add column if not exists job_id uuid;
alter table public.invoices add column if not exists driver_id uuid;
alter table public.invoices add column if not exists vehicle_id uuid;
alter table public.invoices add column if not exists gallons_pumped integer;
alter table public.invoices add column if not exists line_items jsonb;
alter table public.invoices add column if not exists subtotal numeric(12,2);
alter table public.invoices add column if not exists tax_rate numeric(5,2);
alter table public.invoices add column if not exists tax_amount numeric(12,2);
alter table public.invoices add column if not exists notes text;
alter table public.invoices add column if not exists deleted_at timestamptz;

-- =============================================================
-- SCHEDULE_ITEMS — add fields the renderer writes
-- =============================================================
alter table public.schedule_items add column if not exists item_type text;
alter table public.schedule_items add column if not exists assigned_to uuid;
alter table public.schedule_items add column if not exists manifest_number text;
alter table public.schedule_items add column if not exists waste_site text;
alter table public.schedule_items add column if not exists gallons integer;
alter table public.schedule_items add column if not exists tank_type text;
alter table public.schedule_items add column if not exists time_label text;
alter table public.schedule_items add column if not exists data jsonb default '{}'::jsonb;
alter table public.schedule_items add column if not exists deleted_at timestamptz;

-- =============================================================
-- DISPOSAL_LOADS — add fields
-- =============================================================
alter table public.disposal_loads add column if not exists manifest_number text;
alter table public.disposal_loads add column if not exists tank_type text;
alter table public.disposal_loads add column if not exists outside_pumper_id text;

-- =============================================================
-- REMINDERS — extend
-- =============================================================
alter table public.reminders add column if not exists assigned_users jsonb;
alter table public.reminders add column if not exists status text;
alter table public.reminders add column if not exists priority text;
alter table public.reminders add column if not exists data jsonb default '{}'::jsonb;

-- =============================================================
-- USERS — add fields used by the renderer
-- =============================================================
alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists deleted_at timestamptz;

-- =============================================================
-- ENABLE REALTIME for tables we want to live-sync
-- (if not already in the realtime publication)
-- =============================================================
alter publication supabase_realtime add table public.schedule_items;
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.properties;
alter publication supabase_realtime add table public.tanks;
alter publication supabase_realtime add table public.vehicles;
alter publication supabase_realtime add table public.truck_day_assignments;
alter publication supabase_realtime add table public.day_notes;
alter publication supabase_realtime add table public.reminders;
alter publication supabase_realtime add table public.disposal_loads;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.service_due_notices;
