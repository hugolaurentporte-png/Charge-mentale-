-- 1. Lu / non lu fiable : l'heure de lecture est fixée par le serveur et ne peut
--    jamais être antérieure au dernier message de l'autre (horloge du téléphone
--    en retard = pastille qui ne partait pas).
create or replace function public.mark_messages_read()
returns void language sql security definer set search_path = public as $$
  update public.profiles p
     set messages_read_at = greatest(
           now(),
           coalesce((select max(m.created_at) from public.messages m
                      where m.couple_id = public.my_couple_id() and m.author_id <> p.id), now()))
   where p.id = auth.uid();
$$;
revoke all on function public.mark_messages_read() from public, anon;
grant execute on function public.mark_messages_read() to authenticated;

-- 2. Notification de message : regroupée seulement tant que l'autre n'a rien vu.
--    Dès qu'il a ouvert la conversation (ou répondu), le message suivant le prévient.
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  other uuid;
  seen timestamptz;
begin
  select user_id into other from public.couple_members
    where couple_id = new.couple_id and user_id <> new.author_id limit 1;
  select messages_read_at into seen from public.profiles where id = other;
  if exists (select 1 from public.messages m
              where m.couple_id = new.couple_id and m.id <> new.id and m.author_id = new.author_id
                and m.created_at > now() - interval '3 minutes'
                and m.created_at > coalesce(seen, '-infinity')
                and not exists (select 1 from public.messages r
                                 where r.couple_id = new.couple_id and r.author_id <> new.author_id
                                   and r.created_at > m.created_at)) then
    return new;
  end if;
  perform public.push_notify(new.couple_id, other, public.actor_name(), left(new.body, 140), '/echanges/');
  return new;
exception when others then
  raise warning 'notify_message : %', sqlerrm;
  return new;
end $$;
revoke all on function public.notify_message() from public, anon, authenticated;

-- 3. Rappel (date + heure) sur une tâche ou un élément « à trier » :
--    notification pour son propriétaire seul.
alter table public.tasks add column if not exists remind_at timestamptz;
alter table public.tasks add column if not exists reminder_sent_at timestamptz;
create index if not exists tasks_remind_due on public.tasks (remind_at) where remind_at is not null and reminder_sent_at is null;

create or replace function public.tasks_reminder_reset()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.remind_at is distinct from old.remind_at then new.reminder_sent_at := null; end if;
  return new;
end $$;
drop trigger if exists tasks_reminder_reset on public.tasks;
create trigger tasks_reminder_reset before update of remind_at on public.tasks
  for each row execute function public.tasks_reminder_reset();

create or replace function public.send_due_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    update public.tasks t set reminder_sent_at = now()
     where t.remind_at <= now() and t.reminder_sent_at is null and not t.done
       and t.remind_at > now() - interval '1 day'
    returning t.id, t.couple_id, t.owner_id, t.title, t.inbox, t.is_private
  loop
    perform public.push_notify(r.couple_id, r.owner_id, 'Rappel', left(r.title, 140),
      case when r.inbox or r.is_private then '/moi/' else '/planning/' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.send_due_reminders() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('a-deux-rappels', '* * * * *', 'select public.send_due_reminders()');
exception when others then
  raise notice 'pg_cron indisponible : rappels non planifiés';
end $$;
