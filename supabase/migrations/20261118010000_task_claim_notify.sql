-- « Je m'en occupe » sur une tâche à deux : l'autre est prévenu.
-- Aussi quand on confie une tâche à l'autre.
create or replace function public.notify_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  who text := public.actor_name();
begin
  if me is null or new.is_private or new.done then return new; end if;
  if new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if new.assignee_id = me and old.assignee_id is null then
    perform public.push_notify(new.couple_id, null, 'Tâche prise',
      who || ' s’occupe de « ' || new.title || ' »', '/planning/');
  elsif new.assignee_id is not null and new.assignee_id <> me then
    perform public.push_notify(new.couple_id, new.assignee_id, 'Tâche pour toi',
      who || ' te confie « ' || new.title || ' »'
        || case when new.due_date is not null then ', ' || public.fr_day(new.due_date) else '' end,
      '/planning/');
  end if;
  return new;
exception when others then
  raise warning 'notify_task_assignee : %', sqlerrm;
  return new;
end $$;
revoke all on function public.notify_task_assignee() from public, anon, authenticated;
create trigger notify_task_assignee after update of assignee_id on public.tasks
  for each row execute function public.notify_task_assignee();
