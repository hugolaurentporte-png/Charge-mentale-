-- Heure de début de crèche (dépôt), en plus de l'heure de fin (récupération).
alter table public.pickups add column if not exists start_time time;
alter table public.couples add column if not exists default_start_time time;

-- Enregistre l'heure de début des jours donnés : [{day, start}] (start vide = aucune).
create or replace function public.save_pickup_starts(p_entries jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid := public.require_couple();
  e jsonb; st time;
begin
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    st := nullif(e->>'start', '')::time;
    update public.pickups p set start_time = st, updated_by = auth.uid(), updated_at = now()
      where p.couple_id = c and p.day = (e->>'day')::date
        and p.start_time is distinct from st;
    if st is not null and exists (select 1 from public.pickups p where p.couple_id = c
         and p.day = (e->>'day')::date and p.time <= st) then
      raise exception 'L''heure de début doit être avant l''heure de fin';
    end if;
  end loop;
end $$;
revoke all on function public.save_pickup_starts(jsonb) from public, anon;
grant execute on function public.save_pickup_starts(jsonb) to authenticated;
