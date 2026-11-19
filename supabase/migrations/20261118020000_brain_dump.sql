-- « Vider ma tête » : une saisie rapide devient une tâche normale (pas de second
-- système). Les éléments non triés sont des tâches privées marquées « à trier ».
alter table public.tasks add column if not exists inbox boolean not null default false;
alter table public.tasks add column if not exists category text
  check (category in ('courses', 'famille', 'maison', 'administratif', 'personnel', 'idees'));
alter table public.tasks add column if not exists snoozed_until date;
-- À trier = privé jusqu'au tri.
alter table public.tasks add constraint tasks_inbox_private check (not inbox or is_private);
alter table public.profiles add column if not exists inbox_reminder boolean not null default true;

-- La visibilité reste figée, sauf au moment du tri d'un élément « à trier ».
create or replace function public.immutable_privacy_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'tasks' then
    if old.inbox and not new.inbox and new.owner_id = old.owner_id and new.couple_id = old.couple_id then
      return new;
    end if;
    if new.inbox and not old.inbox then
      raise exception 'Une tâche ne peut pas revenir « à trier »';
    end if;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.is_private is distinct from old.is_private
     or new.couple_id is distinct from old.couple_id then
    raise exception 'Le propriétaire et la visibilité ne peuvent pas être modifiés';
  end if;
  return new;
end $$;

create or replace function public.evening_summary_text(p_user uuid, p_day date)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  c public.couples;
  k public.pickups;
  parts text[] := '{}';
  n int;
  titles text;
begin
  select cp.* into c from public.couples cp join public.couple_members m on m.couple_id = cp.id where m.user_id = p_user;
  if c.id is null then return null; end if;

  if c.pickups_enabled then
    select * into k from public.pickups where couple_id = c.id and day = p_day;
    if k.id is not null then
      parts := parts || ('Crèche ' || to_char(k.time, 'HH24"h"MI') || ' : ' || case
        when k.responsible_id is null then 'personne pour l’instant'
        when k.responsible_id = p_user then 'toi'
        else (select display_name from public.profiles where id = k.responsible_id) end);
    end if;
  end if;

  select count(*), string_agg(to_char(a.time, 'HH24"h"MI') || ' ' || a.title, ', ' order by a.time)
    into n, titles from public.appointments a where a.couple_id = c.id and a.day = p_day and p_user = any (a.participants);
  if n > 0 then parts := parts || ('RDV : ' || titles); end if;

  select count(*), string_agg(t.title, ', ' order by t.due_time nulls last, t.created_at)
    into n, titles
    from public.tasks t
    where t.couple_id = c.id and not t.done and t.due_date = p_day and not t.inbox
      and (t.assignee_id = p_user or (t.is_private and t.owner_id = p_user));
  if n > 0 then
    parts := parts || (case when n = 1 then '1 tâche : ' else n || ' tâches : ' end || left(titles, 120));
  end if;

  -- Rappel de tri, dans la même notification.
  if coalesce((select inbox_reminder from public.profiles where id = p_user), true) then
    select count(*) into n from public.tasks t
      where t.owner_id = p_user and t.inbox and not t.done
        and (t.snoozed_until is null or t.snoozed_until <= p_day);
    if n > 0 then
      parts := parts || ('À trier : ' || case when n = 1 then '1 élément' else n || ' éléments' end);
    end if;
  end if;

  if cardinality(parts) = 0 then return null; end if;
  return array_to_string(parts, ' · ');
end $$;
revoke all on function public.evening_summary_text(uuid, date) from public, anon, authenticated;

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
      || case when k.responsible_id <> u then ' (' || coalesce((select p.display_name from public.profiles p where p.id = k.responsible_id), '?') || ')' else '' end
    from public.pickups k where k.couple_id = c.id and k.responsible_id is not null and k.day between lo and hi and c.pickups_enabled
    union all
    select 'tache-' || t.id, t.due_date, t.due_time, 30, t.title
      || case when t.assignee_id is not null and t.assignee_id <> u then ' (' || coalesce((select p.display_name from public.profiles p where p.id = t.assignee_id), '?') || ')' else '' end
    from public.tasks t
    where t.couple_id = c.id and not t.done and t.due_time is not null and t.due_date between lo and hi
      and (not t.is_private or t.owner_id = u) and not t.inbox
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
