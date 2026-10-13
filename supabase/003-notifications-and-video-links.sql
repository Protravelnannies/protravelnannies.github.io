-- Pro Travel Nannies: sign-up and approval emails, and link-only intro videos (upgrade 003)
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run more than once;
-- it keeps all existing people, bookings and profiles.
--
-- * When someone signs up on the website, the Booking Tracker Apps Script emails Cameron,
--   and families get a welcome email.
-- * When Cameron approves someone, they get a "You're approved" email.
--   (The emails themselves are written in booking-tracker/add-booking-requests.gs.)
-- * Intro videos are now links only (Loom, YouTube, Vimeo), so the storage bucket only
--   accepts photos.
--
-- The last line shows a secret key. Copy it into the Apps Script as the script property
-- SUPABASE_KEY. It's made here, inside the database, so it never appears in any file.

create extension if not exists pg_net;

-- Private settings, not reachable from the website
create schema if not exists private;
revoke all on schema private from anon, authenticated, public;
create table if not exists private.settings (name text primary key, value text not null);
insert into private.settings (name, value)
values ('apps_script_key', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

create or replace function public.notify_people_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  event text;
begin
  if tg_op = 'INSERT' and new.source = 'signup' then
    event := 'signup';
  elsif tg_op = 'UPDATE' and old.approved = false and new.approved = true then
    event := 'approved';
  else
    return new;
  end if;
  -- Same Apps Script web app as the website forms; the key proves the message came from here
  perform net.http_post(
    url  := 'https://script.google.com/macros/s/AKfycbw6Ju0GJo18rcTRX_Yn7TPyN5zg4b91tSeDtIvntGWgdAsgRi9jhKPjZlIRfZzcPYw/exec',
    body := jsonb_build_object(
      'event', event,
      'key', (select value from private.settings where name = 'apps_script_key'),
      'role', new.role, 'full_name', new.full_name, 'email', new.email, 'phone', new.phone)
  );
  return new;
end $$;

revoke execute on function public.notify_people_change() from anon, authenticated, public;

drop trigger if exists people_notify on public.people;
create trigger people_notify
  after insert or update of approved on public.people
  for each row execute function public.notify_people_change();

-- Photos only from now on (max 10 MB each). Old video_path values are no longer shown.
update storage.buckets
set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'profiles';

-- Copy this value into Apps Script > Project Settings > Script properties as SUPABASE_KEY
select value as supabase_key from private.settings where name = 'apps_script_key';
