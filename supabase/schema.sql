-- Pro Travel Nannies: account portal database (version 2)
-- Paste this whole file into Supabase > SQL Editor > New query, and press Run.
-- It REBUILDS the portal tables from scratch, so only run it again if you're happy to
-- wipe the portal data (logins themselves are kept and re-linked automatically).
--
-- Who can see what (enforced by the database itself, not just the website):
--   * Admin (Cameron): everything, and is the only one who can create or change bookings,
--     prices, nanny pay, verified checks, and publish reviews.
--   * Nanny: their own profile, availability, the bookings they've been offered or accepted,
--     their own pay. Once they accept a booking: the family's details and children.
--   * Family: their own profile, children, bookings and what they owe; once a nanny has
--     accepted their booking, that nanny's profile, photos, video and published reviews.
--   * Families never see what a nanny is paid. Nannies never see what a family pays.
--   * Nobody can log in unless Cameron has added their email.

-- ---------- Start clean ----------
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.reviews, public.booking_updates, public.availability, public.booking_payments,
  public.booking_nannies, public.bookings, public.children, public.family_profiles, public.nanny_profiles,
  public.people cascade;
drop function if exists public.my_person_id(), public.is_admin(), public.can_see_booking(uuid),
  public.is_accepted_nanny(uuid), public.shares_booking_with(uuid), public.can_see_person_files(text),
  public.confirm_hours(uuid), public.respond_to_booking(uuid, text), public.family_booking_nannies(),
  public.link_new_login(), public.link_existing_login(), public.protect_admin_fields(),
  public.touch_updated_at(), public.can_review(uuid, uuid) cascade;

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
  person_id         uuid primary key references public.people (id) on delete cascade,
  headline          text,               -- e.g. "Bilingual early-years teacher"
  about             text,
  experience_years  int check (experience_years is null or experience_years between 0 and 60),
  experience        text,               -- roles, ages cared for, highlights
  qualifications    text,
  languages         text,
  areas             text,
  based_in          text,
  services          text[] not null default '{}',
  age_groups        text[] not null default '{}',
  skills            text[] not null default '{}',
  photo_path        text,               -- file in the private "profiles" storage bucket
  gallery_paths     text[] not null default '{}',
  video_path        text,
  video_url         text,               -- or a YouTube / Vimeo link
  checks            text[] not null default '{}',  -- admin only: verified badges
  updated_at        timestamptz not null default now()
);

create table public.family_profiles (
  person_id                uuid primary key references public.people (id) on delete cascade,
  family_name              text,        -- how the family likes to be called, e.g. "The Smiths"
  about                    text,
  home_country             text,
  languages_at_home        text,
  usual_address            text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  pets                     text,
  house_rules              text,
  notes_for_nannies        text,
  photo_path               text,
  updated_at               timestamptz not null default now()
);

create table public.children (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.people (id) on delete cascade,
  first_name     text not null,
  date_of_birth  date,
  allergies      text,
  medical        text,
  likes          text,
  routine        text,
  created_at     timestamptz not null default now()
);
create index on public.children (family_id);

create table public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text unique,
  status               text not null default 'Requested' check (status in ('Requested', 'Confirmed', 'Completed', 'Cancelled')),
  service              text not null,
  family_id            uuid not null references public.people (id) on delete restrict,
  event_name           text,
  booking_date         date not null,
  end_date             date check (end_date is null or end_date >= booking_date),
  start_time           time,
  end_time             time,
  hours_booked         numeric(6, 2) check (hours_booked is null or hours_booked > 0),
  schedule             text,           -- day-by-day plan for holiday / travel bookings
  nannies_needed       int not null default 1 check (nannies_needed between 1 and 30),
  children_count       int check (children_count is null or children_count between 0 and 200),
  children_ages        text,
  family_requests      text,           -- what the family asked for
  languages_requested  text,
  address              text,
  travel_details       text,
  info_for_nanny       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on public.bookings (family_id);

-- Which nanny (or nannies) is on a booking, and what each one is paid. Only that nanny and admin can read a row.
create table public.booking_nannies (
  booking_id      uuid not null references public.bookings (id) on delete cascade,
  nanny_id        uuid not null references public.people (id) on delete cascade,
  response        text not null default 'offered' check (response in ('offered', 'accepted', 'declined')),
  responded_at    timestamptz,
  nanny_pay       numeric(10, 2),
  nanny_expenses  numeric(10, 2),
  pay_note        text,
  nanny_paid_on   date,
  created_at      timestamptz not null default now(),
  primary key (booking_id, nanny_id)
);
create index on public.booking_nannies (nanny_id);

-- What the family pays. Only that family and admin can read it.
create table public.booking_payments (
  booking_id     uuid primary key references public.bookings (id) on delete cascade,
  breakdown      text,             -- e.g. "4 hours × €32 = €128\nTaxi home: €12"
  family_total   numeric(10, 2),
  amount_paid    numeric(10, 2) not null default 0,
  due_date       date,
  invoice_no     text,
  payment_note   text,
  updated_at     timestamptz not null default now()
);

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

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  nanny_id      uuid not null references public.people (id) on delete cascade,
  family_id     uuid not null references public.people (id) on delete cascade,
  rating        int not null check (rating between 1 and 5),
  comment       text not null check (length(comment) between 1 and 3000),
  published_at  timestamptz,       -- set by admin after a quick check
  created_at    timestamptz not null default now(),
  unique (booking_id, nanny_id)
);
create index on public.reviews (nanny_id);

-- ---------- Helper functions ----------

create function public.my_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.people where user_id = (select auth.uid()) and can_log_in
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people where user_id = (select auth.uid()) and can_log_in and role = 'admin')
$$;

-- Logged-in nanny has accepted this booking
create function public.is_accepted_nanny(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.booking_nannies
                 where booking_id = b and nanny_id = public.my_person_id() and response = 'accepted')
$$;

-- Admin, the family, or a nanny who has been offered (and not declined) the booking
create function public.can_see_booking(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
    or exists (select 1 from public.bookings where id = b and family_id = public.my_person_id())
    or exists (select 1 from public.booking_nannies where booking_id = b and nanny_id = public.my_person_id() and response <> 'declined')
$$;

-- The logged-in person and person p are nanny and family on a booking the nanny has accepted
create function public.shares_booking_with(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b join public.booking_nannies bn on bn.booking_id = b.id
    where bn.response = 'accepted' and b.status in ('Confirmed', 'Completed')
      and ((bn.nanny_id = public.my_person_id() and b.family_id = p)
        or (b.family_id = public.my_person_id() and bn.nanny_id = p))
  )
$$;

-- Storage: can the logged-in person view files in this person's folder?
create function public.can_see_person_files(folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
    or folder = public.my_person_id()::text
    or exists (select 1 from public.people where id::text = folder and public.shares_booking_with(id))
$$;

-- Family can review this nanny: their completed booking, which the nanny accepted
create function public.can_review(b uuid, n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings bk join public.booking_nannies bn on bn.booking_id = bk.id
                 where bk.id = b and bn.nanny_id = n and bn.response = 'accepted'
                   and bk.status = 'Completed' and bk.family_id = public.my_person_id())
$$;

-- Nanny accepts or declines a booking they've been offered
create function public.respond_to_booking(b uuid, answer text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if answer not in ('accepted', 'declined') then raise exception 'Invalid answer'; end if;
  update public.booking_nannies set response = answer, responded_at = now()
  where booking_id = b and nanny_id = public.my_person_id() and response = 'offered';
  if not found then raise exception 'This booking is no longer waiting for your answer'; end if;
end $$;

-- Family: the nannies who have accepted their bookings (without anyone's pay)
create function public.family_booking_nannies()
returns table (booking_id uuid, nanny_id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select bn.booking_id, bn.nanny_id, p.full_name
  from public.booking_nannies bn
  join public.bookings b on b.id = bn.booking_id
  join public.people p on p.id = bn.nanny_id
  where b.family_id = public.my_person_id() and bn.response = 'accepted'
$$;

-- Family confirms the hours a nanny logged on one of their bookings
create function public.confirm_hours(update_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.booking_updates u set family_confirmed_at = now()
  from public.bookings b
  where u.id = update_id and u.kind = 'hours' and u.family_confirmed_at is null
    and b.id = u.booking_id and b.family_id = public.my_person_id();
  if not found then raise exception 'Those hours could not be confirmed'; end if;
end $$;

-- ---------- Invite-only login ----------

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

-- Nannies can edit their own profile, but only admin can change their verified checks
create function public.protect_admin_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then new.checks := old.checks; end if;
  new.updated_at := now();
  return new;
end $$;

create trigger nanny_profiles_protect before update on public.nanny_profiles
  for each row execute function public.protect_admin_fields();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();
create trigger family_profiles_touch before update on public.family_profiles for each row execute function public.touch_updated_at();
create trigger booking_payments_touch before update on public.booking_payments for each row execute function public.touch_updated_at();

-- ---------- Row level security ----------

alter table public.people            enable row level security;
alter table public.nanny_profiles    enable row level security;
alter table public.family_profiles   enable row level security;
alter table public.children          enable row level security;
alter table public.bookings          enable row level security;
alter table public.booking_nannies   enable row level security;
alter table public.booking_payments  enable row level security;
alter table public.availability      enable row level security;
alter table public.booking_updates   enable row level security;
alter table public.reviews           enable row level security;

-- people
create policy "people: see self, booking contacts, all if admin" on public.people for select to authenticated
  using (public.is_admin() or user_id = (select auth.uid()) or public.shares_booking_with(id));
create policy "people: admin writes" on public.people for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- nanny_profiles
create policy "nanny_profiles: read" on public.nanny_profiles for select to authenticated
  using (public.is_admin() or person_id = public.my_person_id() or public.shares_booking_with(person_id));
create policy "nanny_profiles: admin creates" on public.nanny_profiles for insert to authenticated with check (public.is_admin());
create policy "nanny_profiles: nanny edits own" on public.nanny_profiles for update to authenticated
  using (public.is_admin() or person_id = public.my_person_id())
  with check (public.is_admin() or person_id = public.my_person_id());
create policy "nanny_profiles: admin deletes" on public.nanny_profiles for delete to authenticated using (public.is_admin());

-- family_profiles
create policy "family_profiles: read" on public.family_profiles for select to authenticated
  using (public.is_admin() or person_id = public.my_person_id() or public.shares_booking_with(person_id));
create policy "family_profiles: family creates own" on public.family_profiles for insert to authenticated
  with check (public.is_admin() or (person_id = public.my_person_id()
    and exists (select 1 from public.people where id = person_id and role = 'family')));
create policy "family_profiles: family edits own" on public.family_profiles for update to authenticated
  using (public.is_admin() or person_id = public.my_person_id())
  with check (public.is_admin() or person_id = public.my_person_id());
create policy "family_profiles: admin deletes" on public.family_profiles for delete to authenticated using (public.is_admin());

-- children
create policy "children: read" on public.children for select to authenticated
  using (public.is_admin() or family_id = public.my_person_id() or public.shares_booking_with(family_id));
create policy "children: family manages own" on public.children for all to authenticated
  using (public.is_admin() or family_id = public.my_person_id())
  with check (public.is_admin() or (family_id = public.my_person_id()
    and exists (select 1 from public.people where id = family_id and role = 'family')));

-- bookings: only admin writes
create policy "bookings: read" on public.bookings for select to authenticated using (public.can_see_booking(id));
create policy "bookings: admin writes" on public.bookings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- booking_nannies: each nanny sees only their own row (and pay); answers go through respond_to_booking()
create policy "booking_nannies: own row" on public.booking_nannies for select to authenticated
  using (public.is_admin() or nanny_id = public.my_person_id());
create policy "booking_nannies: admin writes" on public.booking_nannies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- booking_payments: the family and admin only
create policy "booking_payments: family reads own" on public.booking_payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.bookings where id = booking_id and family_id = public.my_person_id()));
create policy "booking_payments: admin writes" on public.booking_payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- availability
create policy "availability: nanny manages own" on public.availability for all to authenticated
  using (public.is_admin() or nanny_id = public.my_person_id())
  with check (public.is_admin() or (nanny_id = public.my_person_id()
    and exists (select 1 from public.people where id = nanny_id and role = 'nanny')));

-- booking_updates (hours and notes)
create policy "booking_updates: read" on public.booking_updates for select to authenticated
  using (public.is_admin()
    or exists (select 1 from public.bookings where id = booking_id and family_id = public.my_person_id())
    or public.is_accepted_nanny(booking_id));
create policy "booking_updates: add" on public.booking_updates for insert to authenticated
  with check (
    public.is_admin() or (
      author_id = public.my_person_id() and family_confirmed_at is null and checked_by_admin_at is null
      and (public.is_accepted_nanny(booking_id)
        or (kind = 'note' and exists (select 1 from public.bookings where id = booking_id and family_id = public.my_person_id())))
    )
  );
create policy "booking_updates: admin edits" on public.booking_updates for update to authenticated using (public.is_admin());
create policy "booking_updates: remove own unchecked" on public.booking_updates for delete to authenticated
  using (public.is_admin() or (author_id = public.my_person_id() and family_confirmed_at is null and checked_by_admin_at is null));

-- reviews: families review nannies on completed bookings; admin publishes
create policy "reviews: read" on public.reviews for select to authenticated
  using (public.is_admin() or family_id = public.my_person_id()
    or (published_at is not null and (nanny_id = public.my_person_id() or public.shares_booking_with(nanny_id))));
create policy "reviews: family writes" on public.reviews for insert to authenticated
  with check (family_id = public.my_person_id() and published_at is null and public.can_review(booking_id, nanny_id));
create policy "reviews: admin edits" on public.reviews for update to authenticated using (public.is_admin());
create policy "reviews: admin or author deletes unpublished" on public.reviews for delete to authenticated
  using (public.is_admin() or (family_id = public.my_person_id() and published_at is null));

-- ---------- Photo and video storage ----------
-- Private bucket: files live in a folder named after the person's id, and are only
-- shown (via short-lived links) to that person, admin, and people they're booked with.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profiles', 'profiles', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profiles: view" on storage.objects;
drop policy if exists "profiles: upload own" on storage.objects;
drop policy if exists "profiles: replace own" on storage.objects;
drop policy if exists "profiles: delete own" on storage.objects;
create policy "profiles: view" on storage.objects for select to authenticated
  using (bucket_id = 'profiles' and public.can_see_person_files((storage.foldername(name))[1]));
create policy "profiles: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'profiles' and (public.is_admin() or (storage.foldername(name))[1] = public.my_person_id()::text));
create policy "profiles: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'profiles' and (public.is_admin() or (storage.foldername(name))[1] = public.my_person_id()::text));
create policy "profiles: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'profiles' and (public.is_admin() or (storage.foldername(name))[1] = public.my_person_id()::text));

-- ---------- Logged-out visitors get nothing ----------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.my_person_id(), public.is_admin(), public.is_accepted_nanny(uuid),
  public.can_see_booking(uuid), public.shares_booking_with(uuid), public.can_see_person_files(text),
  public.respond_to_booking(uuid, text), public.family_booking_nannies(), public.confirm_hours(uuid),
  public.can_review(uuid, uuid) to authenticated;

-- ---------- First admin ----------
insert into public.people (email, full_name, role) values ('cameron@protravelnannies.com', 'Cameron Hein', 'admin');
