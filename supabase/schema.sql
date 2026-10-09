-- Pro Travel Nannies: account portal database
-- Paste this whole file into Supabase > SQL Editor > New query, and press Run. Run it once.
--
-- Who can see what (enforced by the database itself, not just the website):
--   * Admin (Cameron): everything.
--   * Nanny: their own profile, availability and confirmed bookings, plus the
--     family details for those bookings (children, allergies, address, notes).
--   * Family: their own details and bookings, plus the profile of the nanny on them.
--   * Nobody else can log in: an email must be added to `people` first.
-- Money (prices, nanny pay, invoices) is NOT stored here. It stays in the Google Sheet.

-- ---------- Tables ----------

create table public.people (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(trim(email))),
  full_name   text not null,
  role        text not null check (role in ('nanny', 'family', 'admin')),
  phone       text,
  can_log_in  boolean not null default true,
  user_id     uuid unique references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.nanny_profiles (
  person_id   uuid primary key references public.people (id) on delete cascade,
  about       text,
  languages   text,
  areas       text,
  photo_url   text,   -- set by admin
  video_url   text,   -- set by admin
  checks      text[] not null default '{}',  -- set by admin, e.g. {"ID verified","References checked"}
  updated_at  timestamptz not null default now()
);

create table public.family_profiles (
  person_id          uuid primary key references public.people (id) on delete cascade,
  children           text,
  allergies_medical  text,
  usual_address      text,
  notes_for_nannies  text,
  updated_at         timestamptz not null default now()
);

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,
  status          text not null default 'Confirmed' check (status in ('Enquiry', 'Confirmed', 'Completed', 'Cancelled')),
  service         text not null,
  family_id       uuid not null references public.people (id) on delete restrict,
  nanny_id        uuid references public.people (id) on delete set null,
  booking_date    date not null,
  end_date        date check (end_date is null or end_date >= booking_date),
  start_time      time,
  end_time        time,
  address         text,
  children        text,
  info_for_nanny  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.bookings (family_id);
create index on public.bookings (nanny_id);

create table public.availability (
  id          uuid primary key default gen_random_uuid(),
  nanny_id    uuid not null references public.people (id) on delete cascade,
  date_from   date not null,
  date_to     date not null check (date_to >= date_from),
  available   boolean not null default false,
  note        text,
  created_at  timestamptz not null default now()
);
create index on public.availability (nanny_id);

create table public.booking_updates (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid not null references public.bookings (id) on delete cascade,
  author_id            uuid not null references public.people (id) on delete cascade,
  kind                 text not null check (kind in ('hours', 'note')),
  work_date            date,
  hours                numeric(4, 2) check (hours is null or (hours > 0 and hours <= 24)),
  note                 text,
  family_confirmed_at  timestamptz,
  checked_by_admin_at  timestamptz,
  created_at           timestamptz not null default now(),
  check (kind = 'note' or hours is not null)
);
create index on public.booking_updates (booking_id);

-- ---------- Helper functions ----------

create function public.my_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.people where user_id = (select auth.uid()) and can_log_in
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people where user_id = (select auth.uid()) and can_log_in and role = 'admin')
$$;

-- Can the logged-in person see this booking?
create function public.can_see_booking(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.bookings
    where id = b and (
      family_id = public.my_person_id()
      or (nanny_id = public.my_person_id() and status in ('Confirmed', 'Completed'))
    )
  )
$$;

-- Do the logged-in person and person p share a confirmed or completed booking?
create function public.shares_booking_with(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings
    where status in ('Confirmed', 'Completed')
      and ((nanny_id = public.my_person_id() and family_id = p)
        or (family_id = public.my_person_id() and nanny_id = p))
  )
$$;

-- Family confirms the hours a nanny logged on one of their bookings
create function public.confirm_hours(update_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.booking_updates u set family_confirmed_at = now()
  from public.bookings b
  where u.id = update_id and u.kind = 'hours' and u.family_confirmed_at is null
    and b.id = u.booking_id and b.family_id = public.my_person_id();
  if not found then
    raise exception 'Those hours could not be confirmed';
  end if;
end $$;

-- ---------- Invite-only login ----------
-- When someone logs in for the first time, link them to their `people` row.
-- If their email isn't in `people`, the login is refused.

create function public.link_new_login() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  select id into pid from public.people where email = lower(new.email) and can_log_in;
  if pid is null then
    raise exception 'This email has not been invited to Pro Travel Nannies';
  end if;
  update public.people set user_id = new.id where id = pid;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_new_login();

-- If a person is added (or their email changed) after they already have a login, link it
create function public.link_existing_login() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  select id into new.user_id from auth.users where lower(email) = new.email;
  return new;
end $$;

create trigger people_link_login
  before insert or update of email on public.people
  for each row execute function public.link_existing_login();

-- Only admin can change a nanny's photo, video and verified checks
create function public.protect_admin_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    new.photo_url := old.photo_url;
    new.video_url := old.video_url;
    new.checks := old.checks;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger nanny_profiles_protect
  before update on public.nanny_profiles
  for each row execute function public.protect_admin_fields();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();
create trigger family_profiles_touch before update on public.family_profiles
  for each row execute function public.touch_updated_at();

-- ---------- Row level security ----------

alter table public.people           enable row level security;
alter table public.nanny_profiles   enable row level security;
alter table public.family_profiles  enable row level security;
alter table public.bookings         enable row level security;
alter table public.availability     enable row level security;
alter table public.booking_updates  enable row level security;

-- people
create policy "see self, booking contacts, or all if admin" on public.people for select to authenticated
  using (public.is_admin() or user_id = (select auth.uid()) or public.shares_booking_with(id));
create policy "admin adds people" on public.people for insert to authenticated with check (public.is_admin());
create policy "admin edits people" on public.people for update to authenticated using (public.is_admin());
create policy "admin removes people" on public.people for delete to authenticated using (public.is_admin());

-- nanny_profiles
create policy "see own, booked nanny, or all if admin" on public.nanny_profiles for select to authenticated
  using (public.is_admin() or person_id = public.my_person_id() or public.shares_booking_with(person_id));
create policy "admin creates nanny profiles" on public.nanny_profiles for insert to authenticated with check (public.is_admin());
create policy "nanny edits own profile" on public.nanny_profiles for update to authenticated
  using (public.is_admin() or person_id = public.my_person_id());
create policy "admin removes nanny profiles" on public.nanny_profiles for delete to authenticated using (public.is_admin());

-- family_profiles
create policy "see own, booked family, or all if admin" on public.family_profiles for select to authenticated
  using (public.is_admin() or person_id = public.my_person_id() or public.shares_booking_with(person_id));
create policy "family creates own details" on public.family_profiles for insert to authenticated
  with check (public.is_admin() or person_id = public.my_person_id());
create policy "family edits own details" on public.family_profiles for update to authenticated
  using (public.is_admin() or person_id = public.my_person_id());
create policy "admin removes family details" on public.family_profiles for delete to authenticated using (public.is_admin());

-- bookings (only admin writes)
create policy "see own bookings" on public.bookings for select to authenticated using (public.can_see_booking(id));
create policy "admin adds bookings" on public.bookings for insert to authenticated with check (public.is_admin());
create policy "admin edits bookings" on public.bookings for update to authenticated using (public.is_admin());
create policy "admin removes bookings" on public.bookings for delete to authenticated using (public.is_admin());

-- availability
create policy "nanny sees own availability" on public.availability for select to authenticated
  using (public.is_admin() or nanny_id = public.my_person_id());
create policy "nanny adds own availability" on public.availability for insert to authenticated
  with check (public.is_admin() or nanny_id = public.my_person_id());
create policy "nanny edits own availability" on public.availability for update to authenticated
  using (public.is_admin() or nanny_id = public.my_person_id())
  with check (public.is_admin() or nanny_id = public.my_person_id());
create policy "nanny removes own availability" on public.availability for delete to authenticated
  using (public.is_admin() or nanny_id = public.my_person_id());

-- booking_updates (hours and notes)
create policy "see updates on own bookings" on public.booking_updates for select to authenticated
  using (public.can_see_booking(booking_id));
create policy "add updates to own bookings" on public.booking_updates for insert to authenticated
  with check (
    public.is_admin() or (
      author_id = public.my_person_id() and public.can_see_booking(booking_id)
      and family_confirmed_at is null and checked_by_admin_at is null
      and (kind = 'note' or exists (select 1 from public.bookings where id = booking_id and nanny_id = public.my_person_id()))
    )
  );
create policy "admin edits updates" on public.booking_updates for update to authenticated using (public.is_admin());
create policy "remove own unchecked updates" on public.booking_updates for delete to authenticated
  using (public.is_admin() or (author_id = public.my_person_id() and family_confirmed_at is null and checked_by_admin_at is null));

-- Logged-out visitors get nothing
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.my_person_id(), public.is_admin(), public.can_see_booking(uuid),
  public.shares_booking_with(uuid), public.confirm_hours(uuid) to authenticated;

-- ---------- First admin ----------
insert into public.people (email, full_name, role) values ('cameron@protravelnannies.com', 'Cameron Hein', 'admin');
