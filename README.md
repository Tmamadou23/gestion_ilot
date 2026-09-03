# GestiLot — Gestion & Suivi des Souscripteurs

Application web **professionnelle, moderne et responsive** de gestion des souscripteurs de lots
(lotissement / gestion foncière). Elle permet de suivre en temps réel les souscriptions, les
paiements et le solde de chaque souscripteur.

Conçue avec **HTML5, CSS3 et JavaScript vanilla uniquement** (aucun framework, aucune dépendance).
Elle fonctionne **directement dans le navigateur** : placez les fichiers dans un même dossier et
ouvrez `index.html`.

---

## 🔐 Connexion

| Mode | Identifiant | Mot de passe |
|------|-------------|--------------|
| **Local** (par défaut) | `admin` | `admin123` |
| **Cloud** (Supabase activé) | votre **e-mail** Supabase Auth | votre **mot de passe** |

> Pour activer le cloud, suivez la section « Base de données Cloud » ci-dessous (Paramètres → Base de données).

---

## 📁 Fichiers

| Fichier              | Rôle                                                        |
|----------------------|-------------------------------------------------------------|
| `index.html`         | Structure HTML (connexion, tableaux de bord, fiches, modales) |
| `style.css`          | Design complet & responsive (palette bleu/vert/orange)      |
| `script.js`          | Toute la logique : données, calculs, recherche, CRUD, exports, cloud |
| `supabase-schema.sql`| Schéma SQL pour créer la base de données partagée (Supabase) |
| `README.md`          | Ce document                                                 |

---

## ✨ Fonctionnalités

### Tableau de bord
- Souscripteurs, lots souscrits, montant attendu / encaissé / restant
- Souscripteurs soldés, paiements en cours, superficie totale
- Graphique d'évolution des paiements (12 derniers mois) + donut par statut

### Recherche rapide
- Barre en haut, résultat instantané par **nom**, **prénom**, **nom + prénom** ou **code**
- Ouverture automatique de la fiche correspondante (ex. `TRAORÉ`, `AZ-001`)

### Fiche détaillée
- Identité, lotissement, paiements, historique complet, barre de progression
- Boutons : Ajouter un versement, Modifier, Supprimer, Imprimer, Export PDF

### Souscripteurs (tableau)
- Colonnes : Code, Nom/Prénom, Lots, Superficie, Prix total, Versé, Reste, Statut, Actions
- Filtres par statut et par période, tri (nom / montant / reste), pagination
- Le formulaire comprend aussi le champ **Îlot**, enregistré dans Supabase.

### Versements
- Enregistrement de chaque versement (montant, date, mode, réf., observation)
- Recalcul automatique du total versé, du reste à payer et du statut

### Lots
- Vue consolidée de tous les lots avec leurs souscripteurs et valeurs

### Rapports & Export
- **Excel / CSV**, **JSON**, **impression** du rapport et **impression / PDF** de la fiche

### Paramètres & sécurité
- Connexion par identifiant / mot de passe (local) **ou** par Supabase Auth (cloud)
- Gestion du compte, déconnexion
- Journal des opérations effectuées par l'administrateur

Pour une base Supabase déjà créée, réexécutez `supabase-schema.sql` afin d'ajouter la colonne `ilot` sans supprimer les données existantes.

---

## 🧮 Calculs automatiques

```
Superficie totale = Superficie du lot
Prix total   = Prix unitaire du lot
Reste à payer = Prix total − Total des versements
Statut       = Soldé  si reste ≤ 0
               En cours si 0 < versé < prix total
               Non payé si aucun versement
```

---

## 🗄️ Deux modes de stockage

GestiLot fonctionne en **deux modes**, que vous choisissez dans **Paramètres → Base de données** :

### 1. Mode local (défaut, sans configuration)
- Les données sont stockées dans le **`localStorage`** du navigateur.
- Elles restent disponibles après fermeture, **mais restent sur cet appareil uniquement**.
- C'est le mode idéal pour tester ou pour un usage mono-poste.

### 2. Mode cloud (Supabase) — base de données partagée
- Les données sont centralisées dans une **base PostgreSQL (Supabase)** et **synchronisées
  automatiquement** à chaque ajout / modification / suppression.
- **Tous les appareils connectés** voient les mêmes données. Vos données ne dépendent plus
  du navigateur : elles survivent à la fermeture et sont partagées entre utilisateurs.
- C'est le mode recommandé si vous hébergez l'application sur **GitHub Pages** et que plusieurs
  personnes doivent y accéder.

Le bouton **⬆ Publier le local vers le cloud** pousse les données actuelles vers Supabase (pratique
au premier démarrage). Le bouton **⬇ Charger le cloud dans l'app** recharge depuis la base.
Le mode local est utilisé par défaut, même si une configuration Supabase est déjà enregistrée.
Pour activer le cloud, reconnectez la base dans les paramètres ; pour revenir au local, cliquez sur
**Utiliser le mode local**.

---

## ☁️ Mise en place de la base de données Cloud (Supabase) — 6 étapes

1. **Créez un compte gratuit** sur [supabase.com](https://supabase.com) et créez un **projet**
   (donnez-lui un nom, choisissez une région proche de vous — par ex. *West Europe*).

2. **Créez les tables.** Dans le dashboard : *SQL Editor → New query*, collez tout le contenu de
   **`supabase-schema.sql`** puis cliquez **Run**. Cela crée les 4 tables reliées
   (`utilisateurs`, `souscripteurs`, `lots`, `versements`) et les règles de sécurité (RLS).

3. **Récupérez vos identifiants.** Dans *Project Settings → API* :
   - **URL du projet** : ex. `https://abcdefgh.supabase.co`
   - **Anon key** (`anon public`), l'énorme clé en `eyJ...`

   > ⚠️ Utilisez la clé **anon** (public front-end), **jamais** la `service_role` (elle doit rester secrète côté serveur).

4. **Créez votre compte administrateur.** Dans *Authentication → Users → Add user*,
   renseignez un **e-mail** et un **mot de passe**. C'est ce couple que vous utiliserez pour vous connecter à l'app en mode cloud.

5. **Configurez l'application.** Ouvrez l'app → **Paramètres → Base de données** :
   - collez l'**URL** et la **clé anon** ;
   - cliquez **Connecter la base** (l'app vérifie la connexion) ;
   - si vous aviez des données locales, cliquez **⬆ Publier le local vers le cloud**.

6. **Connectez-vous.** Depuis l'écran de connexion, entrez votre **e-mail** et votre **mot de passe**
   Supabase. Les données sont alors chargées et partagées sur tous les appareils.

> 💡 Si vous préférez ouvrir la base à tous sans authentification (usage interne peu sensible),
> décommentez les lignes `anon_*` dans `supabase-schema.sql` et relancez le script.

---

## 🖥️ Lancer l'application

**Sans serveur (recommandé)** : double-cliquez simplement sur `index.html`.

**Avec un serveur local (optionnel)** :

```bash
cd gestion-souscripteurs
python3 -m http.server 8137
# puis ouvrez http://localhost:8137
```

---

## 📦 Données de démonstration

| Code     | Nom     | Prénom  | Lots | Superficie | Prix total   | Versé     | Statut    |
|----------|---------|---------|------|------------|--------------|-----------|-----------|
| LOT-001  | TUO     | Mamadou | 8    | 2 400 m²   | 8 000 000    | 5 000 000 | En cours  |
| LOT-002  | KOUASSI | Jean    | 4    | 1 200 m²   | 4 000 000    | 4 000 000 | Soldé     |
| LOT-003  | YAO     | Marie   | 2    | 600 m²     | 2 000 000    | 1 000 000 | En cours  |
| LOT-004  | TRAORÉ  | Mamadou | 2    | 1 000 m²   | 5 000 000    | 3 000 000 | En cours  |
| LOT-005  | KONE    | Awa     | 3    | 900 m²     | 3 000 000    | 0         | Non payé  |

---

## ⚙️ Personnalisation rapide

- **Palette** : modifiez les variables CSS en haut de `style.css` (blocs `:root`).
- **Devise** : le format `FCFA` est géré par `fmtFCFA()` dans `script.js`.
- **Statuts** : libellés et couleurs dans `STATUT_LABEL` / `STATUT_BADGE` de `script.js`.
- **Utilisateur local** : constantes `DEFAULT_USER` / `DEFAULT_PASS` dans `script.js`.

Le code est **commenté** en français pour être facilement modifiable.

---

## 📌 Note sur la concurrence (mode cloud)

En mode cloud, chaque appareil génère ses propres identifiants numériques. Pour un bureau
d'administration (quelques postes), c'est fiable. En cas de **saisies simultanées massives** depuis
plusieurs postes, il est préférable que les administrateurs coordonnent leurs ajouts, ou que l'on
passe à des identifiants générés par la base (UUID) — évolution envisageable si besoin.
