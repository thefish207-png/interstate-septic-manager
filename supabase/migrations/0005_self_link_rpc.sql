-- 0005_self_link_rpc.sql
-- Self-heal path for "Sign-in succeeded but no user profile is linked".
--
-- Background:
--   - public.users has RLS that requires auth_user_id = auth.uid() to read.
--   - If a row's auth_user_id is NULL or stale, the freshly-authed user can't
--     find themselves at all (RLS hides every row), so the renderer can't
--     finish login.
--
-- This migration adds a SECURITY DEFINER RPC that:
--   1. Verifies the calling auth user's email prefix equals the supplied username
--      (so a user can never claim a different account)
--   2. Looks up public.users by that username (bypassing RLS via security definer)
--   3. If found and unlinked, stamps auth_user_id = auth.uid()
--   4. Returns the profile

create or replace function public.self_link_by_username(p_username text)
returns table (
  id uuid,
  name text,
  role text,
  username text,
  color text,
  phone text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_email text;
  v_email_user text;
  v_user_id uuid;
  v_existing_link uuid;
begin
  if v_auth_uid is null then
    return;
  end if;

  -- Anti-impersonation: the requested username must match the auth account's email prefix.
  select email into v_email from auth.users where id = v_auth_uid;
  if v_email is null then return; end if;
  v_email_user := lower(split_part(v_email, '@', 1));
  if v_email_user is distinct from lower(coalesce(p_username, '')) then
    return;
  end if;

  -- Find the matching public.users row. Prefer one already linked to us; otherwise
  -- the unlinked one with the matching username.
  select u.id, u.auth_user_id into v_user_id, v_existing_link
    from public.users u
   where public.normalize_username(u.username) = v_email_user
   order by case when u.auth_user_id = v_auth_uid then 0
                 when u.auth_user_id is null then 1
                 else 2 end
   limit 1;

  if v_user_id is null then
    return;
  end if;

  -- Refuse to hijack a row already linked to a different auth account.
  if v_existing_link is not null and v_existing_link <> v_auth_uid then
    return;
  end if;

  -- Stamp the link if missing.
  if v_existing_link is null then
    update public.users set auth_user_id = v_auth_uid, updated_at = now() where id = v_user_id;
  end if;

  return query
    select u.id, u.name, u.role, u.username, u.color, u.phone
      from public.users u
     where u.id = v_user_id;
end;
$$;

grant execute on function public.self_link_by_username(text) to authenticated;
