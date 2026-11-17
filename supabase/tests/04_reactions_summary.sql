-- Réactions et résumé du soir. À jouer après 03.
\set ON_ERROR_STOP 1
\set hugo '''aaaaaaaa-0000-0000-0000-000000000001'''
\set camille '''bbbbbbbb-0000-0000-0000-000000000002'''
reset role;
delete from net.calls;
create or replace function pg_temp.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false)
$$;
set role authenticated;

-- Hugo réagit 👍 à la tâche partagée « Pharmacie » assignée à Camille ; puis change pour ❤️.
select pg_temp.login(:hugo);
insert into public.task_reactions (task_id, emoji) select id, '👍' from public.tasks where title = 'Pharmacie';
update public.task_reactions set emoji = '❤️';
do $$ begin
  begin
    insert into public.task_reactions (task_id, emoji) select id, '👍' from public.tasks where title = 'Surprise';
    raise exception 'ECHEC réaction sur tâche privée';
  exception when insufficient_privilege or check_violation then null; end;
end $$;
select pg_temp.login(:camille);
do $$ begin
  assert (select emoji from public.task_reactions) = '❤️', 'Camille voit la réaction';
  delete from public.task_reactions; -- ne supprime rien : pas la sienne
end $$;

reset role;
do $$ declare b jsonb; s text; n int; begin
  assert (select count(*) from public.task_reactions) = 1, 'réaction intacte';
  select body into b from net.calls order by id limit 1;
  assert b->>'body' = 'Hugo a réagi 👍 à « Pharmacie »', coalesce(b->>'body', 'rien');
  assert b->'user_ids' = jsonb_build_array('bbbbbbbb-0000-0000-0000-000000000002'), 'pour Camille';

  -- Résumé du soir (tâche planifiée : aucun utilisateur connecté).
  perform set_config('request.jwt.claims', '', false);
  delete from net.calls;
  s := public.evening_summary_text('bbbbbbbb-0000-0000-0000-000000000002',
        (select due_date from public.tasks where title = 'Pharmacie'));
  assert s like '%1 tâche : Pharmacie%' or s like '%tâches : %Pharmacie%', coalesce(s, 'null');
  n := public.send_evening_summaries((select due_date from public.tasks where title = 'Pharmacie'));
  assert n = 1, format('1 résumé attendu (seule Camille est abonnée), %s', n);
  select body into b from net.calls order by id desc limit 1;
  assert b->>'title' = 'Demain', 'titre';
  -- Désactivé : plus rien.
  update public.profiles set evening_summary = false where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  assert public.send_evening_summaries((select due_date from public.tasks where title = 'Pharmacie')) = 0, 'désactivé';
  assert public.evening_summary_text('bbbbbbbb-0000-0000-0000-000000000002', '2030-01-01') is null, 'rien prévu';
end $$;
select 'TOUS LES TESTS RÉACTIONS / RÉSUMÉ SONT PASSÉS' as resultat;

-- Sujet « juste moi » : invisible pour l'autre, pas de passation, tâches privées seulement.
reset role;
delete from net.calls;
set role authenticated;
select pg_temp.login(:hugo);
insert into public.topics (couple_id, title, is_private) select couple_id, 'Mutuelle perso', true from public.couple_members limit 1;
insert into public.tasks (couple_id, title, is_private, topic_id)
  select couple_id, 'Envoyer le formulaire', true, (select id from public.topics where title = 'Mutuelle perso') from public.couple_members limit 1;
do $$ begin
  assert (select owner_id from public.topics where title = 'Mutuelle perso') = 'aaaaaaaa-0000-0000-0000-000000000001', 'Hugo responsable';
  begin
    insert into public.tasks (couple_id, title, topic_id)
      select couple_id, 'Partagée', (select id from public.topics where title = 'Mutuelle perso') from public.couple_members limit 1;
    raise exception 'ECHEC tâche partagée sur sujet privé';
  exception when raise_exception then
    if sqlerrm like 'ECHEC%' then raise; end if;
  end;
  begin
    perform public.propose_topic((select id from public.topics where title = 'Mutuelle perso'));
    raise exception 'ECHEC passation sujet privé';
  exception when raise_exception then
    if sqlerrm like 'ECHEC%' then raise; end if;
  end;
end $$;
select pg_temp.login(:camille);
do $$ begin
  assert (select count(*) from public.topics where title = 'Mutuelle perso') = 0, 'Camille voit le sujet privé';
  assert (select count(*) from public.tasks where title = 'Envoyer le formulaire') = 0, 'Camille voit la tâche';
  update public.topics set title = 'pirate' where title = 'Mutuelle perso';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.topics where title = 'Mutuelle perso') = 1, 'sujet intact';
  assert (select count(*) from net.calls) = 0, 'aucune notification pour un sujet privé';
end $$;
select 'TOUS LES TESTS SUJETS PRIVÉS SONT PASSÉS' as resultat;

-- Se retirer de l'organisation d'une semaine ; annuler « terminé » sur une récurrente.
set role authenticated;
select pg_temp.login(:hugo);
do $$ declare w uuid; begin
  select id into w from public.topics where kind = 'pickup_week' and owner_id = auth.uid() limit 1;
  assert w is not null, 'Hugo organise une semaine';
  perform public.release_topic(w);
  assert (select owner_id from public.topics where id = w) is null, 'plus d''organisateur';
end $$;
insert into public.tasks (couple_id, title, due_date, recurrence)
  select couple_id, 'Arroser', (now() at time zone 'Europe/Paris')::date, 'daily' from public.couple_members limit 1;
update public.tasks set done = true where title = 'Arroser';
update public.tasks set done = false where title = 'Arroser' and recur_from is null;
do $$ begin
  assert (select count(*) from public.tasks where title = 'Arroser') = 1, 'occurrence retirée après annulation';
end $$;

-- Agenda : une tâche partagée de Camille apparaît aussi chez Hugo, avec son prénom ;
-- une tâche privée reste chez son propriétaire.
insert into public.tasks (couple_id, title, due_date, due_time, assignee_id)
  select couple_id, 'Resto copines', (now() at time zone 'Europe/Paris')::date + 1, '19:30', :camille::uuid from public.couple_members limit 1;
insert into public.tasks (couple_id, title, due_date, due_time, is_private)
  select couple_id, 'Surprise', (now() at time zone 'Europe/Paris')::date + 1, '12:00', true from public.couple_members limit 1;
reset role;
create temp table if not exists ctx (k text primary key, v text);
grant all on ctx to public;
set role authenticated;
select pg_temp.login(:hugo);
insert into ctx select 'cal_h', public.my_calendar_token();
select pg_temp.login(:camille);
insert into ctx select 'cal_c', public.my_calendar_token();
reset role;
do $$ declare h text; c text; begin
  h := public.agenda_ics((select v from ctx where k = 'cal_h'));
  c := public.agenda_ics((select v from ctx where k = 'cal_c'));
  assert h like '%SUMMARY:Resto copines (%', 'tâche de l''autre visible avec son prénom';
  assert h like '%SUMMARY:Surprise%', 'ma tâche privée visible';
  assert c like '%SUMMARY:Resto copines' || E'\r\n' || '%', 'ma tâche sans prénom';
  assert c not like '%Surprise%', 'tâche privée de l''autre absente';
end $$;
reset role;
select 'TOUS LES TESTS RETRAIT / ANNULER SONT PASSÉS' as resultat;
