-- Connettore remoto alla pari del connettore principale (1.12.0). Da eseguire nel SQL Editor dopo
-- schema.sql, groups.sql, sharing.sql, people.sql, group-exams.sql e agent.sql. Rieseguibile e senza
-- perdite: solo funzioni e tabelle nuove, nessuna funzione o tabella esistente cambia.
--
-- Il connettore remoto (hub, chiave publishable + segreto del permesso) non ha la sessione della
-- persona: gruppi, condivisioni e appelli dei gruppi passano dalla RLS e da funzioni che leggono
-- auth.uid(). Qui:
--
-- 1. studyos_agent_act_as(segreto): controlla il permesso e, solo per la transazione in corso, fa
--    valere auth.uid() = l'account del permesso. Le funzioni dell'app chiamate dopo (salvare un
--    appello, ripristinare, le etichette delle materie condivise) girano INVARIATE, con gli stessi
--    controlli che hanno per l'app. Il segreto apre solo l'account che l'ha creato, come prima
--    (studyos_agent_push scrive già le sue righe). Nessuna chiave di firma dei JWT esce dal database.
-- 2. Letture (gruppi, bacheca, cronologia, condivisioni, dati condivisi): queste funzioni girano come
--    proprietario delle tabelle, che salta la RLS. Ogni WHERE ripete l'espressione della policy che
--    vale per l'app (stesse funzioni di supporto), con auth.uid() dell'account del permesso.
-- 3. Scritture della bacheca: controllo della policy di inserimento o eliminazione, poi la stessa
--    riga che scriverebbe l'app (trigger dei timbri e della cronologia compresi).
-- 4. Condivisioni (dare, cambiare, togliere; aggiungere, cambiare, eliminare dati di altre persone):
--    il connettore non le esegue. Crea una richiesta (studyos_agent_requests), la persona riceve una
--    notifica push e la conferma nell'app, che esegue lo strumento con la propria sessione, come per
--    il connettore principale. L'esito torna qui e l'assistente lo legge con studyos_approval_status.
-- 5. Timer di studio nel cloud (studyos_timer_states): l'app vi scrive il proprio stato a ogni cambio
--    e adotta quello più recente; il connettore lo legge e lo cambia come l'app.

-- ---------------------------------------------------------------------------------------------
-- 1. Identità del permesso
-- ---------------------------------------------------------------------------------------------

-- Interna: nessun grant. Ritorna l'account; da qui alla fine della transazione auth.uid() è lui.
-- PostgREST esegue ogni chiamata in una transazione propria e riscrive i claim alla successiva:
-- l'identità non passa ad altre richieste.
create or replace function public.studyos_agent_act_as(p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_user(p_secret);
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated', 'studyos_agent', true)::text, true);
  return v_user;
end;
$$;

revoke all on function public.studyos_agent_act_as(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Appelli e correzioni dei gruppi: scritture, cronologia, ripristino
-- ---------------------------------------------------------------------------------------------

-- Appello come in studyos_agent_group_snapshot (group-exams.sql): copie già senza indirizzi, niente id
-- degli account, `mine` = l'ha aggiunto chi usa il connettore. tests/agentParity.test.mjs controlla che
-- le chiavi coincidano con quelle dello snapshot.
create or replace function public.studyos_agent_session_json(p_id text, p_me text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
      'id', s.id, 'group_id', s.group_id,
      'course_key', coalesce(s.agent_course_key, 'nome:email nascosta'),
      'course_id', s.course_id,
      'course_name', coalesce(s.agent_course_name, '[email nascosta]'),
      'course_norm', coalesce(s.agent_course_norm, 'email nascosta'),
      'exam_date', s.exam_date, 'kind', s.kind,
      'label', coalesce(s.agent_label, '[email nascosta]'),
      'exam_time', s.exam_time,
      'room', coalesce(s.agent_room, '[email nascosta]'),
      'notes', coalesce(s.agent_notes, '[email nascosta]'),
      'registration_opens', s.registration_opens, 'registration_closes', s.registration_closes,
      'barb_session_id', s.barb_session_id, 'source', s.source, 'version', s.version,
      'created_by_name', coalesce(s.agent_created_by_name, '[email nascosta]'),
      'updated_by_name', coalesce(s.agent_updated_by_name, '[email nascosta]'),
      'deleted_at', s.deleted_at,
      'deleted_by_name', case when s.deleted_by_name is null then null
        else coalesce(s.agent_deleted_by_name, '[email nascosta]') end,
      'created_at', s.created_at, 'updated_at', s.updated_at,
      'mine', s.created_by = p_me)
  from public.studyos_group_exam_sessions as s
  where s.id = p_id
$$;

create or replace function public.studyos_agent_override_json(p_id text, p_me text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
      'id', o.id, 'group_id', o.group_id, 'target_kind', o.target_kind, 'target_id', o.target_id,
      'target_label', coalesce(o.agent_target_label, '[email nascosta]'),
      'fields', coalesce(o.agent_fields, '{}'::jsonb),
      'version', o.version,
      'created_by_name', coalesce(o.agent_created_by_name, '[email nascosta]'),
      'updated_by_name', coalesce(o.agent_updated_by_name, '[email nascosta]'),
      'deleted_at', o.deleted_at,
      'deleted_by_name', case when o.deleted_by_name is null then null
        else coalesce(o.agent_deleted_by_name, '[email nascosta]') end,
      'created_at', o.created_at, 'updated_at', o.updated_at,
      'mine', o.created_by = p_me)
  from public.studyos_group_catalog_overrides as o
  where o.id = p_id
$$;

revoke all on function public.studyos_agent_session_json(text, text) from public, anon, authenticated;
revoke all on function public.studyos_agent_override_json(text, text) from public, anon, authenticated;

-- Esito di una funzione dell'app con la riga riletta come la vede il connettore (stato, messaggio e
-- campo restano quelli dell'app). La riga si rilegge dopo la scrittura, in un'istruzione successiva
-- (le funzioni stable vedono i dati dall'inizio dell'istruzione che le chiama): i trigger hanno già
-- scritto le copie senza indirizzi. Volatile per lo stesso motivo.
create or replace function public.studyos_agent_group_outcome(p_result jsonb, p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row jsonb := p_result->'row';
  v_id text := v_row->>'id';
  v_projected jsonb;
begin
  if coalesce(jsonb_typeof(v_row), '') <> 'object' or v_id is null then
    return p_result - 'row';
  end if;
  if v_row ? 'course_key' then
    v_projected := public.studyos_agent_session_json(v_id, p_user::text);
  elsif v_row ? 'target_kind' then
    v_projected := public.studyos_agent_override_json(v_id, p_user::text);
  end if;
  if v_projected is null then
    return p_result - 'row';
  end if;
  return jsonb_set(p_result, '{row}', v_projected);
end;
$$;

revoke all on function public.studyos_agent_group_outcome(jsonb, uuid) from public, anon, authenticated;

create or replace function public.studyos_agent_save_group_exam_session(
  p_secret text, p_group_id text, p_id text, p_expected_version integer, p_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_result jsonb;
begin
  v_result := public.save_group_exam_session(p_group_id, p_id, p_expected_version, p_fields);
  return public.studyos_agent_group_outcome(v_result, v_user);
end;
$$;

create or replace function public.studyos_agent_delete_group_exam_session(p_secret text, p_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_result jsonb;
begin
  v_result := public.delete_group_exam_session(p_id, p_expected_version);
  return public.studyos_agent_group_outcome(v_result, v_user);
end;
$$;

create or replace function public.studyos_agent_save_catalog_override(
  p_secret text, p_group_id text, p_id text, p_expected_version integer,
  p_target_kind text, p_target_id text, p_target_label text, p_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_result jsonb;
begin
  v_result := public.save_group_catalog_override(p_group_id, p_id, p_expected_version, p_target_kind, p_target_id, p_target_label, p_fields);
  return public.studyos_agent_group_outcome(v_result, v_user);
end;
$$;

create or replace function public.studyos_agent_delete_catalog_override(p_secret text, p_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_result jsonb;
begin
  v_result := public.delete_group_catalog_override(p_id, p_expected_version);
  return public.studyos_agent_group_outcome(v_result, v_user);
end;
$$;

create or replace function public.studyos_agent_restore_group_record(p_secret text, p_history_id bigint, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_result jsonb;
begin
  v_result := public.restore_group_record(p_history_id, p_expected_version);
  return public.studyos_agent_group_outcome(v_result, v_user);
end;
$$;

-- Cronologia di un gruppo, come la legge l'app (policy studyos_ghist_select: membri del gruppo), dal
-- più recente. Senza id degli account: actor_user_id vuoto e, nelle immagini prima e dopo, niente
-- autori né copie per gli agenti.
create or replace function public.studyos_agent_group_history(
  p_secret text, p_group_id text, p_record_kind text default null, p_record_id text default null,
  p_before_id bigint default null, p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
begin
  if not public.studyos_is_group_member(p_group_id) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', h.id, 'group_id', h.group_id, 'record_kind', h.record_kind, 'record_id', h.record_id,
        'action', h.action, 'version', h.version,
        'before', public.studyos_without_agent_copies(h.before) - array['created_by', 'updated_by', 'deleted_by'],
        'after', public.studyos_without_agent_copies(h.after) - array['created_by', 'updated_by', 'deleted_by'],
        'changed_fields', h.changed_fields, 'actor_user_id', '', 'actor_name', h.actor_name,
        'changed_at', h.changed_at) order by h.id desc)
    from (
      select * from public.studyos_group_history as x
      where x.group_id = p_group_id
        and (p_record_kind is null or x.record_kind = p_record_kind)
        and (p_record_id is null or x.record_id = p_record_id)
        and (p_before_id is null or x.id < p_before_id)
      order by x.id desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) as h), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Gruppi: elenco, membri, bacheca e attività; pubblicare e togliere risorse
-- ---------------------------------------------------------------------------------------------

-- Come il pull dei gruppi dell'app (lib/groupSync.ts): i gruppi di cui l'account è membro (policy
-- studyos_groups_select) senza codice di invito, i loro membri senza email, tutte le risorse e le
-- ultime 200 attività. Nessuno strumento mostra codici, email o id degli account (agent/project.ts).
-- `me` serve all'hub per gli stessi confronti dell'app (proprietario, autore); non esce agli agenti.
create or replace function public.studyos_agent_groups(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_me text := v_user::text;
  v_ids text[];
begin
  select coalesce(array_agg(distinct m.group_id), '{}') into v_ids
  from public.studyos_group_members as m where m.user_id = v_me;
  return jsonb_build_object(
    'me', v_me,
    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) - 'invite_code' order by g.created_at, g.id)
      from public.studyos_groups as g
      where g.id = any (v_ids) and (g.owner_id = v_me or public.studyos_is_group_member(g.id))), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) - 'email' order by m.group_id, m.joined_at, m.user_id)
      from public.studyos_group_members as m
      where m.group_id = any (v_ids)), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.id)
      from (
        select * from public.studyos_group_resources as x
        where x.group_id = any (v_ids)
        order by x.id
        limit 5000
      ) as r), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id)
      from (
        select * from public.studyos_group_activity as x
        where x.group_id = any (v_ids)
        order by x.created_at desc
        limit 200
      ) as a), '[]'::jsonb)
  );
end;
$$;

-- Pubblica una risorsa nuova in bacheca (policy studyos_group_resources_write: membro, a proprio nome).
-- L'autore è sempre l'account del permesso, qualsiasi cosa dica la riga. Ritorna il timbro del server.
create or replace function public.studyos_agent_add_group_resource(p_secret text, p_resource jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_me text := v_user::text;
  v_group text := p_resource->>'group_id';
  v_id text := p_resource->>'id';
  v_row public.studyos_group_resources;
begin
  if coalesce(jsonb_typeof(p_resource), '') <> 'object' or coalesce(v_id, '') = '' or coalesce(v_group, '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.studyos_is_group_member(v_group) then
    return jsonb_build_object('status', 'denied');
  end if;
  select * into v_row from public.studyos_group_resources where id = v_id;
  if found then
    -- Stessa risorsa già pubblicata (una ripetizione): va bene solo se è la sua, nello stesso gruppo.
    if v_row.group_id <> v_group or v_row.added_by_user_id <> v_me then
      return jsonb_build_object('status', 'denied');
    end if;
    return jsonb_build_object('status', 'ok', 'updated_at', v_row.updated_at);
  end if;
  insert into public.studyos_group_resources (id, group_id, kind, title, url, body, pinned, added_by_user_id, added_by_display_name, updated_at)
  values (
    v_id, v_group, coalesce(p_resource->>'kind', 'note'), coalesce(p_resource->>'title', ''),
    p_resource->>'url', p_resource->>'body', coalesce((p_resource->>'pinned')::boolean, false),
    v_me, coalesce(p_resource->>'added_by_display_name', ''), now()
  )
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'updated_at', v_row.updated_at);
end;
$$;

-- Toglie una risorsa (policy studyos_group_resources_delete: autore, proprietario o amministratore).
-- true anche se non c'era più, come la cancellazione dell'app.
create or replace function public.studyos_agent_delete_group_resource(p_secret text, p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_me text := v_user::text;
begin
  delete from public.studyos_group_resources as r
  where r.id = p_id
    and (r.added_by_user_id = v_me or public.studyos_group_role(r.group_id) in ('owner', 'admin'));
  return not exists (select 1 from public.studyos_group_resources where id = p_id);
end;
$$;

-- Riga della cronologia del gruppo (policy studyos_group_activity_insert: membro, a proprio nome).
create or replace function public.studyos_agent_log_group_activity(p_secret text, p_activity jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
  v_group text := p_activity->>'group_id';
begin
  if coalesce(jsonb_typeof(p_activity), '') <> 'object' or coalesce(p_activity->>'id', '') = ''
     or not coalesce(public.studyos_is_group_member(v_group), false) then
    return false;
  end if;
  insert into public.studyos_group_activity (id, group_id, actor_display_name, text, actor_user_id)
  values (p_activity->>'id', v_group, coalesce(p_activity->>'actor_display_name', ''), left(coalesce(p_activity->>'text', ''), 2000), v_user::text)
  on conflict (id) do nothing;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Condivisioni: lettura
-- ---------------------------------------------------------------------------------------------

-- Come il pull della condivisione dell'app (lib/shareSync.ts): condivisioni (policy
-- studyos_shares_select), inviti (policy studyos_share_invites_select, stesse colonne leggibili),
-- materie condivise (shared_subject_labels, la funzione dell'app) e le righe vive degli altri che la
-- policy studyos_select_shared_items mostra, dei soli tipi delle sezioni ricevute. Senza file
-- incorporati né copertine (gli strumenti non li mostrano), senza indirizzi email di destinatari e
-- inviti (nessuno strumento li usa). Al più p_limit righe, le più recenti.
-- p_types: solo questi tipi (null = tutti; vuoto = nessuna riga, per chi legge solo le condivisioni).
-- La prima versione (stesso giorno, mai usata) non aveva p_types: due firme confonderebbero PostgREST.
drop function if exists public.studyos_agent_sharing(text, integer);

create or replace function public.studyos_agent_sharing(p_secret text, p_limit integer default 5000, p_types text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_act_as(p_secret);
begin
  return jsonb_build_object(
    'me', v_user,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'owner_id', s.owner_id, 'owner_name', s.owner_name, 'scope', s.scope,
          'subject_ids', s.subject_ids, 'permission', s.permission, 'grantee_user_id', s.grantee_user_id,
          'grantee_group_id', s.grantee_group_id, 'grantee_name', s.grantee_name,
          'created_at', s.created_at, 'updated_at', s.updated_at) order by s.created_at)
      from public.studyos_shares as s
      where s.owner_id = v_user
         or s.grantee_user_id = v_user
         or (s.grantee_group_id is not null and public.studyos_is_group_member(s.grantee_group_id))), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'owner_id', i.owner_id, 'owner_name', i.owner_name, 'offers', i.offers,
          'requests', i.requests, 'recipient_user_id', i.recipient_user_id,
          'status', i.status, 'accepted_by', i.accepted_by, 'expires_at', i.expires_at,
          'created_at', i.created_at) order by i.created_at desc)
      from (
        select * from public.studyos_share_invites as x
        where x.owner_id = v_user or (x.status = 'pending' and x.recipient_user_id = v_user)
        order by x.created_at desc
        limit 100
      ) as i), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('owner_id', l.owner_id, 'subject_id', l.subject_id, 'name', l.name,
          'color', l.color, 'icon', l.icon))
      from public.shared_subject_labels() as l), '[]'::jsonb),
    'items', coalesce((
      -- Proprietari che condividono con l'account e i tipi delle loro sezioni: si leggono solo quelle
      -- righe (indice user_id, entity_type), poi lo stesso filtro della policy riga per riga.
      with received as (
        select s.owner_id, t.entity_type
        from public.studyos_shares as s
        cross join lateral unnest(public.studyos_scope_types(s.scope)) as t (entity_type)
        where s.owner_id <> v_user
          and (s.grantee_user_id = v_user
            or (s.grantee_group_id is not null and public.studyos_is_group_member(s.grantee_group_id)))
      ),
      wanted as (
        select owner_id, array_agg(distinct entity_type) as types from received group by owner_id
      )
      select jsonb_agg(jsonb_build_object(
          'owner_id', r.user_id, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
          'payload', r.payload, 'deleted', r.deleted, 'updated_at', r.updated_at, 'id', r.id))
      from (
        select i.id, i.user_id, i.entity_type, i.entity_id, i.deleted, i.updated_at,
          case when jsonb_typeof(i.payload) = 'object'
            then i.payload - array['dataUrl', 'cover', 'avatarDataUrl']
            else i.payload end as payload
        from wanted as w
        join public.studyos_items as i on i.user_id = w.owner_id and i.entity_type = any (w.types)
        where i.deleted = false
          and (p_types is null or i.entity_type = any (p_types))
          and public.studyos_item_access(i.user_id, i.entity_type, i.payload) is not null
        order by i.updated_at desc, i.id
        limit least(greatest(coalesce(p_limit, 5000), 1), 10000)
      ) as r), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Condivisioni: richieste da confermare nell'app
-- ---------------------------------------------------------------------------------------------

create table if not exists public.studyos_agent_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  grant_id uuid references public.studyos_agent_grants (id) on delete cascade,
  client_label text not null default '',
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  summary text not null default '',
  risk text not null default 'write' check (risk in ('write', 'destructive')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'denied', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  decided_at timestamptz,
  finished_at timestamptz
);

create index if not exists studyos_agent_requests_user_idx on public.studyos_agent_requests (user_id, status, created_at desc);

alter table public.studyos_agent_requests enable row level security;

-- La persona legge le proprie richieste (l'app le mostra da confermare); si scrivono solo con le funzioni.
drop policy if exists studyos_agent_requests_select_own on public.studyos_agent_requests;
create policy studyos_agent_requests_select_own on public.studyos_agent_requests
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.studyos_agent_requests from public, anon, authenticated;
grant select on public.studyos_agent_requests to authenticated;

-- Strumenti che il connettore remoto fa confermare nell'app (src/agent/catalog.ts, CLOUD_DEFERRED).
create or replace function public.studyos_agent_deferred_tool(p_tool text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_tool in ('studyos_share_with', 'studyos_update_share', 'studyos_revoke_share',
    'studyos_create_shared_item', 'studyos_update_shared_item', 'studyos_delete_shared_item')
$$;

revoke all on function public.studyos_agent_deferred_tool(text) from public, anon, authenticated;

-- Notifica push «Conferma in StudyOS» ai dispositivi della persona (stesso invio di
-- studyos_push_notify in people.sql, che però non avvisa chi agisce: qui chi agisce è l'assistente).
-- Senza pg_net o senza i segreti nel Vault non parte nulla; un errore non ferma la richiesta.
create or replace function public.studyos_agent_request_push(p_user uuid, p_request uuid, p_summary text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url text;
  v_notification jsonb;
  v_batch jsonb;
  v_private boolean;
begin
  begin
    if p_user is null or not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'net' and p.proname = 'http_post'
    ) or to_regclass('vault.decrypted_secrets') is null then
      return;
    end if;
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s
    where s.name = 'studyos_push_secret' order by s.created_at desc limit 1;
    select s.decrypted_secret into v_url from vault.decrypted_secrets s
    where s.name = 'studyos_push_url' order by s.created_at desc limit 1;
    if coalesce(v_secret, '') = '' or coalesce(v_url, '') !~ '^https?://' then
      return;
    end if;
    v_notification := jsonb_build_object(
      'kind', 'agent',
      'title', 'Conferma in StudyOS',
      'body', left('Un assistente chiede: ' || coalesce(p_summary, ''), 240),
      'url', '?apri=agenti',
      'tag', 'studyos-agent-' || p_request::text
    );
    for v_batch, v_private in
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'account', s.user_id) order by s.rn),
        s.private
      from (
        select sub.endpoint, sub.p256dh, sub.auth, sub.user_id, sub.private,
          row_number() over (partition by sub.private order by sub.created_at, sub.id) as rn
        from public.studyos_push_subscriptions sub
        where sub.user_id = p_user
      ) as s
      group by s.private, (s.rn - 1) / 15
      order by s.private, (s.rn - 1) / 15
    loop
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object(
          'notification', case when v_private
            then v_notification || jsonb_build_object('title', 'StudyOS', 'body', 'Hai una nuova notifica.')
            else v_notification end,
          'subscriptions', v_batch
        ),
        params := '{}'::jsonb,
        headers := jsonb_build_object('content-type', 'application/json', 'x-studyos-push-secret', v_secret),
        timeout_milliseconds := 15000
      );
    end loop;
  exception when others then
    raise warning 'studyos_agent_request_push: %', sqlerrm;
  end;
end;
$$;

revoke all on function public.studyos_agent_request_push(uuid, uuid, text) from public, anon, authenticated;

-- Il connettore chiede di eseguire uno strumento di condivisione: richiesta in attesa per 30 minuti
-- (come le conferme del connettore principale) e notifica push. Al più 20 in attesa e 30 all'ora per
-- account. Le richieste chiuse da più di 7 giorni si cancellano qui.
create or replace function public.studyos_agent_request_create(
  p_secret text, p_tool text, p_args jsonb, p_summary text, p_risk text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.studyos_agent_grants := public.studyos_agent_grant_of(p_secret);
  v_id uuid;
begin
  if v_grant.user_id is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  if not coalesce(public.studyos_agent_deferred_tool(p_tool), false) or coalesce(jsonb_typeof(p_args), '') <> 'object'
     or octet_length(p_args::text) > 65536 or coalesce(p_risk, '') not in ('write', 'destructive') then
    raise exception 'Richiesta non valida.' using errcode = '22023';
  end if;
  delete from public.studyos_agent_requests as r
  where r.user_id = v_grant.user_id and r.created_at < now() - interval '7 days';
  update public.studyos_agent_requests as r set status = 'expired', finished_at = now()
  where r.user_id = v_grant.user_id and r.status = 'pending' and r.expires_at <= now();
  if (select count(*) from public.studyos_agent_requests as r
      where r.user_id = v_grant.user_id and r.status = 'pending') >= 20
     or (select count(*) from public.studyos_agent_requests as r
      where r.user_id = v_grant.user_id and r.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Troppe richieste in attesa di conferma: conferma o rifiuta quelle aperte in StudyOS.' using errcode = '54000';
  end if;
  insert into public.studyos_agent_requests (user_id, grant_id, client_label, tool, args, summary, risk)
  values (v_grant.user_id, v_grant.id, left(coalesce(v_grant.label, ''), 80), p_tool, p_args, left(coalesce(p_summary, ''), 240), p_risk)
  returning id into v_id;
  perform public.studyos_agent_request_push(v_grant.user_id, v_id, left(coalesce(p_summary, ''), 200));
  return v_id;
end;
$$;

-- Stato di una richiesta dello stesso account: pending, running, done (con l'esito), denied o expired.
create or replace function public.studyos_agent_request_status(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_user(p_secret);
  v_row public.studyos_agent_requests;
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  update public.studyos_agent_requests as r set status = 'expired', finished_at = now()
  where r.id = p_id and r.user_id = v_user and r.status = 'pending' and r.expires_at <= now();
  -- Confermata ma senza esito dopo 15 minuti (app chiusa o rete persa durante l'esecuzione): l'agente
  -- non aspetta per sempre, e non ripete un'azione che forse è stata fatta.
  update public.studyos_agent_requests as r
  set status = 'done', finished_at = now(),
      result = jsonb_build_object('ok', false, 'code', 'failed',
        'error', 'StudyOS non ha riportato l''esito dopo la conferma: controlla nell''app se l''azione è stata fatta prima di riprovare.')
  where r.id = p_id and r.user_id = v_user and r.status = 'running' and r.decided_at <= now() - interval '15 minutes';
  select * into v_row from public.studyos_agent_requests as r where r.id = p_id and r.user_id = v_user;
  if not found then
    return null;
  end if;
  return jsonb_build_object('status', v_row.status, 'tool', v_row.tool, 'result', v_row.result,
    'created_at', v_row.created_at, 'expires_at', v_row.expires_at);
end;
$$;

-- L'app decide (Approva o Rifiuta): solo la persona della richiesta, solo se è ancora in attesa e non
-- scaduta. true = la decisione vale (con Approva l'app esegue lo strumento e chiama finish).
create or replace function public.studyos_agent_request_decide(p_id uuid, p_approve boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account.' using errcode = '28000';
  end if;
  update public.studyos_agent_requests as r
  set status = case when p_approve then 'running' else 'denied' end,
      decided_at = now(),
      result = case when p_approve then null
        else jsonb_build_object('ok', false, 'code', 'denied', 'error', 'Rifiutato in StudyOS.') end,
      finished_at = case when p_approve then null else now() end
  where r.id = p_id and r.user_id = auth.uid() and r.status = 'pending' and r.expires_at > now();
  return found;
end;
$$;

-- Esito dello strumento eseguito nell'app dopo Approva (al più 256 kB, come una risposta MCP lunga).
create or replace function public.studyos_agent_request_finish(p_id uuid, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account.' using errcode = '28000';
  end if;
  update public.studyos_agent_requests as r
  set status = 'done', finished_at = now(),
      result = case when jsonb_typeof(p_result) = 'object' and octet_length(p_result::text) <= 262144 then p_result
        else jsonb_build_object('ok', false, 'code', 'failed', 'error', 'Esito non leggibile.') end
  where r.id = p_id and r.user_id = auth.uid() and r.status = 'running';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Timer di studio nel cloud
-- ---------------------------------------------------------------------------------------------

-- Lo stato del timer (src/lib/studyTimer.ts, TimerState) dell'account: vince il changedAt più recente
-- (epoch ms, scritto a ogni cambio), come tra due schede dello stesso browser.
create table if not exists public.studyos_timer_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  changed_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.studyos_timer_states enable row level security;

drop policy if exists studyos_timer_states_select_own on public.studyos_timer_states;
create policy studyos_timer_states_select_own on public.studyos_timer_states
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.studyos_timer_states from public, anon, authenticated;
grant select on public.studyos_timer_states to authenticated;

-- Scrittura condizionale: solo uno stato con changedAt più recente di quello salvato. Ritorna lo
-- stato che vale dopo la chiamata (quello mandato o quello più recente già salvato).
create or replace function public.studyos_timer_write(p_user uuid, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed bigint;
  v_state jsonb;
begin
  -- coalesce: con un valore assente jsonb_typeof dà null e il confronto non scatterebbe.
  if coalesce(jsonb_typeof(p_state), '') <> 'object' or octet_length(p_state::text) > 8192
     or coalesce(jsonb_typeof(p_state->'changedAt'), '') <> 'number' then
    raise exception 'Stato del timer non valido.' using errcode = '22023';
  end if;
  v_changed := floor((p_state->>'changedAt')::numeric)::bigint;
  insert into public.studyos_timer_states as t (user_id, state, changed_at, updated_at)
  values (p_user, p_state, v_changed, now())
  on conflict (user_id) do update set state = excluded.state, changed_at = excluded.changed_at, updated_at = now()
  where t.changed_at < excluded.changed_at;
  select t.state into v_state from public.studyos_timer_states as t where t.user_id = p_user;
  return v_state;
end;
$$;

revoke all on function public.studyos_timer_write(uuid, jsonb) from public, anon, authenticated;

-- Dall'app: lo stato del timer di questo account.
create or replace function public.studyos_timer_put(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Accedi con il tuo account.' using errcode = '28000';
  end if;
  return public.studyos_timer_write(auth.uid(), p_state);
end;
$$;

-- Dal connettore remoto.
create or replace function public.studyos_agent_timer_get(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_user(p_secret);
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  return (select t.state from public.studyos_timer_states as t where t.user_id = v_user);
end;
$$;

create or replace function public.studyos_agent_timer_put(p_secret text, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.studyos_agent_user(p_secret);
begin
  if v_user is null then
    raise exception 'Collegamento dell''assistente non valido o revocato.' using errcode = '28000';
  end if;
  return public.studyos_timer_write(v_user, p_state);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permessi: le funzioni del connettore si chiamano con la chiave publishable (anon) e il segreto;
-- quelle dell'app solo con l'accesso fatto. I privilegi predefiniti del progetto danno EXECUTE anche
-- ad anon: si toglie in modo esplicito.
-- ---------------------------------------------------------------------------------------------

revoke all on function public.studyos_agent_save_group_exam_session(text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.studyos_agent_delete_group_exam_session(text, text, integer) from public, anon, authenticated;
revoke all on function public.studyos_agent_save_catalog_override(text, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.studyos_agent_delete_catalog_override(text, text, integer) from public, anon, authenticated;
revoke all on function public.studyos_agent_restore_group_record(text, bigint, integer) from public, anon, authenticated;
revoke all on function public.studyos_agent_group_history(text, text, text, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.studyos_agent_groups(text) from public, anon, authenticated;
revoke all on function public.studyos_agent_add_group_resource(text, jsonb) from public, anon, authenticated;
revoke all on function public.studyos_agent_delete_group_resource(text, text) from public, anon, authenticated;
revoke all on function public.studyos_agent_log_group_activity(text, jsonb) from public, anon, authenticated;
revoke all on function public.studyos_agent_sharing(text, integer, text[]) from public, anon, authenticated;
revoke all on function public.studyos_agent_request_create(text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.studyos_agent_request_status(text, uuid) from public, anon, authenticated;
revoke all on function public.studyos_agent_timer_get(text) from public, anon, authenticated;
revoke all on function public.studyos_agent_timer_put(text, jsonb) from public, anon, authenticated;
revoke all on function public.studyos_agent_request_decide(uuid, boolean) from public, anon, authenticated;
revoke all on function public.studyos_agent_request_finish(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.studyos_timer_put(jsonb) from public, anon, authenticated;

grant execute on function public.studyos_agent_save_group_exam_session(text, text, text, integer, jsonb) to anon, authenticated;
grant execute on function public.studyos_agent_delete_group_exam_session(text, text, integer) to anon, authenticated;
grant execute on function public.studyos_agent_save_catalog_override(text, text, text, integer, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.studyos_agent_delete_catalog_override(text, text, integer) to anon, authenticated;
grant execute on function public.studyos_agent_restore_group_record(text, bigint, integer) to anon, authenticated;
grant execute on function public.studyos_agent_group_history(text, text, text, text, bigint, integer) to anon, authenticated;
grant execute on function public.studyos_agent_groups(text) to anon, authenticated;
grant execute on function public.studyos_agent_add_group_resource(text, jsonb) to anon, authenticated;
grant execute on function public.studyos_agent_delete_group_resource(text, text) to anon, authenticated;
grant execute on function public.studyos_agent_log_group_activity(text, jsonb) to anon, authenticated;
grant execute on function public.studyos_agent_sharing(text, integer, text[]) to anon, authenticated;
grant execute on function public.studyos_agent_request_create(text, text, jsonb, text, text) to anon, authenticated;
grant execute on function public.studyos_agent_request_status(text, uuid) to anon, authenticated;
grant execute on function public.studyos_agent_timer_get(text) to anon, authenticated;
grant execute on function public.studyos_agent_timer_put(text, jsonb) to anon, authenticated;
grant execute on function public.studyos_agent_request_decide(uuid, boolean) to authenticated;
grant execute on function public.studyos_agent_request_finish(uuid, jsonb) to authenticated;
grant execute on function public.studyos_timer_put(jsonb) to authenticated;
