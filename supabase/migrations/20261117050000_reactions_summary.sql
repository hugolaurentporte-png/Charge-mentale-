-- Réactions emoji sur les tâches, et résumé du soir (notification vers 20 h).

-- 1. Réactions -----------------------------------------------------------------
create table public.task_reactions (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '😊', '❤️', '🙏', '💪', '🎉', '😅')),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table public.task_reactions enable row level security;
-- Visible et modifiable seulement sur les tâches partagées du couple (la RLS de tasks s'applique).
create policy reactions_select on public.task_reactions for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and not t.is_private));
create policy reactions_insert on public.task_reactions for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.tasks t where t.id = task_id and not t.is_private));
create policy reactions_update on public.task_reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reactions_delete on public.task_reactions for delete to authenticated
  using (user_id = (select auth.uid()));
alter table public.task_reactions replica identity full;
alter publication supabase_realtime add table public.task_reactions;

create or replace function public.notify_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tasks; target uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  target := coalesce(t.assignee_id, t.owner_id);
  if target is null or target = auth.uid() then target := t.owner_id; end if;
  if target = auth.uid() then return new; end if;
  perform public.push_notify(t.couple_id, target, new.emoji,
    public.actor_name() || ' a réagi ' || new.emoji || ' à « ' || t.title || ' »', '/planning/');
  return new;
exception when others then
  raise warning 'notify_reaction : %', sqlerrm;
  return new;
end $$;
revoke all on function public.notify_reaction() from public, anon, authenticated;
create trigger notify_reactions after insert or update of emoji on public.task_reactions
  for each row execute function public.notify_reaction();

-- 2. Résumé du soir ------------------------------------------------------------
alter table public.profiles add column evening_summary boolean not null default true;

-- Texte du résumé de demain pour une personne (null s'il n'y a rien).
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
    where t.couple_id = c.id and not t.done and t.due_date = p_day
      and (t.assignee_id = p_user or (t.is_private and t.owner_id = p_user));
  if n > 0 then
    parts := parts || (case when n = 1 then '1 tâche : ' else n || ' tâches : ' end || left(titles, 120));
  end if;

  if cardinality(parts) = 0 then return null; end if;
  return array_to_string(parts, ' · ');
end $$;
revoke all on function public.evening_summary_text(uuid, date) from public, anon, authenticated;

-- Envoie le résumé à chaque personne abonnée qui l'a laissé activé.
create or replace function public.send_evening_summaries(p_day date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(p_day, (now() at time zone 'Europe/Paris')::date + 1);
  r record; body text; sent int := 0;
begin
  for r in
    select distinct m.user_id, m.couple_id
    from public.couple_members m
    join public.profiles p on p.id = m.user_id and p.evening_summary
    where exists (select 1 from public.push_subscriptions s where s.user_id = m.user_id)
  loop
    body := public.evening_summary_text(r.user_id, d);
    if body is not null then
      perform public.push_notify(r.couple_id, r.user_id, 'Demain', body, '/planning/');
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end $$;
revoke all on function public.send_evening_summaries(date) from public, anon, authenticated;

-- Tâche planifiée : chaque heure, n'agit qu'à 20 h (heure de Paris, été comme hiver).
create or replace function public.evening_summary_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  if extract(hour from now() at time zone 'Europe/Paris') = 20 then
    perform public.send_evening_summaries();
  end if;
end $$;
revoke all on function public.evening_summary_tick() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('a-deux-resume-du-soir', '0 * * * *', 'select public.evening_summary_tick()');
exception when others then
  raise notice 'pg_cron indisponible : résumé du soir non planifié';
end $$;
