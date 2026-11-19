-- Échanges à deux (messagerie) et notes gardées dans « Me le dire ».
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.messages (couple_id, created_at);
alter table public.messages enable row level security;
create policy messages_select on public.messages for select to authenticated
  using (couple_id = public.my_couple_id());
create policy messages_insert on public.messages for insert to authenticated
  with check (couple_id = public.my_couple_id() and author_id = (select auth.uid()));
create policy messages_delete on public.messages for delete to authenticated
  using (couple_id = public.my_couple_id() and author_id = (select auth.uid()));
alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages;

-- Lu / non lu : dernière lecture par personne.
alter table public.profiles add column if not exists messages_read_at timestamptz;

-- Une tâche peut venir d'un message.
alter table public.tasks add column if not exists message_id uuid references public.messages (id) on delete set null;

-- « Garder comme note » : une pensée privée qui n'est pas une tâche.
alter table public.tasks add column if not exists is_note boolean not null default false;
alter table public.tasks add constraint tasks_note_inbox check (not is_note or inbox);

-- Notification sobre : une seule pour une rafale de messages (3 minutes).
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.messages m where m.couple_id = new.couple_id and m.id <> new.id
             and m.author_id = new.author_id and m.created_at > now() - interval '3 minutes') then
    return new;
  end if;
  perform public.push_notify(new.couple_id, null, public.actor_name(), left(new.body, 140), '/echanges/');
  return new;
exception when others then
  raise warning 'notify_message : %', sqlerrm;
  return new;
end $$;
revoke all on function public.notify_message() from public, anon, authenticated;
create trigger notify_messages after insert on public.messages for each row execute function public.notify_message();

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
      where t.owner_id = p_user and t.inbox and not t.done and not t.is_note
        and (t.snoozed_until is null or t.snoozed_until <= p_day);
    if n > 0 then
      parts := parts || ('À trier : ' || case when n = 1 then '1 élément' else n || ' éléments' end);
    end if;
  end if;

  if cardinality(parts) = 0 then return null; end if;
  return array_to_string(parts, ' · ');
end $$;
revoke all on function public.evening_summary_text(uuid, date) from public, anon, authenticated;
