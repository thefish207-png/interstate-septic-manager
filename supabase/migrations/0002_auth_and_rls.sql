-- Interstate Septic Manager — Auth + Row Level Security
-- Adds: auth integration, role-based access, RLS policies for all tables.
--
-- ROLES:
--   owner  — full access (you)
--   office — full access except user management
--   tech   — read operational data; write only their own schedule + disposal loads

-- =============================================================
-- Helper functions: get current user's id and role from auth.uid()
-- =============================================================

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.current_app_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select public.current_app_user_role() = 'owner';
$$;

create or replace function public.is_office_or_owner()
returns boolean
language sql
stable
as $$
  select public.current_app_user_role() in ('owner', 'office');
$$;

create or replace function public.is_authenticated()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

-- =============================================================
-- Enable RLS on all tables
-- =============================================================
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.properties enable row level security;
alter table public.tank_types enable row level security;
alter table public.tanks enable row level security;
alter table public.vehicles enable row level security;
alter table public.truck_day_assignments enable row level security;
alter table public.schedule_items enable row level security;
alter table public.jobs enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.disposal_loads enable row level security;
alter table public.day_notes enable row level security;
alter table public.reminders enable row level security;
alter table public.service_due_notices enable row level security;

-- =============================================================
-- USERS table policies
-- - Everyone can see their own user record
-- - Owner/office can see all users
-- - Only owner can insert/update/delete users
-- =============================================================
drop policy if exists "users_select_self" on public.users;
create policy "users_select_self" on public.users
  for select using (auth_user_id = auth.uid() or public.is_office_or_owner());

drop policy if exists "users_modify_owner" on public.users;
create policy "users_modify_owner" on public.users
  for all using (public.is_owner()) with check (public.is_owner());

-- =============================================================
-- CUSTOMERS — owner/office full access; techs read-only
-- =============================================================
drop policy if exists "customers_read" on public.customers;
create policy "customers_read" on public.customers
  for select using (public.is_authenticated());

drop policy if exists "customers_write" on public.customers;
create policy "customers_write" on public.customers
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- PROPERTIES — same pattern
-- =============================================================
drop policy if exists "properties_read" on public.properties;
create policy "properties_read" on public.properties
  for select using (public.is_authenticated());

drop policy if exists "properties_write" on public.properties;
create policy "properties_write" on public.properties
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- TANK_TYPES — settings: readable by all, modifiable by OWNER ONLY
-- =============================================================
drop policy if exists "tank_types_read" on public.tank_types;
create policy "tank_types_read" on public.tank_types
  for select using (public.is_authenticated());

drop policy if exists "tank_types_write" on public.tank_types;
create policy "tank_types_write" on public.tank_types
  for all using (public.is_owner()) with check (public.is_owner());

-- =============================================================
-- TANKS — same pattern
-- =============================================================
drop policy if exists "tanks_read" on public.tanks;
create policy "tanks_read" on public.tanks
  for select using (public.is_authenticated());

drop policy if exists "tanks_write" on public.tanks;
create policy "tanks_write" on public.tanks
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- VEHICLES — settings: readable by all, modifiable by OWNER ONLY
-- =============================================================
drop policy if exists "vehicles_read" on public.vehicles;
create policy "vehicles_read" on public.vehicles
  for select using (public.is_authenticated());

drop policy if exists "vehicles_write" on public.vehicles;
create policy "vehicles_write" on public.vehicles
  for all using (public.is_owner()) with check (public.is_owner());

-- =============================================================
-- TRUCK_DAY_ASSIGNMENTS — same pattern
-- =============================================================
drop policy if exists "truck_day_read" on public.truck_day_assignments;
create policy "truck_day_read" on public.truck_day_assignments
  for select using (public.is_authenticated());

drop policy if exists "truck_day_write" on public.truck_day_assignments;
create policy "truck_day_write" on public.truck_day_assignments
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- SCHEDULE_ITEMS — everyone reads (crew coordination); techs update own; office/owner write all
-- =============================================================
drop policy if exists "schedule_items_read" on public.schedule_items;
create policy "schedule_items_read" on public.schedule_items
  for select using (public.is_authenticated());

drop policy if exists "schedule_items_insert" on public.schedule_items;
create policy "schedule_items_insert" on public.schedule_items
  for insert with check (public.is_office_or_owner());

drop policy if exists "schedule_items_update_own" on public.schedule_items;
create policy "schedule_items_update_own" on public.schedule_items
  for update using (
    public.is_office_or_owner()
    or assigned_user_id = public.current_app_user_id()
  ) with check (
    public.is_office_or_owner()
    or assigned_user_id = public.current_app_user_id()
  );

drop policy if exists "schedule_items_delete" on public.schedule_items;
create policy "schedule_items_delete" on public.schedule_items
  for delete using (public.is_office_or_owner());

-- =============================================================
-- JOBS — everyone reads; techs update own; office/owner write all
-- =============================================================
drop policy if exists "jobs_read" on public.jobs;
create policy "jobs_read" on public.jobs
  for select using (public.is_authenticated());

drop policy if exists "jobs_insert" on public.jobs;
create policy "jobs_insert" on public.jobs
  for insert with check (public.is_office_or_owner());

drop policy if exists "jobs_update_own" on public.jobs;
create policy "jobs_update_own" on public.jobs
  for update using (
    public.is_office_or_owner()
    or assigned_user_id = public.current_app_user_id()
  ) with check (
    public.is_office_or_owner()
    or assigned_user_id = public.current_app_user_id()
  );

drop policy if exists "jobs_delete" on public.jobs;
create policy "jobs_delete" on public.jobs
  for delete using (public.is_office_or_owner());

-- =============================================================
-- INVOICES — work order history: techs READ for context;
-- only office/owner can WRITE.
-- =============================================================
drop policy if exists "invoices_read" on public.invoices;
create policy "invoices_read" on public.invoices
  for select using (public.is_authenticated());

drop policy if exists "invoices_write" on public.invoices;
create policy "invoices_write" on public.invoices
  for insert with check (public.is_office_or_owner());

drop policy if exists "invoices_update" on public.invoices;
create policy "invoices_update" on public.invoices
  for update using (public.is_office_or_owner()) with check (public.is_office_or_owner());

drop policy if exists "invoices_delete" on public.invoices;
create policy "invoices_delete" on public.invoices
  for delete using (public.is_office_or_owner());

-- =============================================================
-- PAYMENTS — owner/office only
-- =============================================================
drop policy if exists "payments_owner_office" on public.payments;
create policy "payments_owner_office" on public.payments
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- DISPOSAL_LOADS — owner/office full; techs can insert and read their own
-- =============================================================
drop policy if exists "disposal_loads_read" on public.disposal_loads;
create policy "disposal_loads_read" on public.disposal_loads
  for select using (
    public.is_office_or_owner()
    or user_id = public.current_app_user_id()
  );

drop policy if exists "disposal_loads_insert" on public.disposal_loads;
create policy "disposal_loads_insert" on public.disposal_loads
  for insert with check (
    public.is_office_or_owner()
    or user_id = public.current_app_user_id()
  );

drop policy if exists "disposal_loads_update" on public.disposal_loads;
create policy "disposal_loads_update" on public.disposal_loads
  for update using (
    public.is_office_or_owner()
    or user_id = public.current_app_user_id()
  );

drop policy if exists "disposal_loads_delete" on public.disposal_loads;
create policy "disposal_loads_delete" on public.disposal_loads
  for delete using (public.is_office_or_owner());

-- =============================================================
-- DAY_NOTES — readable by all, writable by office/owner
-- =============================================================
drop policy if exists "day_notes_read" on public.day_notes;
create policy "day_notes_read" on public.day_notes
  for select using (public.is_authenticated());

drop policy if exists "day_notes_write" on public.day_notes;
create policy "day_notes_write" on public.day_notes
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- REMINDERS — owner/office full; techs read-only
-- =============================================================
drop policy if exists "reminders_read" on public.reminders;
create policy "reminders_read" on public.reminders
  for select using (public.is_authenticated());

drop policy if exists "reminders_write" on public.reminders;
create policy "reminders_write" on public.reminders
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- SERVICE_DUE_NOTICES — owner/office full; techs read-only
-- =============================================================
drop policy if exists "service_due_read" on public.service_due_notices;
create policy "service_due_read" on public.service_due_notices
  for select using (public.is_authenticated());

drop policy if exists "service_due_write" on public.service_due_notices;
create policy "service_due_write" on public.service_due_notices
  for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- =============================================================
-- USERNAME normalization helper (used during account creation)
-- =============================================================
create or replace function public.normalize_username(raw text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(raw, ''), '\s+', '.', 'g'));
$$;

-- =============================================================
-- Seed: convert existing 'admin' role to 'owner'
-- =============================================================
update public.users set role = 'owner' where role = 'admin';

-- =============================================================
-- Trigger: when a new auth.users row is inserted, try to link
-- it to a public.users row by matching the synthetic email
-- (e.g., chris@interstate-septic.app -> public.users.username = 'chris')
-- =============================================================
create or replace function public.link_auth_to_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  username_part text;
begin
  -- Extract username from synthetic email
  username_part := split_part(new.email, '@', 1);
  -- Update matching public.users row
  update public.users
     set auth_user_id = new.id,
         updated_at = now()
   where public.normalize_username(username) = lower(username_part)
     and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_auth_to_app_user();
