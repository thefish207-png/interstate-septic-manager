# Edge-Case Test Results

Generated: 2026-04-26T04:08:22.548Z

**Summary:** 26 pass, 0 fail, 3 warn, 0 note, 0 partial, 0 crash

## CONCURRENCY

| Status | Test | Details |
|---|---|---|
| PASS | Concurrent UPDATE on same job | Last-write-wins: "jen edit" (no error, no data corruption) |
| PASS | Rapid create-delete-create with same ID | Re-insert with same UUID succeeded |

## RLS

| Status | Test | Details |
|---|---|---|
| PASS | Tech blocked from creating customers | RLS rejected: new row violates row-level security policy for table "customers" |
| PASS | Tech blocked from creating invoices | RLS rejected: new row violates row-level security policy for table "invoices" |
| PASS | Tech can READ invoices for work order context | Read allowed by RLS |
| PASS | Tech blocked from creating vehicles (settings) | RLS rejected: new row violates row-level security policy for table "vehicles" |
| PASS | Tech blocked from creating tank_types (settings) | RLS rejected: new row violates row-level security policy for table "tank_types" |
| PASS | Office can create customers |  |
| PASS | Office blocked from creating vehicles (settings) | RLS rejected: new row violates row-level security policy for table "vehicles" |

## INTEGRITY

| Status | Test | Details |
|---|---|---|
| PASS | Customer delete cascades to properties + tanks | Both children deleted automatically by FK CASCADE |
| WARN | Soft-deleted job CAN still be edited (no protection) | After deletion, anyone can still edit. Consider blocking. |

## PERFORMANCE

| Status | Test | Details |
|---|---|---|
| PASS | Bulk insert 100 jobs in single call | 83ms total (0.8ms per row) |
| PASS | Paginate all customers (4535 rows) | 715ms (6343 rows/sec) |

## DATA_INTEGRITY

| Status | Test | Details |
|---|---|---|
| PASS | Plain date YYYY-MM-DD |  |
| PASS | Year boundary date 2026-12-31 |  |
| PASS | NULL scheduled_date |  |
| PASS | Invalid date string rejected | Postgres rejected: invalid input syntax for type date: "not-a-date" |
| PASS | Unicode/special chars round-trip cleanly |  |
| PASS | Insert 10KB notes field | 10KB round-trip clean |

## REALTIME

| Status | Test | Details |
|---|---|---|
| PASS | Realtime INSERT event received |  |
| PASS | Realtime UPDATE event received |  |
| PASS | Realtime DELETE event received |  |

## AUTH

| Status | Test | Details |
|---|---|---|
| PASS | Login with uppercase email letters | Case-insensitive |
| PASS | Wrong password rejected | 148ms response — Invalid login credentials |
| WARN | Cannot change auth_user_id on user | Owner CAN change auth_user_id — could break login or impersonate |

## SCHEMA

| Status | Test | Details |
|---|---|---|
| PASS | Direct insert with unknown columns FAILS (proves data jsonb is needed) | Could not find the 'custom_field_one' column of 'schedule_items' in the schema cache |
| PASS | Insert with unknowns moved into data jsonb |  |
| WARN | schedule_item without scheduled_date | Allowed — null scheduled_date may cause UI issues |
| PASS | Customer without name rejected | Rejected: null value in column "name" of relation "customers" violates not-null constraint |

