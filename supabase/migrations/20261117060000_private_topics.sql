-- Sujets « juste moi » : invisibles pour l'autre, sans passation possible.
alter table public.topics add column is_private boolean not null default false;

alter policy topics_select on public.topics
  using (couple_id = public.my_couple_id() and (not is_private or created_by = (select auth.uid())));
alter policy topics_update on public.topics
  using (couple_id = public.my_couple_id() and (not is_private or created_by = (select auth.uid())))
  with check (couple_id = public.my_couple_id() and (not is_private or created_by = (select auth.uid())));
alter policy topics_delete on public.topics
  using (couple_id = public.my_couple_id() and kind = 'general' and (not is_private or created_by = (select auth.uid())));

create or replace function public.private_topic_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.is_private then
    if new.kind <> 'general' then raise exception 'Un sujet crèche est toujours à deux'; end if;
    new.owner_id := new.created_by;
  end if;
  if tg_op = 'UPDATE' then
    if new.is_private is distinct from old.is_private then
      raise exception 'La visibilité d''un sujet ne peut pas être modifiée';
    end if;
    if new.is_private and (new.proposed_to is not null or new.owner_id is distinct from old.owner_id) then
      raise exception 'Un sujet « juste moi » ne se passe pas à l''autre';
    end if;
  end if;
  return new;
end $$;
-- Après topics_insert_guard (ordre alphabétique des triggers : « topics_private… » > « topics_insert… »).
create trigger topics_private_guard before insert or update on public.topics
  for each row execute function public.private_topic_guard();

-- Une tâche privée peut appartenir à un de mes sujets privés ; une tâche partagée jamais.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.tasks'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%is_private%topic_id%';
  if cname is not null then execute format('alter table public.tasks drop constraint %I', cname); end if;
end $$;

create or replace function public.task_topic_privacy_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.topics;
begin
  if new.topic_id is null then return new; end if;
  select * into t from public.topics where id = new.topic_id;
  if t.is_private and not (new.is_private and new.owner_id = t.created_by) then
    raise exception 'Une tâche d''un sujet « juste moi » reste privée';
  end if;
  if not t.is_private and new.is_private then
    raise exception 'Une tâche privée ne peut pas être liée à un sujet à deux';
  end if;
  return new;
end $$;
create trigger tasks_topic_privacy before insert or update of topic_id, is_private on public.tasks
  for each row execute function public.task_topic_privacy_guard();

-- Notifications : rien pour un sujet « juste moi ».
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
    if new.kind <> 'general' or new.is_private then return new; end if;
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

