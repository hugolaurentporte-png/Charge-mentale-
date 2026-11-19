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

-- Heure de début de crèche : enregistrée, et refusée si après l'heure de fin.
set role authenticated;
select pg_temp.login(:hugo);
select public.save_pickups('[{"day":"2030-01-07","time":"17:30","who":"me"}]'::jsonb);
select public.save_pickup_starts('[{"day":"2030-01-07","start":"08:30"}]'::jsonb);
do $$ begin
  assert (select start_time from public.pickups where day = '2030-01-07') = '08:30', 'début enregistré';
  begin
    perform public.save_pickup_starts('[{"day":"2030-01-07","start":"18:00"}]'::jsonb);
    raise exception 'ECHEC début après fin accepté';
  exception when others then
    if sqlerrm like 'ECHEC%' then raise; end if;
  end;
  assert (select start_time from public.pickups where day = '2030-01-07') = '08:30', 'début inchangé après refus';
end $$;

-- « Je m'en occupe » : Hugo prend une tâche à deux, Camille (abonnée) est prévenue ;
-- puis Hugo lui confie une autre tâche.
reset role;
delete from net.calls;
set role authenticated;
select pg_temp.login(:camille);
insert into public.tasks (couple_id, title) select couple_id, 'Rendre les livres' from public.couple_members limit 1;
insert into public.tasks (couple_id, title) select couple_id, 'Appeler le plombier' from public.couple_members limit 1;
select pg_temp.login(:hugo);
reset role;
delete from net.calls;
set role authenticated;
update public.tasks set assignee_id = :hugo::uuid where title = 'Rendre les livres' and assignee_id is null;
update public.tasks set assignee_id = :camille::uuid where title = 'Appeler le plombier';
update public.tasks set title = 'Rendre les livres !' where title = 'Rendre les livres';
reset role;
do $$ declare b jsonb; begin
  select body into b from net.calls where body->>'title' = 'Tâche prise';
  assert b is not null, 'notification « Tâche prise »';
  assert b->'user_ids' = to_jsonb(array['bbbbbbbb-0000-0000-0000-000000000002'::uuid]), 'envoyée à Camille';
  assert b->>'body' like '%s’occupe de « Rendre les livres »%', b->>'body';
  select body into b from net.calls where body->>'title' = 'Tâche pour toi';
  assert b->>'body' like '%te confie « Appeler le plombier »%', 'tâche confiée';
  assert (select count(*) from net.calls) = 2, 'pas de notification pour un autre changement';
end $$;

-- Vider ma tête : un élément « à trier » est privé, compté dans le résumé, puis trié et partagé.
set role authenticated;
select pg_temp.login(:hugo);
insert into public.tasks (couple_id, title, is_private, inbox, category)
  select couple_id, 'Appeler la mutuelle', true, true, 'administratif' from public.couple_members limit 1;
do $$ begin
  begin
    insert into public.tasks (couple_id, title, is_private, inbox)
      select couple_id, 'Partagé à trier', false, true from public.couple_members limit 1;
    raise exception 'ECHEC à trier partagé accepté';
  exception when others then if sqlerrm like 'ECHEC%' then raise; end if; end;
end $$;
select pg_temp.login(:camille);
do $$ begin
  assert (select count(*) from public.tasks where title = 'Appeler la mutuelle') = 0, 'invisible pour l''autre';
end $$;
reset role;
do $$ begin
  assert public.evening_summary_text('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Paris')::date + 1)
    like '%À trier : 1 élément%', 'rappel de tri dans le résumé';
end $$;
set role authenticated;
select pg_temp.login(:hugo);
update public.tasks set inbox = false, is_private = false, assignee_id = :camille::uuid where title = 'Appeler la mutuelle';
do $$ begin
  begin
    update public.tasks set inbox = true, is_private = true, assignee_id = null where title = 'Appeler la mutuelle';
    raise exception 'ECHEC retour à trier accepté';
  exception when others then if sqlerrm like 'ECHEC%' then raise; end if; end;
  begin
    update public.tasks set is_private = true where title = 'Rendre les livres !';
    raise exception 'ECHEC visibilité modifiée';
  exception when others then if sqlerrm like 'ECHEC%' then raise; end if; end;
end $$;
select pg_temp.login(:camille);
do $$ begin
  assert (select assignee_id from public.tasks where title = 'Appeler la mutuelle') = 'bbbbbbbb-0000-0000-0000-000000000002', 'triée et visible chez Camille';
end $$;

-- Visibilité modifiable par l'auteur seulement.
set role authenticated;
select pg_temp.login(:hugo);
insert into public.tasks (couple_id, title) select couple_id, 'Visite EHPAD' from public.couple_members limit 1;
select pg_temp.login(:camille);
do $$ begin
  begin
    update public.tasks set is_private = true, assignee_id = null where title = 'Visite EHPAD';
    raise exception 'ECHEC visibilité changée par l''autre';
  exception when others then if sqlerrm like 'ECHEC%' then raise; end if; end;
end $$;
select pg_temp.login(:hugo);
update public.tasks set is_private = true, assignee_id = :hugo::uuid where title = 'Visite EHPAD';
select pg_temp.login(:camille);
do $$ begin
  assert (select count(*) from public.tasks where title = 'Visite EHPAD') = 0, 'devenue privée';
end $$;
select pg_temp.login(:hugo);
update public.tasks set is_private = false where title = 'Visite EHPAD';
select pg_temp.login(:camille);
do $$ begin
  assert (select count(*) from public.tasks where title = 'Visite EHPAD') = 1, 'repartagée';
end $$;

-- Un sujet crèche de la semaine peut être supprimé ; les récupérations restent.
set role authenticated;
select pg_temp.login(:hugo);
select public.save_pickups('[{"day":"2030-02-04","time":"17:30","who":"me"}]'::jsonb, '2030-02-04');
delete from public.topics where kind = 'pickup_week' and week_start = '2030-02-04';
do $$ begin
  assert (select count(*) from public.topics where kind = 'pickup_week' and week_start = '2030-02-04') = 0, 'sujet crèche supprimé';
  assert (select count(*) from public.pickups where day = '2030-02-04') = 1, 'récupération conservée';
end $$;

-- Échanges : une rafale de messages = une seule notification ; chacun ne supprime que les siens.
reset role;
delete from net.calls;
set role authenticated;
select pg_temp.login(:hugo);
insert into public.messages (couple_id, body) select couple_id, 'Tu passes à la pharmacie ?' from public.couple_members limit 1;
insert into public.messages (couple_id, body) select couple_id, 'Et du pain aussi' from public.couple_members limit 1;
select pg_temp.login(:camille);
delete from public.messages where body = 'Tu passes à la pharmacie ?';
do $$ begin
  assert (select count(*) from public.messages) = 2, 'messages visibles, pas supprimables par l''autre';
end $$;
reset role;
do $$ declare b jsonb; begin
  assert (select count(*) from net.calls) = 1, format('1 notification attendue, %s', (select count(*) from net.calls));
  select body into b from net.calls;
  assert b->>'body' = 'Tu passes à la pharmacie ?', b->>'body';
  assert b->>'url' = '/echanges/', 'lien vers les échanges';
end $$;
-- Note gardée : hors du rappel de tri.
set role authenticated;
select pg_temp.login(:hugo);
insert into public.tasks (couple_id, title, is_private, inbox, is_note)
  select couple_id, 'Penser à respirer', true, true, true from public.couple_members limit 1;
reset role;
do $$ begin
  assert coalesce(public.evening_summary_text('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Paris')::date + 1), '')
    not like '%À trier%', 'une note gardée ne compte pas à trier';
end $$;
reset role;
select 'TOUS LES TESTS RETRAIT / ANNULER SONT PASSÉS' as resultat;
