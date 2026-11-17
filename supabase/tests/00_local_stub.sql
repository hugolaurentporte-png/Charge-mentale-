-- Simule le strict nécessaire de Supabase (schéma auth, rôles, publication)
-- pour tester les migrations et la RLS sur un Postgres nu. Ne pas exécuter sur Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create publication supabase_realtime;

-- Vault et pg_net simulés : les appels HTTP sont journalisés dans net.calls.
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$
  insert into net.calls (url, body, headers) values (url, body, headers) returning id
$$;
grant usage on schema net to authenticated;
grant all on net.calls to authenticated;
grant usage, select on sequence net.calls_id_seq to authenticated;
