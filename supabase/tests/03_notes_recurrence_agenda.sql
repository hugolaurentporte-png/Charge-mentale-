-- Petit mot, récurrence et flux agenda. À jouer après 02_push.sql.
\set ON_ERROR_STOP 1
\set hugo '''aaaaaaaa-0000-0000-0000-000000000001'''
\set camille '''bbbbbbbb-0000-0000-0000-000000000002'''
reset role;
delete from net.calls;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
create or replace function pg_temp.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false)
$$;
set role authenticated;

-- Hugo crée « Poubelles » chaque semaine (aujourd'hui, 20h) ; Camille y met un mot.
select pg_temp.login(:hugo);
insert into public.tasks (couple_id, title, due_date, due_time, recurrence, assignee_id)
  select couple_id, 'Poubelles', (now() at time zone 'Europe/Paris')::date, '20:00', 'weekly', :hugo from public.couple_members limit 1;
select pg_temp.login(:camille);
update public.tasks set note = 'Le bac jaune aussi' where title = 'Poubelles';

-- Hugo termine : la suivante apparaît dans 7 jours, une seule fois même si on recoche.
select pg_temp.login(:hugo);
update public.tasks set done = true where title = 'Poubelles' and not done;
update public.tasks set done = false where title = 'Poubelles' and recur_from is null;
update public.tasks set done = true where title = 'Poubelles' and recur_from is null;
do $$ begin
  assert (select count(*) from public.tasks where title = 'Poubelles') = 2, 'une seule occurrence suivante';
  assert (select due_date from public.tasks where title = 'Poubelles' and not done)
    = (now() at time zone 'Europe/Paris')::date + 7, 'dans 7 jours';
  assert (select due_time from public.tasks where title = 'Poubelles' and not done) = '20:00', 'même heure';
  assert public.next_occurrence('2026-01-31', 'monthly') = '2026-02-28', 'fin de mois';
end $$;

-- Agenda : un lien par personne, le flux contient la tâche de Hugo à 20h.
insert into ctx select 'cal', public.my_calendar_token();
do $$ begin
  begin perform public.agenda_ics('x'); raise exception 'ECHEC agenda lisible';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$
declare n int; b jsonb; ics text;
begin
  -- Seule la création par Hugo prévient Camille ; le mot de Camille (Hugo non abonné)
  -- et l'occurrence générée ne déclenchent rien.
  select count(*) into n from net.calls;
  assert n = 1, format('1 notification attendue, %s', n);
  ics := public.agenda_ics((select v from ctx where k = 'cal'));
  assert ics like 'BEGIN:VCALENDAR%', 'en-tête';
  assert ics like '%SUMMARY:Poubelles%', 'tâche présente';
  assert ics like '%T200000%', 'heure 20h';
  assert public.agenda_ics('inconnu') is null, 'jeton inconnu';
end $$;

-- Camille abonnée : Hugo met un mot, Camille est prévenue ; l'occurrence générée ne notifie pas.
set role authenticated;
select pg_temp.login(:hugo);
update public.tasks set note = 'Sortis à 19h' where title = 'Poubelles' and not done;
reset role;
do $$ declare b jsonb; begin
  select body into b from net.calls order by id desc limit 1;
  assert b->>'body' = 'Hugo sur « Poubelles » : Sortis à 19h', coalesce(b->>'body', 'rien');
  assert (select count(*) from net.calls) = 2, 'deux notifications au total';
end $$;
select 'TOUS LES TESTS NOTES / RÉCURRENCE / AGENDA SONT PASSÉS' as resultat;
