-- Petit mot sur une tâche, tâches récurrentes, flux agenda (Apple / Google).

-- 1. Petit mot -------------------------------------------------------------
alter table public.tasks add column note text check (note is null or length(note) <= 500);

-- 2. Récurrence --------------------------------------------------------------
-- Quand une tâche récurrente est terminée, la suivante est créée.
alter table public.tasks add column recurrence text
  check (recurrence is null or recurrence in ('daily', 'weekly', 'biweekly', 'monthly'));
alter table public.tasks add column recur_from uuid references public.tasks (id) on delete set null;
alter table public.tasks add constraint tasks_recurrence_needs_day check (recurrence is null or due_date is not null);
create unique index tasks_one_next on public.tasks (recur_from) where recur_from is not null;

create or replace function public.next_occurrence(d date, r text)
returns date language sql immutable set search_path = public as $$
  select case r
    when 'daily' then d + 1
    when 'weekly' then d + 7
    when 'biweekly' then d + 14
    when 'monthly' then (d + interval '1 month')::date
  end
$$;

create or replace function public.tasks_recur()
returns trigger language plpgsql security definer set search_path = public as $$
declare nxt date;
begin
  if new.done and not old.done and new.recurrence is not null and new.due_date is not null then
    nxt := public.next_occurrence(new.due_date, new.recurrence);
    -- Si la tâche est faite en retard, la suivante ne tombe pas dans le passé.
    while nxt <= (now() at time zone 'Europe/Paris')::date loop
      nxt := public.next_occurrence(nxt, new.recurrence);
    end loop;
    insert into public.tasks (couple_id, title, assignee_id, due_date, due_time, is_private, owner_id,
                              topic_id, recurrence, recur_from)
    values (new.couple_id, new.title, new.assignee_id, nxt, new.due_time, new.is_private, new.owner_id,
            new.topic_id, new.recurrence, new.id)
    on conflict (recur_from) where recur_from is not null do nothing;
  end if;
  return new;
end $$;
revoke all on function public.tasks_recur() from public, anon, authenticated;
create trigger tasks_recur after update of done on public.tasks
  for each row execute function public.tasks_recur();

-- Notifications : petit mot, et rien pour les occurrences générées.
create or replace function public.notify_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := public.actor_name();
  l public.lists;
  c public.couples;
  p public.pickups;
begin
  if auth.uid() is null then return new; end if;

  if tg_table_name = 'tasks' and tg_op = 'UPDATE' then
    -- Petit mot ajouté ou modifié sur une tâche partagée.
    if new.is_private or coalesce(trim(new.note), '') = '' or new.note is not distinct from old.note then return new; end if;
    perform public.push_notify(new.couple_id, null, 'Petit mot',
      who || ' sur « ' || new.title || ' » : ' || left(new.note, 120), '/planning/');

  elsif tg_table_name = 'tasks' then
    -- Occurrence suivante d'une tâche récurrente : pas de notification.
    if new.is_private or new.recur_from is not null then return new; end if;
    perform public.push_notify(new.couple_id, null, 'Nouvelle tâche',
      who || ' a ajouté « ' || new.title || ' »'
        || case when new.assignee_id is not null and new.assignee_id <> auth.uid() then ' pour toi' else '' end
        || case when new.due_date is not null then ', ' || public.fr_day(new.due_date) else '' end
        || case when new.due_time is not null then ' à ' || to_char(new.due_time, 'HH24"h"MI') else '' end,
      '/planning/');

  elsif tg_table_name = 'topics' and tg_op = 'INSERT' then
    if new.kind <> 'general' then return new; end if;
    perform public.push_notify(new.couple_id, null, 'Nouveau sujet',
      who || ' a ajouté le sujet « ' || new.title || ' »', '/sujets/voir/?id=' || new.id);

  elsif tg_table_name = 'topics' and tg_op = 'UPDATE' then
    if new.proposed_to is not null and old.proposed_to is null then
      perform public.push_notify(new.couple_id, new.proposed_to, 'Passation',
        who || ' te propose de prendre en charge « ' || new.title || ' »', '/sujets/voir/?id=' || new.id);
    end if;

  elsif tg_table_name = 'appointments' then
    perform public.push_notify(new.couple_id, null, 'Nouveau rendez-vous',
      who || ' a ajouté « ' || new.title || ' », ' || public.fr_day(new.day)
        || ' à ' || to_char(new.time, 'HH24"h"MI'), '/planning/');

  elsif tg_table_name = 'list_items' then
    select * into l from public.lists where id = new.list_id;
    if l.is_private then return new; end if;
    -- Plusieurs ajouts d'affilée dans la même liste : une seule notification.
    if exists (select 1 from public.list_items i where i.list_id = new.list_id and i.id <> new.id
               and i.created_by = new.created_by and i.created_at > now() - interval '3 minutes') then
      return new;
    end if;
    perform public.push_notify(l.couple_id, null, l.name,
      who || ' a ajouté « ' || new.label || ' »', '/listes/voir/?id=' || l.id);

  elsif tg_table_name = 'relay_requests' then
    select * into p from public.pickups where id = new.pickup_id;
    select * into c from public.couples where id = new.couple_id;
    perform public.push_notify(new.couple_id, new.to_user, 'Demande de relais',
      who || ' te demande de récupérer ' || c.child_name || ' ' || public.fr_day(p.day)
        || ' à ' || to_char(p.time, 'HH24"h"MI'), '/planning/');
  end if;
  return new;
exception when others then
  raise warning 'notify_trigger : %', sqlerrm;
  return new;
end $$;

create trigger notify_task_note after update of note on public.tasks
  for each row execute function public.notify_trigger();

-- 3. Flux agenda ---------------------------------------------------------------
-- Un lien secret par personne, à ajouter comme « calendrier par abonnement ».
create table public.calendar_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
create policy calendar_tokens_own on public.calendar_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.my_calendar_token(p_reset boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_reset then delete from public.calendar_tokens where user_id = auth.uid(); end if;
  insert into public.calendar_tokens (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select token into t from public.calendar_tokens where user_id = auth.uid();
  return t;
end $$;
revoke all on function public.my_calendar_token(boolean) from public, anon;
grant execute on function public.my_calendar_token(boolean) to authenticated;

create or replace function public.ics_text(s text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(coalesce(s, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n')
$$;

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
    from public.pickups k where k.couple_id = c.id and k.responsible_id = u and k.day between lo and hi
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
