-- Righe come le scrivevano i client e gli script pubblicati prima di people.sql (c28f036), per provare
-- l'aggiornamento (scripts/supabase/upgrade-from-published.sh). Solo colonne che esistevano allora.
-- Account di auth-stub.sql: Olga (owner@), Bea (bea@), A (a@, confermata prima dell'11/11/2026, quando
-- la conferma era obbligatoria) e B (b@).
\set ON_ERROR_STOP 1
\set olga '11111111-1111-1111-1111-111111111111'
\set bea '22222222-2222-2222-2222-222222222222'
\set a '504b3482-7f1b-4add-bfbc-7b3effbf21d7'
\set b 'fc0191e0-6663-4a43-b060-131e397f02cc'

update auth.users set email_confirmed_at = timestamptz '2026-10-01 10:00:00+02' where id = :'a';

-- Gruppo con un id con lo spazio, gruppo con un nome oltre 120 caratteri (prima non c'era limite),
-- membri con l'email e con il nome preso dalla parte dell'email prima della @.
insert into public.studyos_groups (id, name, owner_id, owner_display_name, invite_code) values
  ('gruppo vecchio 1', 'Gruppo vecchio', :'olga', 'owner', 'OLD-CODE-0001'),
  ('group_normale', 'Fisica 2', :'olga', 'Olga', 'OLD-CODE-0002'),
  ('group_lungo', 'Gruppo di studio di Farmacologia speciale e Chimica farmaceutica del secondo anno, sessione invernale, con appunti e domande d''esame', :'olga', 'Olga', 'OLD-CODE-0003');
insert into public.studyos_group_members (group_id, user_id, email, display_name, role) values
  ('gruppo vecchio 1', :'olga', 'owner@test.local', 'owner', 'owner'),
  ('gruppo vecchio 1', :'bea', 'bea@test.local', 'bea', 'member'),
  ('gruppo vecchio 1', :'b', 'b@test.local', 'Bruno', 'admin'),
  ('group_normale', :'olga', 'owner@test.local', 'Olga', 'owner'),
  ('group_lungo', :'olga', 'owner@test.local', 'Olga', 'owner'),
  ('group_lungo', :'bea', 'bea@test.local', 'Bea', 'member');

-- Inviti di gruppo: per email in attesa (a un account confermato prima dell'11/11, a un indirizzo senza
-- account), per email già accettato e rifiutato, con codice (senza destinatario).
insert into public.studyos_group_invites (id, group_id, group_name, from_user_id, from_display_name, recipient_email, code, status) values
  ('groupInvite_old_a', 'gruppo vecchio 1', 'Gruppo vecchio', :'olga', 'owner', 'A@Test.Local', 'OLD-CODE-0001', 'pending'),
  ('groupInvite_old_nobody', 'gruppo vecchio 1', 'Gruppo vecchio', :'olga', 'owner', 'nessuno@test.local', 'OLD-CODE-0001', 'pending'),
  ('groupInvite_old_accepted', 'gruppo vecchio 1', 'Gruppo vecchio', :'olga', 'owner', 'bea@test.local', 'OLD-CODE-0001', 'accepted'),
  ('groupInvite_old_declined', 'group_normale', 'Fisica 2', :'olga', 'Olga', 'b@test.local', 'OLD-CODE-0002', 'declined'),
  ('groupInvite_old_code', 'group_normale', 'Fisica 2', :'olga', 'Olga', null, 'OLD-CODE-0002', 'pending');

-- Risorsa e attività di gruppo con il nome dalla parte dell'email.
insert into public.studyos_group_resources (id, group_id, kind, title, body, added_by_user_id, added_by_display_name) values
  ('res_old_1', 'gruppo vecchio 1', 'note', 'Domande d''esame', 'Elenco', :'bea', 'bea');
insert into public.studyos_group_activity (id, group_id, actor_display_name, text, actor_user_id) values
  ('act_old_1', 'gruppo vecchio 1', 'bea', 'è entrato nel gruppo', :'bea');

-- Condivisioni: diretta (nomi dalla parte dell'email, email di chi riceve) e con il gruppo.
insert into public.studyos_shares (owner_id, owner_name, scope, permission, grantee_user_id, grantee_name, grantee_email) values
  (:'olga', 'owner', 'calendar', 'view', :'bea', 'bea', 'bea@test.local'),
  (:'olga', 'owner', 'tasks', 'edit', :'bea', 'bea', 'bea@test.local');
insert into public.studyos_shares (owner_id, owner_name, scope, permission, grantee_group_id, grantee_name) values
  (:'olga', 'Olga', 'goals', 'view', 'gruppo vecchio 1', 'Gruppo vecchio');

-- Inviti di condivisione: per email in attesa (ad A, a un indirizzo senza account), accettato da Bea,
-- con il solo link.
insert into public.studyos_share_invites (owner_id, owner_name, offers, recipient_email, token_hash, status, accepted_by) values
  (:'olga', 'owner', '[{"scope":"goals","permission":"view","subject_ids":[],"subject_names":[]}]', 'a@test.local', sha256('tok-a'::bytea), 'pending', null),
  (:'olga', 'owner', '[{"scope":"goals","permission":"view","subject_ids":[],"subject_names":[]}]', 'nessuno@test.local', sha256('tok-n'::bytea), 'pending', null),
  (:'olga', 'owner', '[{"scope":"calendar","permission":"view","subject_ids":[],"subject_names":[]}]', 'bea@test.local', sha256('tok-b'::bytea), 'accepted', :'bea'),
  (:'olga', 'Olga', '[{"scope":"tasks","permission":"view","subject_ids":[],"subject_names":[]}]', null, sha256('tok-l'::bytea), 'pending', null);

-- Dati personali: un materiale con il file incorporato (prima dello spazio file), un'attività e un
-- elemento eliminato.
insert into public.studyos_items (user_id, entity_type, entity_id, payload, deleted) values
  (:'olga', 'attachment', 'att_old_1', '{"id": "att_old_1", "name": "Dispense.pdf", "dataUrl": "data:application/pdf;base64,JVBERi0=", "updatedAt": "2026-11-01T10:00:00.000Z"}', false),
  (:'olga', 'task', 'task_old_1', '{"id": "task_old_1", "title": "Ripasso", "updatedAt": "2026-11-01T10:00:00.000Z"}', false),
  (:'bea', 'task', 'task_old_2', '{"id": "task_old_2", "title": "Vecchia", "deletedAt": "2026-11-02T10:00:00.000Z", "updatedAt": "2026-11-02T10:00:00.000Z"}', true);
