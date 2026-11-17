-- Notifications : qui est prévenu, de quoi, et jamais pour le privé.
-- À jouer après 01_scenarios.sql (mêmes comptes, même couple).
\set ON_ERROR_STOP 1
\set hugo '''aaaaaaaa-0000-0000-0000-000000000001'''
\set camille '''bbbbbbbb-0000-0000-0000-000000000002'''
reset role;
insert into vault.decrypted_secrets values ('notify_url', 'http://fn/notify'), ('notify_secret', 's3cret'), ('vapid_public', 'PUB');
delete from net.calls;
update public.list_items set created_at = now() - interval '1 hour';
create or replace function pg_temp.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false)
$$;
set role authenticated;

-- Camille s'abonne ; Hugo non.
select pg_temp.login(:camille);
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push/camille', 'k', 'a');
do $$ begin assert public.push_public_key() = 'PUB', 'clé publique'; end $$;

select pg_temp.login(:hugo);
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 0, 'Hugo voit l’abonnement de Camille';
  begin perform public.push_config(); raise exception 'ECHEC config lisible';
  exception when insufficient_privilege then null; end;
end $$;

-- Hugo ajoute une tâche partagée pour Camille avec heure, une privée, un article.
insert into public.tasks (couple_id, title, assignee_id, due_date, due_time)
  select couple_id, 'Pharmacie', :camille, (now() at time zone 'Europe/Paris')::date + 1, '18:15' from public.couple_members limit 1;
insert into public.tasks (couple_id, title, is_private, due_date) select couple_id, 'Surprise', true, current_date from public.couple_members limit 1;
insert into public.list_items (list_id, label) select id, 'Pain' from public.lists where name = 'Courses' and not is_private;
insert into public.list_items (list_id, label) select id, 'Beurre' from public.lists where name = 'Courses' and not is_private;

-- Camille ajoute un sujet : Hugo n'a pas d'abonnement, donc rien.
select pg_temp.login(:camille);
insert into public.topics (couple_id, title) select couple_id, 'Assurance' from public.couple_members limit 1;

reset role;
do $$
declare n int; b jsonb;
begin
  select count(*) into n from net.calls;
  assert n = 2, format('2 notifications attendues, %s reçues', n);
  select body into b from net.calls order by id limit 1;
  assert b->>'body' = 'Hugo a ajouté « Pharmacie » pour toi, demain à 18h15', b->>'body';
  assert b->'user_ids' = jsonb_build_array('bbbbbbbb-0000-0000-0000-000000000002'), 'destinataire';
  select body into b from net.calls order by id desc limit 1;
  assert b->>'title' = 'Courses' and b->>'body' = 'Hugo a ajouté « Pain »', b::text;
  assert (select headers->>'x-notify-secret' from net.calls limit 1) = 's3cret', 'secret';
end $$;
select 'TOUS LES TESTS PUSH SONT PASSÉS' as resultat;
