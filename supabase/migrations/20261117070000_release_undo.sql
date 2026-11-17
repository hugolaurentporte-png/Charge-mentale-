-- Se retirer d'un sujet (dont l'organisation d'une semaine de crèche),
-- et annuler « terminé » sur une tâche récurrente retire l'occurrence créée.

create or replace function public.release_topic(p_topic uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple();
begin
  perform set_config('app.rpc', 'on', true);
  update public.topics set owner_id = null, proposed_to = null, proposed_by = null
    where id = p_topic and couple_id = c and owner_id = auth.uid() and not is_private;
  perform set_config('app.rpc', '', true);
  if not found then raise exception 'Tu ne suis pas ce sujet'; end if;
end $$;
revoke all on function public.release_topic(uuid) from public, anon;
grant execute on function public.release_topic(uuid) to authenticated;

create or replace function public.tasks_recur()
returns trigger language plpgsql security definer set search_path = public as $$
declare nxt date;
begin
  if new.done and not old.done and new.recurrence is not null and new.due_date is not null then
    nxt := public.next_occurrence(new.due_date, new.recurrence);
    while nxt <= (now() at time zone 'Europe/Paris')::date loop
      nxt := public.next_occurrence(nxt, new.recurrence);
    end loop;
    insert into public.tasks (couple_id, title, assignee_id, due_date, due_time, is_private, owner_id,
                              topic_id, recurrence, recur_from)
    values (new.couple_id, new.title, new.assignee_id, nxt, new.due_time, new.is_private, new.owner_id,
            new.topic_id, new.recurrence, new.id)
    on conflict (recur_from) where recur_from is not null do nothing;
  elsif old.done and not new.done then
    -- « Annuler » : l'occurrence suivante, pas encore faite ni modifiée, disparaît.
    delete from public.tasks where recur_from = new.id and not done and note is null;
  end if;
  return new;
end $$;

