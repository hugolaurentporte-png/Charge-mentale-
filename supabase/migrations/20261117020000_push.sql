-- Notifications push : quand l'un ajoute quelque chose, l'autre est prévenu
-- sur son téléphone. Un trigger prépare le message puis l'envoie, via pg_net,
-- à la fonction Edge « notify », qui le pousse aux abonnements du destinataire.
--
-- Réglages à mettre dans Vault (une fois, hors migration) :
--   notify_url     https://<ref>.supabase.co/functions/v1/notify
--   notify_secret  secret partagé entre le trigger et la fonction
--   vapid_public / vapid_private / vapid_subject  clés Web Push

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponible : notifications désactivées';
end $$;

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index on public.push_subscriptions (user_id);

-- Lecture d'un secret Vault (fonctions serveur uniquement).
create or replace function public.app_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v using p_name;
  return v;
exception when others then
  return null;
end $$;
revoke all on function public.app_secret(text) from public, anon, authenticated;

-- Clé publique VAPID, nécessaire au navigateur pour s'abonner.
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select public.app_secret('vapid_public')
$$;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;

-- Configuration complète pour la fonction Edge (rôle service uniquement).
create or replace function public.push_config()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'secret', public.app_secret('notify_secret'),
    'public', public.app_secret('vapid_public'),
    'private', public.app_secret('vapid_private'),
    'subject', coalesce(public.app_secret('vapid_subject'), 'mailto:contact@example.com'))
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- « jeudi 20 novembre », ou « aujourd'hui » / « demain »
create or replace function public.fr_day(d date)
returns text language sql stable set search_path = public as $$
  select case
    when d = (now() at time zone 'Europe/Paris')::date then 'aujourd’hui'
    when d = (now() at time zone 'Europe/Paris')::date + 1 then 'demain'
    else (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])[extract(isodow from d)::int]
      || ' ' || extract(day from d)::int || ' '
      || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from d)::int]
  end
$$;

-- Envoi : à tous les membres du couple sauf l'auteur (ou à un destinataire précis).
-- Ne bloque jamais l'écriture d'origine.
create or replace function public.push_notify(p_couple uuid, p_to uuid, p_title text, p_body text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  targets uuid[];
  v_url text := public.app_secret('notify_url');
  v_secret text := public.app_secret('notify_secret');
begin
  if p_to is not null then
    targets := array[p_to];
  else
    select array_agg(user_id) into targets from public.couple_members
      where couple_id = p_couple and user_id is distinct from actor;
  end if;
  targets := array_remove(targets, actor);
  if targets is null or cardinality(targets) = 0 then return; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = any (targets)) then return; end if;
  if v_url is null or v_secret is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url,
      jsonb_build_object('user_ids', to_jsonb(targets), 'title', p_title, 'body', p_body, 'url', p_url),
      jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret);
exception when others then
  raise warning 'push_notify : %', sqlerrm;
end $$;
revoke all on function public.push_notify(uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where id = auth.uid()), 'Ton partenaire')
$$;

create or replace function public.notify_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := public.actor_name();
  l public.lists;
  c public.couples;
  p public.pickups;
begin
  if auth.uid() is null then return new; end if;

  if tg_table_name = 'tasks' then
    if new.is_private then return new; end if;
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

create trigger notify_tasks after insert on public.tasks for each row execute function public.notify_trigger();
create trigger notify_topics_ins after insert on public.topics for each row execute function public.notify_trigger();
create trigger notify_topics_upd after update of proposed_to on public.topics for each row execute function public.notify_trigger();
create trigger notify_appointments after insert on public.appointments for each row execute function public.notify_trigger();
create trigger notify_list_items after insert on public.list_items for each row execute function public.notify_trigger();
create trigger notify_relays after insert on public.relay_requests for each row execute function public.notify_trigger();
revoke all on function public.actor_name() from public, anon, authenticated;
revoke all on function public.notify_trigger() from public, anon, authenticated;
