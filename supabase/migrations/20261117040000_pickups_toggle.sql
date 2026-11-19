-- Récupérations crèche activables / désactivables pour le couple.
alter table public.couples add column pickups_enabled boolean not null default true;


-- Calendrier iCalendar : rendez-vous du couple, mes récupérations, mes tâches à heure fixe.
create or replace function public.agenda_ics(p_token text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  u uuid;
  c public.couples;
  events text;
  stamp text := to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"');
  lo date := (now() at time zone 'Europe/Paris')::date - 30;
  hi date := (now() at time zone 'Europe/Paris')::date + 365;
begin
  select user_id into u from public.calendar_tokens where token = p_token;
  if u is null then return null; end if;
  select cp.* into c from public.couples cp join public.couple_members m on m.couple_id = cp.id where m.user_id = u;
  if c.id is null then return null; end if;

  with ev as (
    select 'rdv-' || a.id as uid, a.day, a.time, 60 as minutes,
      a.title || case when not (u = any (a.participants)) then ' (' ||
        (select string_agg(p.display_name, ' et ') from public.profiles p where p.id = any (a.participants)) || ')' else '' end as title
    from public.appointments a where a.couple_id = c.id and a.day between lo and hi
    union all
    select 'creche-' || k.id, k.day, k.time, 30, c.pickup_label || ' · ' || c.child_name
    from public.pickups k where k.couple_id = c.id and k.responsible_id = u and k.day between lo and hi and c.pickups_enabled
    union all
    select 'tache-' || t.id, t.due_date, t.due_time, 30, t.title
    from public.tasks t
    where t.couple_id = c.id and not t.done and t.due_time is not null and t.due_date between lo and hi
      and (t.assignee_id = u or (t.is_private and t.owner_id = u))
  )
  select string_agg(
    'BEGIN:VEVENT' || E'\r\n' ||
    'UID:' || uid || '@a-deux' || E'\r\n' ||
    'DTSTAMP:' || stamp || E'\r\n' ||
    'DTSTART;TZID=Europe/Paris:' || to_char(day + time, 'YYYYMMDD"T"HH24MISS') || E'\r\n' ||
    'DTEND;TZID=Europe/Paris:' || to_char(day + time + make_interval(mins => minutes), 'YYYYMMDD"T"HH24MISS') || E'\r\n' ||
    'SUMMARY:' || public.ics_text(title) || E'\r\n' ||
    'END:VEVENT' || E'\r\n', '' order by day, time)
  into events from ev;

  return 'BEGIN:VCALENDAR' || E'\r\n' ||
    'VERSION:2.0' || E'\r\n' ||
    'PRODID:-//A deux//FR' || E'\r\n' ||
    'CALSCALE:GREGORIAN' || E'\r\n' ||
    'METHOD:PUBLISH' || E'\r\n' ||
    'X-WR-CALNAME:À deux' || E'\r\n' ||
    'X-WR-TIMEZONE:Europe/Paris' || E'\r\n' ||
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H' || E'\r\n' ||
    'X-PUBLISHED-TTL:PT1H' || E'\r\n' ||
    'BEGIN:VTIMEZONE' || E'\r\n' || 'TZID:Europe/Paris' || E'\r\n' ||
    'BEGIN:DAYLIGHT' || E'\r\n' || 'TZOFFSETFROM:+0100' || E'\r\n' || 'TZOFFSETTO:+0200' || E'\r\n' ||
    'TZNAME:CEST' || E'\r\n' || 'DTSTART:19700329T020000' || E'\r\n' || 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU' || E'\r\n' ||
    'END:DAYLIGHT' || E'\r\n' ||
    'BEGIN:STANDARD' || E'\r\n' || 'TZOFFSETFROM:+0200' || E'\r\n' || 'TZOFFSETTO:+0100' || E'\r\n' ||
    'TZNAME:CET' || E'\r\n' || 'DTSTART:19701025T030000' || E'\r\n' || 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU' || E'\r\n' ||
    'END:STANDARD' || E'\r\n' || 'END:VTIMEZONE' || E'\r\n' ||
    coalesce(events, '') ||
    'END:VCALENDAR' || E'\r\n';
end $$;
revoke all on function public.agenda_ics(text) from public, anon, authenticated;
grant execute on function public.agenda_ics(text) to service_role;
