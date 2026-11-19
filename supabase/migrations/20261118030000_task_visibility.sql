-- Visibilité d'une tâche : son auteur peut la passer de « Nous deux » à « Juste moi »
-- et inversement. Le reste (propriétaire, couple) reste figé.
create or replace function public.immutable_privacy_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'tasks' then
    if new.inbox and not old.inbox then
      raise exception 'Une tâche ne peut pas revenir « à trier »';
    end if;
    if new.owner_id = old.owner_id and new.couple_id = old.couple_id
       and new.is_private is distinct from old.is_private
       and (old.inbox or new.owner_id = auth.uid()) then
      return new;
    end if;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.is_private is distinct from old.is_private
     or new.couple_id is distinct from old.couple_id then
    raise exception 'Le propriétaire et la visibilité ne peuvent pas être modifiés';
  end if;
  return new;
end $$;
