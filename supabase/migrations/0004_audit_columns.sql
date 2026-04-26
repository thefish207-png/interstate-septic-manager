-- Audit metadata: who originally created each job/invoice/schedule item

alter table public.jobs add column if not exists created_by uuid references public.users(id) on delete set null;
alter table public.invoices add column if not exists created_by uuid references public.users(id) on delete set null;
alter table public.schedule_items add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists idx_jobs_created_by on public.jobs(created_by);
create index if not exists idx_invoices_created_by on public.invoices(created_by);
create index if not exists idx_schedule_items_created_by on public.schedule_items(created_by);
