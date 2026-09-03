-- ============================================================================
-- GestiLot — Schéma de base de données Supabase (PostgreSQL)
-- ----------------------------------------------------------------------------
-- À exécuter UNE SEULE FOIS dans le SQL Editor de votre projet Supabase
-- (Dashboard > SQL Editor > New query > coller ce fichier > Run).
--
-- Ce script crée les 4 tables reliées : utilisateurs, souscripteurs,
-- lots et versements, ainsi que les règles de sécurité (RLS).
-- ============================================================================

-- Extension utile pour générer des UUID (nom du schéma standard Supabase).
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) UTILISATEURS (comptes administrateurs)
-- ----------------------------------------------------------------------------
create table if not exists utilisateurs (
  id            uuid primary key default gen_random_uuid(),
  identifiant   text unique not null,
  mot_de_passe  text not null,               -- stockez de préférence un hash
  role          text not null default 'admin',
  created_at    timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 2) SOUSCRIPTEURS
-- ----------------------------------------------------------------------------
create table if not exists souscripteurs (
  id            bigint primary key,          -- id fourni par l'application
  code          text unique not null,
  nom           text not null,
  prenom        text not null,
  ilot          text not null default '',
  numeros_lots  text not null default '',
  nombre_lots   integer not null default 1,
  superficie    numeric not null default 0, -- superficie d'un lot
  prix_unitaire numeric not null default 0,
  date_adhesion date not null default current_date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Migration pour une table souscripteurs déjà créée avant l'ajout de l'îlot.
alter table souscripteurs add column if not exists ilot text not null default '';
alter table souscripteurs add column if not exists numeros_lots text not null default '';

-- ----------------------------------------------------------------------------
-- 3) LOTS (associés à un souscripteur, relation 1-N)
-- ----------------------------------------------------------------------------
create table if not exists lots (
  id               bigint primary key,       -- id fourni par l'application
  souscripteur_id  bigint references souscripteurs(id) on delete cascade,
  num_lot          integer not null,
  numero_lot       integer not null default 0,
  superficie       numeric not null default 0, -- superficie du lot
  prix_unitaire    numeric not null default 0,
  prix_total       numeric not null default 0,
  statut           text not null default 'en cours',
  created_at       timestamptz default now()
);
create index if not exists idx_lots_souscripteur on lots(souscripteur_id);
alter table lots add column if not exists numero_lot integer not null default 0;
alter table lots alter column numero_lot drop default;
alter table lots alter column numero_lot type integer
  using coalesce(nullif(regexp_replace(numero_lot::text, '[^0-9]', '', 'g'), ''), '0')::integer;
alter table lots alter column numero_lot set default 0;

-- ----------------------------------------------------------------------------
-- 4) VERSEMENTS (relations 1-N vers souscripteurs)
-- ----------------------------------------------------------------------------
create table if not exists versements (
  id               bigint primary key,       -- id fourni par l'application
  souscripteur_id  bigint references souscripteurs(id) on delete cascade,
  montant          numeric not null,
  date             date not null default current_date,
  mode             text not null,
  ref              text default '',
  observation      text default '',
  created_at       timestamptz default now()
);
create index if not exists idx_versements_souscripteur on versements(souscripteur_id);

-- ============================================================================
-- SÉCURITÉ (Row Level Security)
-- ----------------------------------------------------------------------------
--  • "secure" (recommandé) : seuls les utilisateurs AUTHENTIFIÉS via Supabase Auth
--    peuvent lire/écrire -> connexion par e-mail + mot de passe dans l'app.
--  • "permissif" : tout le monde (anonyme) peut lire/écrire. À N'ACTIVER que pour
--    un usage interne simple ; les clés anonymes deviennent alors autoritaires.
-- ============================================================================
alter table souscripteurs enable row level security;
alter table lots          enable row level security;
alter table versements    enable row level security;
alter table utilisateurs  enable row level security;

-- Politiques "authenticated" (recommandé) : accès complet pour les connectés.
drop policy if exists "authenticated_all_souscripteurs" on souscripteurs;
create policy "authenticated_all_souscripteurs" on souscripteurs
  for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_all_lots" on lots;
create policy "authenticated_all_lots" on lots
  for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_all_versements" on versements;
create policy "authenticated_all_versements" on versements
  for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_all_utilisateurs" on utilisateurs;
create policy "authenticated_all_utilisateurs" on utilisateurs
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- OPTION (simplifiée) : autoriser l'accès anonyme. Décommentez uniquement si
-- vous ne souhaitez PAS d'authentification et que les données sont peu sensibles.
-- ----------------------------------------------------------------------------
-- create policy "anon_all_souscripteurs" on souscripteurs
--   for all to anon using (true) with check (true);
-- create policy "anon_all_lots" on lots
--   for all to anon using (true) with check (true);
-- create policy "anon_all_versements" on versements
--   for all to anon using (true) with check (true);

-- ============================================================================
-- PREMIER UTILISATEUR ADMINISTRATEUR
-- ----------------------------------------------------------------------------
-- Créez le premier compte via Dashboard > Authentication > Users > Add user,
-- ou via le menu "New user". Renseignez ensuite l'e-mail et le mot de passe
-- dans l'écran de connexion de l'application (mode cloud).
-- ============================================================================
