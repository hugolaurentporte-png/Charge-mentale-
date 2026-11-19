-- Parcours à deux comptes + contrôle d'accès, exécutés avec le rôle
-- « authenticated » comme le ferait l'API Supabase. Toute assertion qui
-- échoue interrompt le script (ON_ERROR_STOP).
\set ON_ERROR_STOP 1
\set hugo '''aaaaaaaa-0000-0000-0000-000000000001'''
\set camille '''bbbbbbbb-0000-0000-0000-000000000002'''
\set eve '''cccccccc-0000-0000-0000-000000000003'''

insert into auth.users (id, email) values
  (:hugo, 'hugo@test'), (:camille, 'camille@test'), (:eve, 'eve@test');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;

create or replace function pg_temp.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false)
$$;

set role authenticated;

-- 1. Hugo crée l'espace et invite Camille --------------------------------
select pg_temp.login(:hugo);
select public.create_couple('Hugo') is not null as couple_cree;
insert into ctx select 'token', public.create_invite();

-- Eve (inconnue) ne voit rien
select pg_temp.login(:eve);
do $$ begin
  assert (select count(*) from public.couples) = 0, 'Eve voit un couple';
  assert (select count(*) from public.lists) = 0, 'Eve voit des listes';
  assert (select count(*) from public.invites) = 0, 'Eve voit les invitations';
end $$;

-- Camille accepte le lien ; le lien ne sert qu'une fois
select pg_temp.login(:camille);
select public.accept_invite((select v from ctx where k = 'token'), 'Camille') is not null as camille_rejoint;
select pg_temp.login(:eve);
do $$ begin
  perform public.accept_invite((select v from ctx where k = 'token'), 'Eve');
  raise exception 'ECHEC : lien réutilisé';
exception when others then
  assert sqlerrm like '%plus valable%', sqlerrm;
end $$;
select pg_temp.login(:hugo);
do $$ begin
  perform public.create_invite();
  raise exception 'ECHEC : troisième invitation';
exception when others then
  assert sqlerrm like '%deux membres%', sqlerrm;
end $$;

-- 2. Organiser trois jours de crèche depuis le même écran ---------------
-- Semaine du lundi 16/11/2026. Hugo prend en charge l'organisation.
select public.save_pickups('[
  {"day":"2026-11-17","time":"17:30","who":"me"},
  {"day":"2026-11-18","time":"18:00","who":"partner"},
  {"day":"2026-11-19","time":"16:45","who":"undecided"},
  {"day":"2026-11-20","time":"17:30","who":"undecided"}
]'::jsonb, '2026-11-18');
do $$ begin
  assert (select count(*) from public.pickups) = 4, 'jours enregistrés';
  assert (select responsible_id from public.pickups where day = '2026-11-18')
         = 'bbbbbbbb-0000-0000-0000-000000000002', 'mercredi = Camille';
  assert (select owner_id from public.topics where kind = 'pickup_week')
         = 'aaaaaaaa-0000-0000-0000-000000000001', 'Hugo organise la semaine';
  assert (select week_start from public.topics where kind = 'pickup_week') = '2026-11-16', 'lundi';
end $$;

-- Une seule récupération par jour : réenregistrer met à jour, ne duplique pas
select public.save_pickups('[{"day":"2026-11-17","time":"17:45","who":"me"}]'::jsonb);
do $$ begin
  assert (select count(*) from public.pickups where day = '2026-11-17') = 1, 'doublon';
  assert (select time from public.pickups where day = '2026-11-17') = '17:45', 'heure ajustée';
end $$;
-- « Pas de crèche »
select public.save_pickups('[{"day":"2026-11-21","time":"10:00","who":"me"}]'::jsonb);
select public.save_pickups('[{"day":"2026-11-21","none":true}]'::jsonb);
do $$ begin assert (select count(*) from public.pickups where day = '2026-11-21') = 0, 'pas de crèche'; end $$;

-- Écriture directe interdite (validation serveur obligatoire)
update public.pickups set responsible_id = auth.uid() where day = '2026-11-19';
do $$ begin
  assert (select responsible_id from public.pickups where day = '2026-11-19') is null,
    'update direct contourne la RLS';
end $$;

-- 3. Prendre un créneau libre : le premier l'emporte -------------------
select pg_temp.login(:camille);
select (public.claim_pickup((select id from public.pickups where day = '2026-11-19'))->>'ok')::boolean as camille_prend_jeudi;
select pg_temp.login(:hugo);
do $$ declare r json; begin
  r := public.claim_pickup((select id from public.pickups where day = '2026-11-19'));
  assert (r->>'ok')::boolean = false, 'le second ne doit pas écraser';
  assert r->>'responsible_id' = 'bbbbbbbb-0000-0000-0000-000000000002', 'le second voit le résultat';
end $$;

-- Vendredi reste à couvrir et remonte chez l'organisateur (Hugo)
do $$ begin
  assert exists (
    select 1 from public.topics t join public.pickups p
      on p.couple_id = t.couple_id and p.day between t.week_start and t.week_start + 6
    where t.kind = 'pickup_week' and t.owner_id = auth.uid()
      and p.responsible_id is null and p.day = '2026-11-20'
  ), 'vendredi doit remonter dans les suivis de Hugo';
end $$;

-- 4. Relais : demande, refus, annulation, acceptation -------------------
-- Hugo (responsable mardi) demande un relais
insert into ctx select 'r1', public.request_relay((select id from public.pickups where day = '2026-11-17'));
-- Camille ne peut pas demander un relais sur un créneau qui n'est pas le sien
select pg_temp.login(:camille);
do $$ begin
  perform public.request_relay((select id from public.pickups where day = '2026-11-17'));
  raise exception 'ECHEC';
exception when others then assert sqlerrm like '%responsable%' or sqlerrm like '%attente%', sqlerrm;
end $$;
-- Le nom ne change pas tant que Camille n'a pas accepté
do $$ begin
  assert (select responsible_id from public.pickups where day = '2026-11-17')
    = 'aaaaaaaa-0000-0000-0000-000000000001', 'nom changé trop tôt';
end $$;
-- Camille refuse
select public.respond_relay((select v::uuid from ctx where k = 'r1'), false)->>'status' as refus;
-- Nouvelle demande, annulée par Hugo
select pg_temp.login(:hugo);
insert into ctx select 'r2', public.request_relay((select id from public.pickups where day = '2026-11-17'));
select public.cancel_relay((select v::uuid from ctx where k = 'r2'));
select pg_temp.login(:camille);
do $$ declare r json; begin
  r := public.respond_relay((select v::uuid from ctx where k = 'r2'), true);
  assert (r->>'ok')::boolean = false, 'demande annulée acceptée';
end $$;
-- Troisième demande, acceptée
select pg_temp.login(:hugo);
insert into ctx select 'r3', public.request_relay((select id from public.pickups where day = '2026-11-17'));
-- Hugo ne peut pas accepter sa propre demande
do $$ begin
  perform public.respond_relay((select v::uuid from ctx where k = 'r3'), true);
  raise exception 'ECHEC';
exception when others then assert sqlerrm like '%adressée%', sqlerrm;
end $$;
select pg_temp.login(:camille);
select public.respond_relay((select v::uuid from ctx where k = 'r3'), true)->>'status' as acceptation;
do $$ begin
  assert (select responsible_id from public.pickups where day = '2026-11-17')
    = 'bbbbbbbb-0000-0000-0000-000000000002', 'relais non appliqué';
end $$;

-- 5. Sujet « Banque » : saisie, prise en charge, relance jeudi ---------
select pg_temp.login(:hugo);
insert into public.topics (couple_id, title) values (public.my_couple_id(), 'Banque');
-- Hugo ne peut pas désigner Camille directement
do $$ begin
  update public.topics set owner_id = 'bbbbbbbb-0000-0000-0000-000000000002' where title = 'Banque';
  raise exception 'ECHEC';
exception when others then assert sqlerrm like '%responsable%', sqlerrm;
end $$;
select pg_temp.login(:camille);
select (public.claim_topic((select id from public.topics where title = 'Banque'))->>'ok')::boolean as camille_prend_banque;
update public.topics set next_action = 'En attente de la banque · relancer', next_action_date = '2026-11-19'
  where title = 'Banque';
-- Hugo ne peut pas modifier la prochaine action d'un sujet suivi par Camille
select pg_temp.login(:hugo);
do $$ begin
  update public.topics set next_action = 'x' where title = 'Banque';
  raise exception 'ECHEC';
exception when others then assert sqlerrm like '%responsable%', sqlerrm;
end $$;
-- Jeudi : seule Camille a l'action dans ses suivis
do $$ begin
  assert not exists (select 1 from public.topics where owner_id = auth.uid()
    and status = 'open' and next_action_date <= '2026-11-19' and kind = 'general'),
    'Hugo ne doit rien avoir à relancer';
end $$;
select pg_temp.login(:camille);
do $$ begin
  assert exists (select 1 from public.topics where owner_id = auth.uid()
    and status = 'open' and next_action_date <= '2026-11-19'), 'Camille doit relancer';
end $$;

-- 6. Passation : le responsable reste jusqu'à l'acceptation ------------
select public.propose_topic((select id from public.topics where title = 'Banque'));
do $$ begin
  assert (select owner_id from public.topics where title = 'Banque')
    = 'bbbbbbbb-0000-0000-0000-000000000002', 'responsable changé avant acceptation';
end $$;
select pg_temp.login(:hugo);
select (public.respond_topic((select id from public.topics where title = 'Banque'), true)->>'ok')::boolean as hugo_accepte;
do $$ begin
  assert (select owner_id from public.topics where title = 'Banque')
    = 'aaaaaaaa-0000-0000-0000-000000000001', 'passation non appliquée';
end $$;
-- Clôture par n'importe quel membre
select pg_temp.login(:camille);
update public.topics set status = 'closed' where title = 'Banque';
do $$ begin assert (select closed_at from public.topics where title = 'Banque') is not null, 'clôture'; end $$;

-- 7. Tâche « Appeler la banque » -> reporter -> rendez-vous ------------
insert into public.tasks (couple_id, title, due_date) values (public.my_couple_id(), 'Appeler la banque', '2026-11-17');
update public.tasks set due_date = '2026-11-18' where title = 'Appeler la banque';
insert into public.appointments (couple_id, title, day, time, participants, task_id)
  select public.my_couple_id(), 'Appeler la banque', '2026-11-20', '10:00',
         array[auth.uid()], id from public.tasks where title = 'Appeler la banque';
update public.tasks set done = true where title = 'Appeler la banque';
do $$ begin
  assert (select done_at from public.tasks where title = 'Appeler la banque') is not null, 'terminée';
  assert (select count(*) from public.appointments) = 1, 'rdv';
end $$;
-- Participant étranger refusé
do $$ begin
  insert into public.appointments (couple_id, title, day, time, participants)
    values (public.my_couple_id(), 'x', '2026-11-20', '10:00', array['cccccccc-0000-0000-0000-000000000003'::uuid]);
  raise exception 'ECHEC';
exception when others then assert sqlerrm like '%Participant%', sqlerrm;
end $$;

-- 8. Listes : lait / ruban, coché par l'autre compte -------------------
select pg_temp.login(:hugo);
insert into public.list_items (list_id, label, quantity)
  select id, 'Lait', '2 L' from public.lists where name = 'Courses';
insert into public.list_items (list_id, label)
  select id, 'Ruban' from public.lists where name = 'Bricolage';
select pg_temp.login(:camille);
update public.list_items set checked = true where label = 'Lait';
do $$ begin assert (select checked from public.list_items where label = 'Lait'), 'coché'; end $$;

-- 9. Idée cadeau partagée + surprise privée ----------------------------
insert into public.list_items (list_id, label, recipient, occasion, gift_status)
  select id, 'Livre de cuisine', 'Mamie', 'Noël', 'idea' from public.lists where name = 'Idées cadeaux';
select pg_temp.login(:hugo);
insert into public.list_items (list_id, label, recipient, occasion, gift_status)
  select id, 'Week-end surprise', 'Camille', 'Anniversaire', 'idea'
  from public.lists where name = 'Mes surprises' and owner_id = auth.uid();
insert into public.tasks (couple_id, title, is_private, due_date)
  values (public.my_couple_id(), 'Réserver le week-end', true, '2026-11-17');
insert into public.goals (title) values ('Courir 10 km');
insert into ctx select 'surprise_list', id::text from public.lists where name = 'Mes surprises' and owner_id = auth.uid();
insert into ctx select 'surprise_item', id::text from public.list_items where label = 'Week-end surprise';

select pg_temp.login(:camille);
do $$ begin
  assert (select count(*) from public.list_items where label = 'Week-end surprise') = 0, 'surprise visible';
  assert (select count(*) from public.lists where id = (select v::uuid from ctx where k = 'surprise_list')) = 0, 'liste privée visible';
  assert (select count(*) from public.tasks where title = 'Réserver le week-end') = 0, 'tâche privée visible';
  assert (select count(*) from public.goals) = 0, 'objectif visible';
  assert (select count(*) from public.list_items where label = 'Livre de cuisine') = 1, 'idée partagée invisible';
end $$;
-- Ni écriture ni suppression possibles sur la surprise
update public.list_items set label = 'pirate' where id = (select v::uuid from ctx where k = 'surprise_item');
delete from public.list_items where id = (select v::uuid from ctx where k = 'surprise_item');
do $$ begin
  insert into public.list_items (list_id, label) values ((select v::uuid from ctx where k = 'surprise_list'), 'intrus');
  raise exception 'ECHEC';
exception when insufficient_privilege then null;
end $$;
-- Ajout direct dans le couple de quelqu'un d'autre : refusé
select pg_temp.login(:eve);
do $$ begin
  insert into public.tasks (couple_id, title) values ((select couple_id from public.couple_members limit 1), 'x');
  raise exception 'ECHEC';
exception when others then assert sqlerrm not like 'ECHEC', sqlerrm;
end $$;
do $$ begin
  assert (select count(*) from public.list_items) = 0, 'Eve voit des articles';
  assert (select count(*) from public.pickups) = 0, 'Eve voit le planning';
  assert (select count(*) from public.topics) = 0, 'Eve voit les sujets';
end $$;

reset role;
do $$ begin
  assert (select label from public.list_items where label = 'Week-end surprise') = 'Week-end surprise',
    'la surprise a été modifiée par le partenaire';
end $$;
select 'TOUS LES TESTS SQL SONT PASSÉS' as resultat;
