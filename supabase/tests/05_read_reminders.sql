-- Lu / non lu, notification de message après lecture, rappels. À jouer après 04.
\set ON_ERROR_STOP 1
\set hugo '''aaaaaaaa-0000-0000-0000-000000000001'''
\set camille '''bbbbbbbb-0000-0000-0000-000000000002'''
reset role;
create or replace function pg_temp.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false)
$$;
delete from net.calls;
delete from public.messages;
update public.profiles set messages_read_at = null;

-- Hugo écrit deux messages : une seule notification (Camille n'a rien vu), adressée à Camille seule.
set role authenticated;
select pg_temp.login(:hugo);
insert into public.messages (couple_id, body) select couple_id, 'Premier' from public.couple_members limit 1;
insert into public.messages (couple_id, body) select couple_id, 'Deuxième' from public.couple_members limit 1;
reset role;
do $$ begin
  assert (select count(*) from net.calls) = 1, 'une seule notification tant que rien n''est vu';
  assert (select (body->'user_ids')->>0 from net.calls) = 'bbbbbbbb-0000-0000-0000-000000000002', 'destinataire = Camille';
end $$;

-- Camille ouvre la conversation : lu, même si l'horloge de son téléphone retarde.
set role authenticated;
select pg_temp.login(:camille);
select public.mark_messages_read();
reset role;
do $$ begin
  assert (select messages_read_at from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002')
       >= (select max(created_at) from public.messages), 'lu >= dernier message';
end $$;

-- Hugo réécrit juste après : Camille a tout vu, elle est de nouveau prévenue.
delete from net.calls;
set role authenticated;
select pg_temp.login(:hugo);
insert into public.messages (couple_id, body) select couple_id, 'Troisième' from public.couple_members limit 1;
reset role;
do $$ begin
  assert (select count(*) from net.calls) = 1, 'nouvelle notification après lecture';
end $$;

insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/hugo', 'aaaaaaaa-0000-0000-0000-000000000001', 'k', 'a') on conflict do nothing;
-- Rappel : seul le propriétaire est prévenu, une seule fois.
delete from net.calls;
set role authenticated;
select pg_temp.login(:hugo);
insert into public.tasks (couple_id, title, is_private, inbox, remind_at)
  select couple_id, 'Rappeler le plombier', true, true, now() - interval '1 minute' from public.couple_members limit 1;
insert into public.tasks (couple_id, title, is_private, inbox, remind_at)
  select couple_id, 'Pas encore', true, true, now() + interval '2 hours' from public.couple_members limit 1;
reset role;
select set_config('request.jwt.claims', '', false); -- tâche planifiée : aucun utilisateur connecté
do $$ begin
  assert public.send_due_reminders() = 1, 'un rappel échu';
  assert public.send_due_reminders() = 0, 'pas deux fois';
  assert (select count(*) from net.calls where body->>'title' = 'Rappel' and body->>'body' = 'Rappeler le plombier'
            and (body->'user_ids')->>0 = 'aaaaaaaa-0000-0000-0000-000000000001') = 1, 'rappel pour Hugo seul';
end $$;
-- Reprogrammer un rappel le réarme.
update public.tasks set remind_at = now() - interval '1 minute' where title = 'Rappeler le plombier';
do $$ begin assert public.send_due_reminders() = 1, 'rappel réarmé'; end $$;
select 'TOUS LES TESTS LU / RAPPELS SONT PASSÉS' as resultat;
