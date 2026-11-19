-- V1 « À deux » : schéma, RLS et fonctions serveur.
-- Toutes les règles sensibles (prise d'un créneau, relais, passation d'un
-- sujet, invitation) passent par des fonctions SECURITY DEFINER qui vérifient
-- l'appartenance au couple. Les tables n'exposent en écriture directe que ce
-- qui ne pose pas de problème de concurrence ou de confidentialité.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Notre espace',
  child_name text not null default 'Juliette',
  -- « Je la récupère » / « Je le récupère »
  child_pronoun text not null default 'la' check (child_pronoun in ('la', 'le')),
  pickup_label text not null default 'Récupération crèche',
  timezone text not null default 'Europe/Paris',
  default_pickup_time time not null default '17:30',
  -- 1 = lundi … 7 = dimanche (ISO)
  usual_days smallint[] not null default '{1,2,3,4,5}',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  color text not null default '#4f46e5',
  created_at timestamptz not null default now()
);

create table public.couple_members (
  couple_id uuid not null references public.couples (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  -- V1 : un seul espace couple par compte
  unique (user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  token text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked boolean not null default false
);

-- Sujets partagés : un responsable du suivi, une prochaine action datée,
-- une passation éventuelle en attente.
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  kind text not null default 'general' check (kind in ('general', 'pickup_week')),
  week_start date,
  owner_id uuid references auth.users (id) on delete set null,
  proposed_to uuid references auth.users (id) on delete set null,
  proposed_by uuid references auth.users (id) on delete set null,
  next_action text check (next_action is null or length(next_action) <= 200),
  next_action_date date,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'pickup_week') = (week_start is not null))
);
create unique index topics_one_pickup_week
  on public.topics (couple_id, week_start) where kind = 'pickup_week';

-- Une seule récupération par jour pour l'enfant du couple (V1).
create table public.pickups (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  day date not null,
  time time not null,
  responsible_id uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (couple_id, day)
);

create table public.relay_requests (
  id uuid primary key default gen_random_uuid(),
  pickup_id uuid not null references public.pickups (id) on delete cascade,
  couple_id uuid not null references public.couples (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index relay_one_pending
  on public.relay_requests (pickup_id) where status = 'pending';

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  assignee_id uuid references auth.users (id) on delete set null,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  is_private boolean not null default false,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  created_at timestamptz not null default now(),
  check (not is_private or assignee_id is null or assignee_id = owner_id),
  check (not is_private or topic_id is null)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  day date not null,
  time time not null,
  participants uuid[] not null check (cardinality(participants) between 1 and 2),
  task_id uuid references public.tasks (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null default 'items' check (kind in ('items', 'gifts')),
  is_private boolean not null default false,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.list_favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  primary key (user_id, list_id)
);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 200),
  quantity text check (quantity is null or length(quantity) <= 40),
  checked boolean not null default false,
  -- Champs « Idées cadeaux »
  recipient text check (recipient is null or length(recipient) <= 60),
  occasion text check (occasion is null or length(occasion) <= 60),
  note text check (note is null or length(note) <= 500),
  url text check (url is null or length(url) <= 500),
  gift_status text check (gift_status is null or gift_status in ('idea', 'chosen', 'bought')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  due_date date,
  achieved boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.tasks (couple_id, due_date);
create index on public.pickups (couple_id, day);
create index on public.appointments (couple_id, day);
create index on public.list_items (list_id);
create index on public.topics (couple_id, status);

-- ---------------------------------------------------------------------------
-- Fonctions d'aide (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------------

create or replace function public.my_couple_id()
returns uuid language sql stable security definer set search_path = public as $$
  select couple_id from public.couple_members where user_id = auth.uid()
$$;

create or replace function public.partner_of(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m2.user_id from public.couple_members m1
  join public.couple_members m2 on m2.couple_id = m1.couple_id and m2.user_id <> m1.user_id
  where m1.user_id = p_user
$$;

create or replace function public.is_couple_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = public.my_couple_id() and user_id = p_user
  )
$$;

create or replace function public.can_access_list(p_list uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lists l
    where l.id = p_list
      and l.couple_id = public.my_couple_id()
      and (not l.is_private or l.owner_id = auth.uid())
  )
$$;

-- ---------------------------------------------------------------------------
-- Triggers de protection
-- ---------------------------------------------------------------------------

-- Les champs de responsabilité d'un sujet ne changent que via les fonctions
-- dédiées. La prochaine action n'est modifiable que par le responsable.
create or replace function public.topics_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.rpc', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if new.couple_id is distinct from old.couple_id
     or new.kind is distinct from old.kind
     or new.week_start is distinct from old.week_start
     or new.created_by is distinct from old.created_by
     or new.owner_id is distinct from old.owner_id
     or new.proposed_to is distinct from old.proposed_to
     or new.proposed_by is distinct from old.proposed_by then
    raise exception 'Utilise les actions « Je m''en occupe » ou « Proposer » pour changer le responsable';
  end if;
  if (new.next_action is distinct from old.next_action
      or new.next_action_date is distinct from old.next_action_date)
     and old.owner_id is distinct from auth.uid() then
    raise exception 'Seul le responsable du sujet peut fixer la prochaine action';
  end if;
  if new.status = 'closed' and old.status = 'open' then
    new.closed_at := now();
    new.proposed_to := null;
    new.proposed_by := null;
  elsif new.status = 'open' then
    new.closed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger topics_guard before update on public.topics
  for each row execute function public.topics_guard();

create or replace function public.topics_insert_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.rpc', true), '') <> 'on' then
    new.proposed_to := null;
    new.proposed_by := null;
    new.created_by := auth.uid();
    if new.owner_id is not null and new.owner_id <> auth.uid() then
      raise exception 'Propose le sujet à ton partenaire : il deviendra responsable s''il accepte';
    end if;
    if new.kind <> 'general' then
      raise exception 'Les sujets crèche se créent depuis « Organiser les récupérations »';
    end if;
  end if;
  return new;
end $$;

create trigger topics_insert_guard before insert on public.topics
  for each row execute function public.topics_insert_guard();

-- Une tâche ou une liste ne change ni de propriétaire ni de visibilité.
create or replace function public.immutable_privacy_guard()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id
     or new.is_private is distinct from old.is_private
     or new.couple_id is distinct from old.couple_id then
    raise exception 'Le propriétaire et la visibilité ne peuvent pas être modifiés';
  end if;
  return new;
end $$;

create trigger tasks_privacy_guard before update on public.tasks
  for each row execute function public.immutable_privacy_guard();
create trigger lists_privacy_guard before update on public.lists
  for each row execute function public.immutable_privacy_guard();

create or replace function public.tasks_done_at()
returns trigger language plpgsql as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end $$;
create trigger tasks_done_at before insert or update on public.tasks
  for each row execute function public.tasks_done_at();

-- Participants d'un rendez-vous / responsable d'une tâche : membres du couple.
create or replace function public.members_only_guard()
returns trigger language plpgsql as $$
declare u uuid;
begin
  if tg_table_name = 'tasks' then
    if new.assignee_id is not null and not exists (
      select 1 from public.couple_members where couple_id = new.couple_id and user_id = new.assignee_id
    ) then raise exception 'Responsable inconnu'; end if;
    if new.topic_id is not null and not exists (
      select 1 from public.topics where id = new.topic_id and couple_id = new.couple_id
    ) then raise exception 'Sujet inconnu'; end if;
  elsif tg_table_name = 'appointments' then
    foreach u in array new.participants loop
      if not exists (
        select 1 from public.couple_members where couple_id = new.couple_id and user_id = u
      ) then raise exception 'Participant inconnu'; end if;
    end loop;
    if new.task_id is not null and not exists (
      select 1 from public.tasks where id = new.task_id and couple_id = new.couple_id and not is_private
    ) then raise exception 'Tâche inconnue'; end if;
  end if;
  return new;
end $$;
create trigger tasks_members_guard before insert or update on public.tasks
  for each row execute function public.members_only_guard();
create trigger appointments_members_guard before insert or update on public.appointments
  for each row execute function public.members_only_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.couples enable row level security;
alter table public.profiles enable row level security;
alter table public.couple_members enable row level security;
alter table public.invites enable row level security;
alter table public.topics enable row level security;
alter table public.pickups enable row level security;
alter table public.relay_requests enable row level security;
alter table public.tasks enable row level security;
alter table public.appointments enable row level security;
alter table public.lists enable row level security;
alter table public.list_favorites enable row level security;
alter table public.list_items enable row level security;
alter table public.goals enable row level security;

-- Couple : lecture et réglages par les deux membres. Création via create_couple().
create policy couples_select on public.couples for select to authenticated
  using (id = public.my_couple_id());
create policy couples_update on public.couples for update to authenticated
  using (id = public.my_couple_id()) with check (id = public.my_couple_id());

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or id = public.partner_of(auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy members_select on public.couple_members for select to authenticated
  using (couple_id = public.my_couple_id());

create policy invites_select on public.invites for select to authenticated
  using (couple_id = public.my_couple_id());

-- Données partagées : lecture/écriture par les membres du couple.
create policy topics_select on public.topics for select to authenticated
  using (couple_id = public.my_couple_id());
create policy topics_insert on public.topics for insert to authenticated
  with check (couple_id = public.my_couple_id());
create policy topics_update on public.topics for update to authenticated
  using (couple_id = public.my_couple_id()) with check (couple_id = public.my_couple_id());
create policy topics_delete on public.topics for delete to authenticated
  using (couple_id = public.my_couple_id() and kind = 'general');

-- Récupérations et relais : lecture seule ; écriture via fonctions serveur.
create policy pickups_select on public.pickups for select to authenticated
  using (couple_id = public.my_couple_id());
create policy relay_select on public.relay_requests for select to authenticated
  using (couple_id = public.my_couple_id());

-- Tâches : partagées pour le couple, privées pour leur propriétaire seul.
create policy tasks_select on public.tasks for select to authenticated
  using (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (couple_id = public.my_couple_id() and owner_id = auth.uid());
create policy tasks_update on public.tasks for update to authenticated
  using (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()))
  with check (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()));
create policy tasks_delete on public.tasks for delete to authenticated
  using (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()));

create policy appointments_all on public.appointments for all to authenticated
  using (couple_id = public.my_couple_id()) with check (couple_id = public.my_couple_id());

create policy lists_select on public.lists for select to authenticated
  using (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()));
create policy lists_insert on public.lists for insert to authenticated
  with check (couple_id = public.my_couple_id() and owner_id = auth.uid());
create policy lists_update on public.lists for update to authenticated
  using (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()))
  with check (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()));
create policy lists_delete on public.lists for delete to authenticated
  using (couple_id = public.my_couple_id() and (not is_private or owner_id = auth.uid()));

create policy favorites_all on public.list_favorites for all to authenticated
  using (user_id = auth.uid() and public.can_access_list(list_id))
  with check (user_id = auth.uid() and public.can_access_list(list_id));

create policy items_all on public.list_items for all to authenticated
  using (public.can_access_list(list_id)) with check (public.can_access_list(list_id));

create policy goals_all on public.goals for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Fonctions serveur (RPC)
-- ---------------------------------------------------------------------------

create or replace function public.require_couple()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  c := public.my_couple_id();
  if c is null then raise exception 'Aucun espace couple'; end if;
  return c;
end $$;

create or replace function public.seed_lists(p_couple uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.lists (couple_id, name, kind, is_private, owner_id) values
    (p_couple, 'Mes surprises', 'gifts', true, p_user);
$$;

create or replace function public.create_couple(p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid; u uuid := auth.uid();
begin
  if u is null then raise exception 'Connexion requise'; end if;
  if exists (select 1 from public.couple_members where user_id = u) then
    raise exception 'Tu fais déjà partie d''un espace couple';
  end if;
  insert into public.profiles (id, display_name, color) values (u, trim(p_display_name), '#4f46e5')
    on conflict (id) do update set display_name = excluded.display_name, color = '#4f46e5';
  insert into public.couples (created_by) values (u) returning id into c;
  insert into public.couple_members (couple_id, user_id) values (c, u);
  insert into public.lists (couple_id, name, kind, owner_id) values
    (c, 'Courses', 'items', u), (c, 'Bricolage', 'items', u),
    (c, 'Pharmacie', 'items', u), (c, 'Idées cadeaux', 'gifts', u);
  insert into public.list_favorites (user_id, list_id)
    select u, id from public.lists where couple_id = c and name = 'Courses';
  perform public.seed_lists(c, u);
  return c;
end $$;

-- Lien à usage unique ; tout lien précédent non utilisé est révoqué.
create or replace function public.create_invite()
returns text language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); t text;
begin
  if (select count(*) from public.couple_members where couple_id = c) >= 2 then
    raise exception 'Ton espace a déjà deux membres';
  end if;
  update public.invites set revoked = true where couple_id = c and used_at is null and not revoked;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites (couple_id, token, created_by) values (c, t, auth.uid());
  return t;
end $$;

create or replace function public.accept_invite(p_token text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invites; u uuid := auth.uid(); n int;
begin
  if u is null then raise exception 'Connexion requise'; end if;
  select * into inv from public.invites where token = p_token for update;
  if not found or inv.revoked or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'Ce lien d''invitation n''est plus valable';
  end if;
  if exists (select 1 from public.couple_members where user_id = u) then
    raise exception 'Tu fais déjà partie d''un espace couple';
  end if;
  perform 1 from public.couples where id = inv.couple_id for update;
  select count(*) into n from public.couple_members where couple_id = inv.couple_id;
  if n >= 2 then raise exception 'Cet espace a déjà deux membres'; end if;
  insert into public.profiles (id, display_name, color) values (u, trim(p_display_name), '#0d9488')
    on conflict (id) do update set display_name = excluded.display_name, color = '#0d9488';
  insert into public.couple_members (couple_id, user_id) values (inv.couple_id, u);
  update public.invites set used_by = u, used_at = now() where id = inv.id;
  perform public.seed_lists(inv.couple_id, u);
  return inv.couple_id;
end $$;

-- Aperçu d'une invitation avant connexion du partenaire (prénom de l'invitant).
create or replace function public.invite_preview(p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('inviter', p.display_name,
    'valid', (not i.revoked and i.used_at is null and i.expires_at > now()))
  from public.invites i join public.profiles p on p.id = i.created_by
  where i.token = p_token
$$;

-- « Je la récupère » : le premier enregistrement valide l'emporte.
create or replace function public.claim_pickup(p_pickup uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); r public.pickups;
begin
  update public.pickups set responsible_id = auth.uid(), updated_by = auth.uid(), updated_at = now()
    where id = p_pickup and couple_id = c and responsible_id is null
    returning * into r;
  if found then
    return json_build_object('ok', true, 'responsible_id', r.responsible_id);
  end if;
  select * into r from public.pickups where id = p_pickup and couple_id = c;
  if not found then raise exception 'Créneau introuvable'; end if;
  return json_build_object('ok', false, 'responsible_id', r.responsible_id);
end $$;

create or replace function public.request_relay(p_pickup uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); r public.pickups; p uuid; v_id uuid;
begin
  select * into r from public.pickups where id = p_pickup and couple_id = c for update;
  if not found then raise exception 'Créneau introuvable'; end if;
  if r.responsible_id is distinct from auth.uid() then
    raise exception 'Seul le responsable du créneau peut demander un relais';
  end if;
  p := public.partner_of(auth.uid());
  if p is null then raise exception 'Invite d''abord ton partenaire'; end if;
  if exists (select 1 from public.relay_requests where pickup_id = p_pickup and status = 'pending') then
    raise exception 'Une demande de relais est déjà en attente';
  end if;
  insert into public.relay_requests (pickup_id, couple_id, from_user, to_user)
    values (p_pickup, c, auth.uid(), p) returning relay_requests.id into v_id;
  return v_id;
end $$;

-- Acceptation validée côté serveur : le nom change uniquement ici.
create or replace function public.respond_relay(p_request uuid, p_accept boolean)
returns json language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); q public.relay_requests; r public.pickups;
begin
  select * into q from public.relay_requests where id = p_request and couple_id = c for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if q.to_user <> auth.uid() then raise exception 'Cette demande ne t''est pas adressée'; end if;
  if q.status <> 'pending' then
    return json_build_object('ok', false, 'status', q.status);
  end if;
  select * into r from public.pickups where id = q.pickup_id for update;
  if not p_accept then
    update public.relay_requests set status = 'declined', resolved_at = now() where id = q.id;
    return json_build_object('ok', true, 'status', 'declined');
  end if;
  if r.responsible_id is distinct from q.from_user then
    update public.relay_requests set status = 'cancelled', resolved_at = now() where id = q.id;
    return json_build_object('ok', false, 'status', 'cancelled');
  end if;
  update public.pickups set responsible_id = auth.uid(), updated_by = auth.uid(), updated_at = now()
    where id = r.id;
  update public.relay_requests set status = 'accepted', resolved_at = now() where id = q.id;
  return json_build_object('ok', true, 'status', 'accepted');
end $$;

create or replace function public.cancel_relay(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple();
begin
  update public.relay_requests set status = 'cancelled', resolved_at = now()
    where id = p_request and couple_id = c and from_user = auth.uid() and status = 'pending';
  if not found then raise exception 'Aucune demande en attente à annuler'; end if;
end $$;

-- Enregistre plusieurs jours en une fois. Chaque entrée :
-- {"day":"2026-11-16","time":"17:30","who":"me"|"partner"|"undecided","none":false}
-- « none » = Pas de crèche (supprime le créneau). Si p_organize_week est fourni,
-- l'appelant prend en charge l'organisation de cette semaine (sujet crèche).
create or replace function public.save_pickups(p_entries jsonb, p_organize_week date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid := public.require_couple();
  me uuid := auth.uid();
  partner uuid := public.partner_of(auth.uid());
  e jsonb; d date; resp uuid; who text;
begin
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    d := (e->>'day')::date;
    if coalesce((e->>'none')::boolean, false) then
      delete from public.pickups where couple_id = c and day = d;
      continue;
    end if;
    who := coalesce(e->>'who', 'undecided');
    resp := case who when 'me' then me when 'partner' then partner else null end;
    if who = 'partner' and partner is null then
      raise exception 'Invite d''abord ton partenaire';
    end if;
    insert into public.pickups (couple_id, day, time, responsible_id, updated_by)
      values (c, d, (e->>'time')::time, resp, me)
      on conflict (couple_id, day) do update
        set time = excluded.time, responsible_id = excluded.responsible_id,
            updated_by = me, updated_at = now();
    -- Une demande de relais n'a plus de sens si le responsable a changé.
    update public.relay_requests q set status = 'cancelled', resolved_at = now()
      from public.pickups p
      where q.pickup_id = p.id and p.couple_id = c and p.day = d and q.status = 'pending'
        and p.responsible_id is distinct from q.from_user;
  end loop;

  if p_organize_week is not null then
    perform set_config('app.rpc', 'on', true);
    insert into public.topics (couple_id, title, kind, week_start, owner_id, created_by)
      values (c, 'Organiser la crèche', 'pickup_week',
              p_organize_week - (extract(isodow from p_organize_week)::int - 1), me, me)
      on conflict (couple_id, week_start) where kind = 'pickup_week'
        do update set owner_id = coalesce(public.topics.owner_id, excluded.owner_id),
                      status = 'open';
    perform set_config('app.rpc', '', true);
  end if;
end $$;

-- Sujets : prendre en charge, proposer, accepter/refuser, annuler.
create or replace function public.claim_topic(p_topic uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); t public.topics;
begin
  perform set_config('app.rpc', 'on', true);
  update public.topics set owner_id = auth.uid(),
      proposed_to = case when proposed_to = auth.uid() then null else proposed_to end,
      proposed_by = case when proposed_to = auth.uid() then null else proposed_by end
    where id = p_topic and couple_id = c and owner_id is null and status = 'open'
    returning * into t;
  perform set_config('app.rpc', '', true);
  if found then return json_build_object('ok', true, 'owner_id', t.owner_id); end if;
  select * into t from public.topics where id = p_topic and couple_id = c;
  if not found then raise exception 'Sujet introuvable'; end if;
  return json_build_object('ok', false, 'owner_id', t.owner_id);
end $$;

create or replace function public.propose_topic(p_topic uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); t public.topics; p uuid := public.partner_of(auth.uid());
begin
  if p is null then raise exception 'Invite d''abord ton partenaire'; end if;
  select * into t from public.topics where id = p_topic and couple_id = c for update;
  if not found then raise exception 'Sujet introuvable'; end if;
  if t.status <> 'open' then raise exception 'Ce sujet est clôturé'; end if;
  if t.owner_id is not null and t.owner_id <> auth.uid() then
    raise exception 'Seul le responsable peut passer ce sujet';
  end if;
  perform set_config('app.rpc', 'on', true);
  update public.topics set proposed_to = p, proposed_by = auth.uid() where id = t.id;
  perform set_config('app.rpc', '', true);
end $$;

create or replace function public.respond_topic(p_topic uuid, p_accept boolean)
returns json language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple(); t public.topics;
begin
  select * into t from public.topics where id = p_topic and couple_id = c for update;
  if not found then raise exception 'Sujet introuvable'; end if;
  if t.proposed_to is distinct from auth.uid() then
    return json_build_object('ok', false, 'owner_id', t.owner_id);
  end if;
  perform set_config('app.rpc', 'on', true);
  if p_accept then
    update public.topics set owner_id = auth.uid(), proposed_to = null, proposed_by = null where id = t.id;
  else
    update public.topics set proposed_to = null, proposed_by = null where id = t.id;
  end if;
  perform set_config('app.rpc', '', true);
  return json_build_object('ok', true, 'owner_id', case when p_accept then auth.uid() else t.owner_id end);
end $$;

create or replace function public.cancel_topic_proposal(p_topic uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.require_couple();
begin
  perform set_config('app.rpc', 'on', true);
  update public.topics set proposed_to = null, proposed_by = null
    where id = p_topic and couple_id = c and proposed_by = auth.uid();
  perform set_config('app.rpc', '', true);
end $$;

-- Droits d'exécution : fonctions réservées aux comptes connectés.
revoke execute on function public.seed_lists(uuid, uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_couple_id()', 'public.partner_of(uuid)', 'public.is_couple_user(uuid)',
    'public.can_access_list(uuid)', 'public.require_couple()',
    'public.create_couple(text)', 'public.create_invite()', 'public.accept_invite(text, text)',
    'public.claim_pickup(uuid)', 'public.request_relay(uuid)',
    'public.respond_relay(uuid, boolean)', 'public.cancel_relay(uuid)',
    'public.save_pickups(jsonb, date)', 'public.claim_topic(uuid)',
    'public.propose_topic(uuid)', 'public.respond_topic(uuid, boolean)',
    'public.cancel_topic_proposal(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- L'aperçu d'invitation reste accessible avant connexion (prénom de l'invitant).
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Synchronisation temps réel (Supabase Realtime respecte la RLS)
-- ---------------------------------------------------------------------------

alter table public.pickups replica identity full;
alter table public.relay_requests replica identity full;
alter table public.tasks replica identity full;
alter table public.topics replica identity full;
alter table public.list_items replica identity full;

alter publication supabase_realtime add table
  public.couples, public.profiles, public.couple_members, public.topics,
  public.pickups, public.relay_requests, public.tasks, public.appointments,
  public.lists, public.list_items;

-- Fonctions de trigger : search_path figé (recommandation du linter Supabase).
alter function public.tasks_done_at() set search_path = public;
alter function public.members_only_guard() set search_path = public;
alter function public.topics_guard() set search_path = public;
alter function public.topics_insert_guard() set search_path = public;
alter function public.immutable_privacy_guard() set search_path = public;
