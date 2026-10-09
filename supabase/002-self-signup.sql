-- Pro Travel Nannies: let nannies and families create their own accounts (upgrade 002)
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run more than once;
-- it keeps all existing people, bookings and profiles.
--
-- * Anyone can sign up as a nanny or a family (never as admin).
-- * Families can use their account straight away.
-- * Nannies can build their profile straight away, but stay "waiting for approval" until
--   Cameron approves them, and can't be offered bookings before that.
-- * People Cameron adds himself are approved automatically.

alter table public.people add column if not exists approved boolean not null default true;
alter table public.people add column if not exists source text not null default 'invited' check (source in ('invited', 'signup'));

create or replace function public.link_new_login() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pid    uuid;
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text  := meta ->> 'role';
  nm     text  := nullif(trim(meta ->> 'full_name'), '');
begin
  -- Already on the list (added by Cameron): just link the login
  select id into pid from public.people where email = lower(new.email);
  if pid is not null then
    if not (select can_log_in from public.people where id = pid) then
      raise exception 'This account has been switched off';
    end if;
    update public.people set user_id = new.id where id = pid;
    return new;
  end if;

  -- New sign-up from the website: only as a nanny or a family, with a name
  if wanted is null or wanted not in ('nanny', 'family') or nm is null then
    raise exception 'No Pro Travel Nannies account uses this email yet';
  end if;
  insert into public.people (email, full_name, role, phone, approved, source)
  values (lower(new.email), left(nm, 120), wanted, nullif(left(trim(coalesce(meta ->> 'phone', '')), 40), ''), wanted = 'family', 'signup')
  returning id into pid;
  update public.people set user_id = new.id where id = pid;
  if wanted = 'nanny' then
    insert into public.nanny_profiles (person_id) values (pid);
  else
    insert into public.family_profiles (person_id) values (pid);
  end if;
  return new;
end $$;

-- Only approved nannies can be put on a booking
create or replace function public.only_approved_nannies() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.people where id = new.nanny_id and role = 'nanny' and approved) then
    raise exception 'This nanny has not been approved yet';
  end if;
  return new;
end $$;

drop trigger if exists booking_nannies_approved on public.booking_nannies;
create trigger booking_nannies_approved
  before insert or update of nanny_id on public.booking_nannies
  for each row execute function public.only_approved_nannies();

revoke execute on function public.only_approved_nannies() from anon, public;
