/* ==========================================================================
   GestiLot — Logique applicative
   Application de gestion et de suivi des souscripteurs (JavaScript vanilla).

   Structure :
     1. Utilitaires (formatage, dates)
     2. Persistance (localStorage) + données de démonstration
     3. Calculs dérivés (prix total, versé, reste, statut)
     4. Authentification
     5. Journal des opérations
     6. Rendu des vues (tableau de bord, souscripteurs, détail, etc.)
     7. Recherche rapide
     8. CRUD souscripteurs / versements
     9. Filtres, tri, pagination
    10. Exports (CSV / JSON / impression)
    11. Événements & initialisation
   ========================================================================== */

"use strict";

/* ----------------------------------------------------------------------------
   1. UTILITAIRES
   ---------------------------------------------------------------------------- */

/** Enregistre de façon générique — aucune dépendance externe. */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Formate un montant en FCFA : 1000000 -> "1 000 000 FCFA". */
function fmtFCFA(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("fr-FR") + " FCFA";
}

/** Formate une superficie : "2400" -> "2 400 m²". */
function fmtSuperficie(n) {
  const v = Number(n) || 0;
  const val = v % 1 === 0 ? v.toLocaleString("fr-FR") : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return val + " m²";
}

/** Convertit une date ISO "YYYY-MM-DD" vers "DD/MM/YYYY". */
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

/** Date du jour au format ISO. */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Échappe le HTML pour éviter toute injection dans les rendus. */
function esc(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ----------------------------------------------------------------------------
   STOCKAGE SÉCURISÉ
   Utilise localStorage / sessionStorage quand ils sont disponibles ; sinon
   (aperçu sandboxé, navigation privée restrictive) bascule sur un stockage en
   mémoire afin que l'application fonctionne dans tous les cas.
   ---------------------------------------------------------------------------- */
const memoryStore = new Map();

function makeStorage(getNative, prefix) {
  return {
    getItem(key) {
      try { return getNative().getItem(key); }
      catch (e) { return memoryStore.get(prefix + key) ?? null; }
    },
    setItem(key, value) {
      try { getNative().setItem(key, value); }
      catch (e) { memoryStore.set(prefix + key, value); }
    },
    removeItem(key) {
      try { getNative().removeItem(key); }
      catch (e) { memoryStore.delete(prefix + key); }
    },
  };
}

const LS = makeStorage(() => localStorage, "LS:");
const SS = makeStorage(() => sessionStorage, "SS:");

/* ----------------------------------------------------------------------------
   1.b COUCHE CLOUD — SUPABASE (base de données partagée)
   ----------------------------------------------------------------------------
   L'application peut fonctionner en deux modes :
     • Mode local (défaut)   : données conservées dans le navigateur (localStorage).
     • Mode cloud (Supabase) : données centralisées, partagées entre tous les
       appareils. Créez d'abord la base avec le fichier supabase-schema.sql,
       puis renseignez l'URL du projet et la clé "anon" dans Paramètres.
   ---------------------------------------------------------------------------- */

const SUPABASE_CFG_KEY = "gestilot.supabase";
const SUPABASE_TOKEN_KEY = "gestilot.supabase.token";
const STORAGE_MODE_KEY = "gestilot.storage.mode";

// Configuration publique du déploiement GitHub Pages.
// Remplacez ces deux valeurs par celles de votre projet Supabase.
const PUBLIC_SUPABASE_CONFIG = {
  url: "https://kwkbtysezjqtthnmpspk.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2J0eXNlempxdHRobm1wc3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDY4ODQsImV4cCI6MjEwMzkyMjg4NH0.qVzGqdxPkFzdQjYky2mcHz8VUMxjmBcZ6uz3sIXAcUA",
};

/** Configuration Supabase : { url, anonKey }. Chargée depuis le stockage. */
let supabaseConfig = { url: "", anonKey: "" };
/** Jeton d'accès de session (Supabase Auth). Vide si non connecté via cloud. */
let supabaseToken = "";

/** Charge la configuration Supabase enregistrée. */
function loadSupabaseConfig() {
  if (PUBLIC_SUPABASE_CONFIG.url && PUBLIC_SUPABASE_CONFIG.anonKey) {
    supabaseConfig = { ...PUBLIC_SUPABASE_CONFIG };
    LS.setItem(STORAGE_MODE_KEY, "cloud");
    return;
  }
  try {
    const cfg = JSON.parse(LS.getItem(SUPABASE_CFG_KEY));
    if (cfg && cfg.url && cfg.anonKey) supabaseConfig = cfg;
  } catch (e) { /* configuration absente -> mode local */ }
}

/** True si une base cloud est configurée. */
function isCloudEnabled() {
  return !!(supabaseConfig.url && supabaseConfig.anonKey)
    && (LS.getItem(STORAGE_MODE_KEY) === "cloud" || isPublicDeployment());
}

function isPublicDeployment() {
  return window.location.hostname.endsWith("github.io");
}

/** Restaure le jeton de session depuis le stockage de session. */
function restoreSupabaseToken() {
  supabaseToken = SS.getItem(SUPABASE_TOKEN_KEY) || "";
}

/**
 * Requête générique vers l'API REST de Supabase (vanilla fetch, sans dépendance).
 * Retourne le corps JSON de la réponse, ou null.
 */
async function cloudRequest(method, path, body) {
  if (!isCloudEnabled()) return null;
  const base = supabaseConfig.url.replace(/\/+$/, "");
  const headers = {
    "apikey": supabaseConfig.anonKey,
    "Authorization": "Bearer " + (supabaseToken || supabaseConfig.anonKey),
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Prefer": "return=representation,resolution=merge-duplicates",
  };
  const res = await fetch(base + "/rest/v1/" + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Supabase " + res.status + ": " + t);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ----- Mappage objets application <-> lignes de la base ----- */
function toVerseRow(subId, v) {
  return {
    id: v.id,
    souscripteur_id: subId,
    montant: Number(v.montant) || 0,
    date: v.date,
    mode: v.mode || "Autre",
    ref: v.ref || "",
    observation: v.observation || "",
  };
}
function fromVerseRow(v) {
  return {
    id: v.id,
    montant: Number(v.montant) || 0,
    date: v.date,
    mode: v.mode || "Autre",
    ref: v.ref || "",
    observation: v.observation || "",
  };
}
function toSouscripteurRow(sub, nested) {
  const row = {
    id: sub.id,
    code: sub.code,
    nom: sub.nom,
    prenom: sub.prenom,
    ilot: sub.ilot || "",
    numeros_lots: (sub.numerosLots || []).join(","),
    nombre_lots: Number(sub.nombreLots) || 0,
    superficie: Number(sub.superficie) || 0,
    prix_unitaire: Number(sub.prixUnitaire) || 0,
    date_adhesion: sub.dateAdhesion,
  };
  if (nested) {
    row.versements = (sub.versements || []).map((v) => toVerseRow(sub.id, v));
    row.lots = buildLotRowsToCloud(sub);
  }
  return row;
}
function fromSouscripteurRow(r) {
  return {
    id: r.id,
    code: r.code,
    nom: r.nom,
    prenom: r.prenom,
    ilot: r.ilot || "",
    numerosLots: String(r.numeros_lots || "").split(",").map((n) => n.trim()).filter(Boolean),
    nombreLots: Number(r.nombre_lots) || 0,
    superficie: Number(r.superficie) || 0,
    prixUnitaire: Number(r.prix_unitaire) || 0,
    dateAdhesion: r.date_adhesion,
    versements: (r.versements || []).map(fromVerseRow),
  };
}
/** Construit les lignes de la table `lots` à partir des données d'un souscripteur. */
function buildLotRowsToCloud(sub) {
  const n = Number(sub.nombreLots) || 0;
  const numbers = getLotNumbers(sub);
  const rows = [];
  for (let i = 1; i <= n; i++) {
    rows.push({
      id: sub.id * 1000 + i, // id déterministe et unique pour le lot
      souscripteur_id: sub.id,
      num_lot: i,
      numero_lot: numbers[i - 1],
      superficie: Number(sub.superficie) || 0,
      prix_unitaire: Number(sub.prixUnitaire) || 0,
      prix_total: Number(sub.prixUnitaire) || 0,
      statut: statut(sub),
    });
  }
  return rows;
}

function getLotNumbers(sub) {
  const n = Number(sub.nombreLots) || 0;
  const manual = Array.isArray(sub.numerosLots) ? sub.numerosLots : [];
  return Array.from({ length: n }, (_, i) => manual[i] || i + 1);
}

/* ----- Lecture / écriture depuis le cloud ----- */
async function hydrateFromCloud() {
  if (!isCloudEnabled()) return false;
  try {
    const rows = await cloudRequest("GET", "souscripteurs?select=*,versements(*)&order=id.asc");
    if (!Array.isArray(rows)) return false;
    subscribers = rows.map(fromSouscripteurRow);
    saveLocal();
    return true;
  } catch (e) {
    console.warn("Hydratation depuis le cloud impossible :", e);
    toast("Chargement depuis le cloud impossible.", "error");
    return false;
  }
}

/** Synchronise un souscripteur et ses versements/lots vers le cloud. */
async function syncSouscripteurRemote(sub) {
  if (!isCloudEnabled()) return true;
  // Met à jour / insère le souscripteur (upsert sur l'id).
  await cloudRequest("POST", "souscripteurs?on_conflict=id", [toSouscripteurRow(sub, false)]);
  // Remplace les versements puis les lots (simple et cohérent).
  await cloudRequest("DELETE", "versements?souscripteur_id=eq." + sub.id);
  const verseRows = (sub.versements || []).map((v) => toVerseRow(sub.id, v));
  if (verseRows.length) await cloudRequest("POST", "versements", verseRows);
  await cloudRequest("DELETE", "lots?souscripteur_id=eq." + sub.id);
  const lotRows = buildLotRowsToCloud(sub);
  if (lotRows.length) await cloudRequest("POST", "lots", lotRows);
  return true;
}

/** Supprime un souscripteur (et ses dépendances) sur le cloud. */
async function deleteSouscripteurRemote(id) {
  if (!isCloudEnabled()) return true;
  await cloudRequest("DELETE", "souscripteurs?id=eq." + id);
  return true;
}

/** Supprime tous les souscripteurs présents sur le cloud. */
async function clearAllOnCloud() {
  if (!isCloudEnabled()) return;
  try {
    const rows = await cloudRequest("GET", "souscripteurs?select=id");
    if (Array.isArray(rows)) {
      for (const r of rows) await cloudRequest("DELETE", "souscripteurs?id=eq." + r.id);
    }
  } catch (e) {
    console.warn("Nettoyage cloud échoué :", e);
  }
}

/** Remplace l'intégralité des données du cloud par le jeu actuel. */
async function persistAllOnCloud() {
  await clearAllOnCloud();
  await pushAllToCloud();
}

/** Publie l'intégralité des données locales vers le cloud. */
async function pushAllToCloud() {
  if (!isCloudEnabled()) return;
  try {
    let count = 0;
    for (const sub of subscribers) {
      await cloudRequest("POST", "souscripteurs?on_conflict=id", [toSouscripteurRow(sub, false)]);
      await cloudRequest("DELETE", "versements?souscripteur_id=eq." + sub.id);
      const verseRows = (sub.versements || []).map((v) => toVerseRow(sub.id, v));
      if (verseRows.length) await cloudRequest("POST", "versements", verseRows);
      await cloudRequest("DELETE", "lots?souscripteur_id=eq." + sub.id);
      const lotRows = buildLotRowsToCloud(sub);
      if (lotRows.length) await cloudRequest("POST", "lots", lotRows);
      count++;
    }
    journalLog("Publication des données vers le cloud (" + count + " souscripteur(s))");
    toast("Données publiées vers le cloud (" + count + ").", "success");
  } catch (e) {
    console.warn("Publication cloud échouée :", e);
    toast("Publication cloud échouée : " + (e.message || "erreur"), "error");
  }
}

/* ----- Authentification via Supabase Auth ----- */
async function supabaseSignIn(email, password) {
  const base = supabaseConfig.url.replace(/\/+$/, "");
  const res = await fetch(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "apikey": supabaseConfig.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password }),
  });
  if (!res.ok) throw new Error("Connexion Supabase refusée (" + res.status + ")");
  const data = await res.json();
  return data.access_token;
}

/* ----- Test de la connexion à la base ----- */
async function testSupabaseConnection() {
  if (!isCloudEnabled()) return { ok: false, msg: "Aucune configuration Supabase." };
  try {
    const all = await cloudRequest("GET", "souscripteurs?select=id");
    const count = Array.isArray(all) ? all.length : 0;
    return { ok: true, msg: "Connecté à Supabase — " + count + " souscripteur(s) sur le cloud." };
  } catch (e) {
    return { ok: false, msg: "Échec de connexion : " + (e.message || "erreur inconnue") };
  }
}

/* ----------------------------------------------------------------------------
   2. PERSISTANCE & DONNÉES DE DÉMONSTRATION
   ---------------------------------------------------------------------------- */

const STORE_KEY = "gestilot.data.v1";
const SESSION_KEY = "gestilot.session";
const AUTH_KEY = "gestilot.auth";

/** Jeu de données fiables garantissant des calculs et statuts variés. */
function seedData() {
  return [
    {
      id: 1, code: "LOT-001", nom: "TUO", prenom: "Mamadou",
      ilot: "",
      nombreLots: 8, superficie: 2400, prixUnitaire: 1000000, dateAdhesion: "2026-01-15",
      versements: [
        { id: 1, montant: 2000000, date: "2026-02-01", mode: "Espèces", ref: "ESP-001", observation: "Premier versement" },
        { id: 2, montant: 1500000, date: "2026-04-10", mode: "Mobile Money", ref: "MM-0145", observation: "" },
        { id: 3, montant: 1500000, date: "2026-06-20", mode: "Virement", ref: "VIR-2201", observation: "Virement bancaire" },
      ],
    },
    {
      id: 2, code: "LOT-002", nom: "KOUASSI", prenom: "Jean",
      ilot: "",
      nombreLots: 4, superficie: 1200, prixUnitaire: 1000000, dateAdhesion: "2026-01-20",
      versements: [
        { id: 4, montant: 4000000, date: "2026-03-05", mode: "Virement", ref: "VIR-1180", observation: "Soldé en totalité" },
      ],
    },
    {
      id: 3, code: "LOT-003", nom: "YAO", prenom: "Marie",
      ilot: "",
      nombreLots: 2, superficie: 600, prixUnitaire: 1000000, dateAdhesion: "2026-02-12",
      versements: [
        { id: 5, montant: 500000, date: "2026-03-01", mode: "Espèces", ref: "ESP-210", observation: "" },
        { id: 6, montant: 500000, date: "2026-05-15", mode: "Mobile Money", ref: "MM-0902", observation: "Versement partiel" },
      ],
    },
    {
      id: 4, code: "LOT-004", nom: "TRAORÉ", prenom: "Mamadou",
      ilot: "",
      nombreLots: 2, superficie: 1000, prixUnitaire: 2500000, dateAdhesion: "2026-03-15",
      versements: [
        { id: 7, montant: 1000000, date: "2026-03-15", mode: "Espèces", ref: "ESP-315", observation: "Acompte" },
        { id: 8, montant: 1000000, date: "2026-04-20", mode: "Mobile Money", ref: "MM-4500", observation: "" },
        { id: 9, montant: 1000000, date: "2026-06-15", mode: "Virement", ref: "VIR-3310", observation: "" },
      ],
    },
    {
      id: 5, code: "LOT-005", nom: "KONE", prenom: "Awa",
      ilot: "",
      nombreLots: 3, superficie: 900, prixUnitaire: 1000000, dateAdhesion: "2026-04-02",
      versements: [],
    },
  ];
}

/** Charge les données depuis le stockage (ou le jeu de démonstration). */
function loadData() {
  try {
    const raw = LS.getItem(STORE_KEY);
    if (!raw) {
      const seeded = seedData();
      LS.setItem(STORE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error("Lecture des données impossible :", e);
    return [];
  }
}

let subscribers = loadData();

/** Sauvegarde l'état complet des données (cache local). */
function saveData() {
  try {
    LS.setItem(STORE_KEY, JSON.stringify(subscribers));
  } catch (e) {
    console.error("Sauvegarde impossible :", e);
  }
}
/** Alias : sauvegarde locale du cache (utilisée par la couche cloud). */
function saveLocal() { saveData(); }

/**
 * Persiste une mutation dans le cache local puis la synchronise vers le cloud
 * (si la base Supabase est configurée). L'app reste réactive : le cloud est
 * synchronisé en arrière-plan.
 */
async function persist(sub) {
  saveData();
  if (sub && isCloudEnabled()) await syncSouscripteurRemote(sub);
}
async function persistDelete(id) {
  saveData();
  if (isCloudEnabled()) await deleteSouscripteurRemote(id);
}

/* Compteurs d'identifiants (maintien de l'unicité). */
function nextSouscripteurId() {
  return subscribers.reduce((m, s) => Math.max(m, s.id), 0) + 1;
}
function nextVersementId() {
  // Les identifiants de versements sont des clés primaires globales dans PostgreSQL.
  // Il faut donc rechercher le maximum sur tous les souscripteurs, pas seulement
  // dans le souscripteur actuellement sélectionné.
  return subscribers.reduce((maxId, s) => {
    const subMax = (s.versements || []).reduce(
      (m, v) => Math.max(m, Number(v.id) || 0),
      0
    );
    return Math.max(maxId, subMax);
  }, 0) + 1;
}

/* ----------------------------------------------------------------------------
   3. CALCULS DÉRIVÉS
   ---------------------------------------------------------------------------- */

/** Prix total = nombre de lots × prix unitaire. */
function prixTotal(sub) {
  return (Number(sub.nombreLots) || 0) * (Number(sub.prixUnitaire) || 0);
}

/** Total des versements d'un souscripteur. */
function totalVerse(sub) {
  return (sub.versements || []).reduce((s, v) => s + (Number(v.montant) || 0), 0);
}

/** Reste à payer = prix total − total des versements. */
function resteAPayer(sub) {
  return prixTotal(sub) - totalVerse(sub);
}

/**
 * Statut automatiquement déduit :
 *   Soldé      : reste <= 0
 *   Non payé   : aucun versement
 *   En cours   : partiellement payé (0 < versé < prix total)
 */
function statut(sub) {
  const reste = resteAPayer(sub);
  if (reste <= 0) return "soldé";
  if (totalVerse(sub) === 0) return "non payé";
  return "en cours";
}

const STATUT_LABEL = {
  "soldé": "Soldé",
  "en cours": "En cours",
  "non payé": "Non payé",
};

const STATUT_BADGE = {
  "soldé": "badge-solde",
  "en cours": "badge-en-cours",
  "non payé": "badge-non-paye",
};

/** Rend le badge HTML d'un statut. */
function badgeHTML(sub) {
  const s = statut(sub);
  return `<span class="badge ${STATUT_BADGE[s]}">${STATUT_LABEL[s]}</span>`;
}

/** Pourcentage de paiement effectué, borné à 100. */
function pourcentPaiement(sub) {
  const t = prixTotal(sub);
  if (t <= 0) return 0;
  return Math.min(100, (totalVerse(sub) / t) * 100);
}

/** Génère le prochain code AZ-XXX disponible. */
function nextCode() {
  let max = 0;
  subscribers.forEach((s) => {
    const m = /^AZ-(\d+)$/i.exec(s.code || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "AZ-" + String(max + 1).padStart(3, "0");
}

/* ----------------------------------------------------------------------------
   4. AUTHENTIFICATION
   ---------------------------------------------------------------------------- */

const DEFAULT_USER = "admin";
const DEFAULT_PASS = "admin123";

let currentUser = null;

function getAuth() {
  try {
    return JSON.parse(LS.getItem(AUTH_KEY)) || { user: DEFAULT_USER, pass: DEFAULT_PASS };
  } catch (e) {
    return { user: DEFAULT_USER, pass: DEFAULT_PASS };
  }
}

async function login(user, pass) {
  // Mode cloud : authentification auprès de Supabase Auth (e-mail + mot de passe).
  if (isCloudEnabled()) {
    try {
      const token = await supabaseSignIn(user, pass);
      supabaseToken = token;
      SS.setItem(SUPABASE_TOKEN_KEY, token);
      SS.setItem(SESSION_KEY, user);
      currentUser = user;
      journalLog("Connexion (cloud)");
      await hydrateFromCloud(); // recharge les données partagées
      return true;
    } catch (e) {
      console.warn("Connexion cloud échouée :", e);
      return false;
    }
  }
  if (isPublicDeployment()) return false;
  // Mode local : identifiant + mot de passe administrateur.
  const auth = getAuth();
  if (user.trim() === auth.user && pass === auth.pass) {
    currentUser = auth.user;
    SS.setItem(SESSION_KEY, auth.user);
    journalLog("Connexion");
    return true;
  }
  return false;
}

function logout() {
  journalLog("Déconnexion");
  currentUser = null;
  SS.removeItem(SESSION_KEY);
  SS.removeItem(SUPABASE_TOKEN_KEY);
  supabaseToken = "";
  showLogin();
}

function isLogged() {
  if (currentUser) return true;
  const u = SS.getItem(SESSION_KEY);
  if (u) { currentUser = u; return true; }
  return false;
}

/* ----------------------------------------------------------------------------
   5. JOURNAL DES OPÉRATIONS
   ---------------------------------------------------------------------------- */

const JOURNAL_KEY = "gestilot.journal.v1";

function getJournal() {
  try { return JSON.parse(LS.getItem(JOURNAL_KEY)) || []; }
  catch (e) { return []; }
}

function journalLog(action) {
  const j = getJournal();
  j.unshift({
    date: new Date().toLocaleString("fr-FR"),
    user: currentUser || DEFAULT_USER,
    action: action,
  });
  LS.setItem(JOURNAL_KEY, JSON.stringify(j.slice(0, 200)));
  renderJournal();
}

/* ----------------------------------------------------------------------------
   6. RENDU DES VUES
   ---------------------------------------------------------------------------- */

/** Navigation entre les pages (visionne les sections). */
function goTo(view) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  const el = $("#view-" + view);
  if (el) el.classList.add("active");
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  closeSidebar();
  if (view === "souscripteurs") renderSouscripteurs();
  if (view === "dashboard") renderDashboard();
  if (view === "versements") renderVersements();
  if (view === "lots") renderLots();
  if (view === "rapports") renderRapports();
  if (view === "parametres") renderParametres();
}

/* ---------- Tableau de bord ---------- */
function renderDashboard() {
  const total = subscribers.length;
  const soldes = subscribers.filter((s) => statut(s) === "soldé").length;
  const enCours = subscribers.filter((s) => statut(s) === "en cours").length;
  const nonPayes = subscribers.filter((s) => statut(s) === "non payé").length;
  const totalLots = subscribers.reduce((s, x) => s + Number(x.nombreLots), 0);
  const totalAttendu = subscribers.reduce((s, x) => s + prixTotal(x), 0);
  const totalEncaisse = subscribers.reduce((s, x) => s + totalVerse(x), 0);
  const totalReste = totalAttendu - totalEncaisse;
  const totalSuperficie = subscribers.reduce((s, x) => s + (Number(x.nombreLots) || 0) * (Number(x.superficie) || 0), 0);

  $("#stat-cards").innerHTML = `
    ${statCard("👥", "blue", "Souscripteurs", total, "enregistrés", "total")}
    ${statCard("🧱", "orange", "Lots souscrits", totalLots, "lots")}
    ${statCard("🏦", "blue", "Montant attendu", fmtFCFA(totalAttendu), "à recouvrer")}
    ${statCard("✅", "green", "Montant encaissé", fmtFCFA(totalEncaisse), "versé")}
    ${statCard("⏳", "orange", "Montant restant", fmtFCFA(totalReste), "à payer")}
    ${statCard("✓", "green", "Souscripteurs soldés", soldes, "payés en totalité")}
    ${statCard("🔄", "blue", "Paiement en cours", enCours, "partiellement payés")}
    ${statCard("📍", "gray", "Superficie totale", fmtSuperficie(totalSuperficie), "cumulée")}
  `;

  // Barre "versé / restant" agrégée.
  $("#paiement-chart").innerHTML = `
    <div class="chart-row">
      <span class="bar-label">Versé</span>
      <div class="bar-track"><div class="bar-fill verse" style="width:${pct(totalAttendu, totalEncaisse)}%"></div></div>
      <span class="bar-val">${fmtFCFA(totalEncaisse)}</span>
    </div>
    <div class="chart-row">
      <span class="bar-label">Restant</span>
      <div class="bar-track"><div class="bar-fill reste" style="width:${pct(totalAttendu, totalReste)}%"></div></div>
      <span class="bar-val">${fmtFCFA(totalReste)}</span>
    </div>
    <hr style="border:none;border-top:1px solid var(--gris-bord);margin:6px 0;">
    ${renderMonthlyChart()}
  `;

  // Donut par statut.
  const donutData = [
    { label: "Soldé", n: soldes, color: "var(--vert)" },
    { label: "En cours", n: enCours, color: "var(--orange)" },
    { label: "Non payé", n: nonPayes, color: "var(--rouge)" },
  ];
  renderDonut("#statut-chart", donutData, total);
}

function statCard(ico, color, label, value, sub, type) {
  const fontWeight = type === "total" ? "" : "";
  return `
    <div class="stat-card">
      <div class="stat-ico ${color}">${ico}</div>
      <div class="stat-info">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="${fontWeight}">${value}</div>
        <div class="stat-sub">${sub}</div>
      </div>
    </div>`;
}

function pct(total, part) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

/** Graphique d'évolution des paiements (barres mensuelles). */
function renderMonthlyChart() {
  const months = buildMonthMap();
  const max = Math.max(1, ...Object.values(months).map((m) => m.tot));
  const labels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  const bars = Object.keys(months).sort().map((k) => {
    const m = months[k];
    const h = Math.max(4, (m.tot / max) * 100);
    const isCurrent = m.month === new Date().getMonth();
    const color = isCurrent ? "var(--bleu-clair)" : "var(--bleu)";
    return `
      <div class="month-bar" title="${m.label} : ${fmtFCFA(m.tot)}">
        <div class="month-col" style="height:${h}%;background:${color}"></div>
        <span class="month-lbl">${labels[m.month]}</span>
      </div>`;
  }).join("");
  return `
    <div class="mini-head">Évolution des versements (12 derniers mois)</div>
    <div class="month-chart">${bars}</div>`;
}

/** Production d'une map mois → total versé sur les 12 derniers mois. */
function buildMonthMap() {
  const map = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = d.getFullYear() + "-" + (d.getMonth() + 1);
    map[k] = { month: d.getMonth(), tot: 0, label: "" };
  }
  subscribers.forEach((s) => (s.versements || []).forEach((v) => {
    const d = new Date(v.date + "T00:00:00");
    if (isNaN(d.getTime())) return;
    const k = d.getFullYear() + "-" + (d.getMonth() + 1);
    if (map[k]) map[k].tot += Number(v.montant) || 0;
  }));
  return map;
}

/** Dessine un donut (conic-gradient) représentant la répartition par statut. */
function renderDonut(sel, data, total) {
  if (total === 0) {
    $(sel).innerHTML = `<p class="muted">Aucune donnée à afficher.</p>`;
    return;
  }
  let acc = 0;
  const stops = data.filter((d) => d.n > 0).map((d) => {
    const start = (acc / total) * 360;
    acc += d.n;
    const end = (acc / total) * 360;
    return `${d.color} ${start}deg ${end}deg`;
  });
  const gradient = stops.length ? `conic-gradient(${stops.join(",")})` : "conic-gradient(#eee 0deg 360deg)";
  const legend = data.map((d) => `
    <div class="legend-item"><span class="dot" style="background:${d.color}"></span>${d.label} <strong>${d.n}</strong></div>
  `).join("");
  $(sel).innerHTML = `
    <div class="donut" style="background:${gradient}">
      <div class="donut-center"><strong>${total}</strong><span>souscripteurs</span></div>
    </div>
    <div class="donut-legend">${legend}</div>`;
}

/* ---------- Table des souscripteurs ---------- */
const PER_PAGE = 10;
let listState = { page: 1, filters: { statut: "all", from: "", to: "", q: "" }, sort: "nom-asc" };

function renderSouscripteurs() {
  const filtered = filterAndSort();
  $("#count-souscripteurs").textContent = subscribers.length;
  $("#table-empty").classList.toggle("hidden", filtered.length > 0);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (listState.page > pages) listState.page = pages;
  const start = (listState.page - 1) * PER_PAGE;
  const slice = filtered.slice(start, start + PER_PAGE);

  const tbody = $("#souscripteurs-tbody");
  if (!slice.length) {
    tbody.innerHTML = "";
    $("#pagination").innerHTML = "";
    return;
  }
  tbody.innerHTML = slice.map((s) => rowHTML(s)).join("");
  renderPagination(filtered.length, pages);
}

function rowHTML(s) {
  return `
    <tr class="clickable" data-id="${s.id}">
      <td><span class="code-cell">${esc(s.code)}</span></td>
      <td><span class="name-cell">${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</span></td>
      <td class="num">${s.nombreLots}</td>
      <td class="num">${fmtSuperficie((Number(s.nombreLots) || 0) * (Number(s.superficie) || 0))}</td>
      <td class="num">${fmtFCFA(prixTotal(s))}</td>
      <td class="num"><strong style="color:var(--vert)">${fmtFCFA(totalVerse(s))}</strong></td>
      <td class="num"><strong style="color:${statut(s)==="soldé"?"var(--vert)":"var(--rouge)"}">${fmtFCFA(Math.max(0,resteAPayer(s)))}</strong></td>
      <td>${badgeHTML(s)}</td>
      <td><div class="actions-cell">
        <button class="btn-icon-action" data-action="voir" title="Voir">👁</button>
        <button class="btn-icon-action" data-action="modifier" title="Modifier">✏️</button>
        <button class="btn-icon-action danger" data-action="supprimer" title="Supprimer">🗑</button>
      </div></td>
    </tr>`;
}

function renderPagination(total, pages) {
  const pag = $("#pagination");
  if (pages <= 1) { pag.innerHTML = ""; return; }
  const btn = (p, label, disabled, active) =>
    `<button data-page="${p}" ${disabled ? "disabled" : ""} class="${active ? "active" : ""}">${label}</button>`;
  let html = btn(listState.page - 1, "‹", listState.page === 1, false);
  for (let p = 1; p <= pages; p++) html += btn(p, p, false, p === listState.page);
  html += btn(listState.page + 1, "›", listState.page === pages, false);
  pag.innerHTML = html;
}

/* ---------- Filtre / tri / recherche interne ---------- */
function filterAndSort() {
  const f = listState.filters;
  let out = subscribers.filter((s) => {
    if (f.statut !== "all") {
      const st = statut(s);
      // "partiel" est traité comme "en cours" (paiement partiel).
      const target = f.statut === "partiel" ? "en cours" : f.statut;
      if (st !== target) return false;
    }
    if (f.from && s.dateAdhesion && s.dateAdhesion < f.from) return false;
    if (f.to && s.dateAdhesion && s.dateAdhesion > f.to) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const hay = (s.nom + " " + s.prenom + " " + s.code + " " + (s.ilot || "")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  switch (listState.sort) {
    case "nom-asc": out.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr")); break;
    case "nom-desc": out.sort((a, b) => (b.nom + b.prenom).localeCompare(a.nom + a.prenom, "fr")); break;
    case "montant-desc": out.sort((a, b) => prixTotal(b) - prixTotal(a)); break;
    case "montant-asc": out.sort((a, b) => prixTotal(a) - prixTotal(b)); break;
    case "reste-desc": out.sort((a, b) => resteAPayer(b) - resteAPayer(a)); break;
    case "reste-asc": out.sort((a, b) => resteAPayer(a) - resteAPayer(b)); break;
    case "date-desc": out.sort((a, b) => (b.dateAdhesion || "").localeCompare(a.dateAdhesion || "")); break;
  }
  return out;
}

/* ---------- Fiche détaillée ---------- */
let currentDetailId = null;

function openDetail(id) {
  const s = subscribers.find((x) => x.id === id);
  if (!s) return;
  currentDetailId = id;
  $("#detail-title").textContent = `Fiche — ${s.nom.toUpperCase()} ${s.prenom}`;
  const pct = pourcentPaiement(s).toFixed(1);
  const complete = statut(s) === "soldé";

  const versementsRows = (s.versements || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map((v, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="num"><strong>${fmtFCFA(v.montant)}</strong></td>
      <td>${fmtDate(v.date)}</td>
      <td>${esc(v.mode)}</td>
      <td>${esc(v.ref || "—")}</td>
      <td>${esc(v.observation || "—")}</td>
      <td><div class="actions-cell">
        <button class="btn-icon-action" data-edit-pay="${v.id}" title="Modifier">✏️</button>
        <button class="btn-icon-action danger" data-del-pay="${v.id}" title="Supprimer">🗑</button>
      </div></td>
    </tr>`).join("");

  $("#detail-body").innerHTML = `
    <div class="fiche-grid">
      <div class="fiche-section">
        <div class="fiche-top">
          <div class="f-avatar">${esc((s.prenom[0] || "?").toUpperCase())}</div>
          <div>
            <h3>${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</h3>
            <p class="muted">${esc(s.code)} · Adhésion le ${fmtDate(s.dateAdhesion)}</p>
            ${badgeHTML(s)}
          </div>
        </div>
        <h3>🏷️ Identité</h3>
        <div class="detail-list">
          <div class="detail-row"><span class="dl-label">Nom</span><span class="dl-value">${esc(s.nom.toUpperCase())}</span></div>
          <div class="detail-row"><span class="dl-label">Prénom</span><span class="dl-value">${esc(s.prenom)}</span></div>
          <div class="detail-row"><span class="dl-label">Code</span><span class="dl-value code-cell">${esc(s.code)}</span></div>
          <div class="detail-row"><span class="dl-label">Îlot</span><span class="dl-value">${esc(s.ilot || "—")}</span></div>
          <div class="detail-row"><span class="dl-label">Date d'adhésion</span><span class="dl-value">${fmtDate(s.dateAdhesion)}</span></div>
        </div>
      </div>

      <div class="fiche-section">
        <h3>🧱 Lotissement</h3>
        <div class="detail-list">
          <div class="detail-row"><span class="dl-label">Nombre de lots</span><span class="dl-value">${s.nombreLots}</span></div>
          <div class="detail-row"><span class="dl-label">Superficie par lot</span><span class="dl-value">${fmtSuperficie(s.superficie)}</span></div>
          <div class="detail-row"><span class="dl-label">Superficie totale</span><span class="dl-value">${fmtSuperficie((Number(s.nombreLots) || 0) * (Number(s.superficie) || 0))}</span></div>
          <div class="detail-row"><span class="dl-label">Prix unitaire</span><span class="dl-value">${fmtFCFA(s.prixUnitaire)}</span></div>
          <div class="detail-row"><span class="dl-label">Prix total</span><span class="dl-value">${fmtFCFA(prixTotal(s))}</span></div>
        </div>
        <h3 style="margin-top:18px">Lots associés</h3>
        <div class="table-scroll">
          <table class="table" style="min-width:100%">
            <thead><tr><th>N° lot</th><th class="num">Superficie</th><th class="num">Prix unitaire</th><th class="num">Prix</th></tr></thead>
            <tbody>${lotRows(s)}</tbody>
          </table>
        </div>
      </div>

      <div class="fiche-section">
        <h3>💰 Paiements</h3>
        <div class="detail-list">
          <div class="detail-row"><span class="dl-label">Montant total</span><span class="dl-value">${fmtFCFA(prixTotal(s))}</span></div>
          <div class="detail-row"><span class="dl-label">Montant payé</span><span class="dl-value" style="color:var(--vert)">${fmtFCFA(totalVerse(s))}</span></div>
          <div class="detail-row"><span class="dl-label">Reste à payer</span><span class="dl-value" style="color:${complete?"var(--vert)":"var(--rouge)"}">${fmtFCFA(Math.max(0, resteAPayer(s)))}</span></div>
          <div class="detail-row"><span class="dl-label">Statut</span><span class="dl-value">${badgeHTML(s)}</span></div>
        </div>
        <div class="progress-wrap">
          <div class="progress-track"><div class="progress-fill ${complete ? "complete" : ""}" style="width:${Math.min(100, pct)}%"></div></div>
          <div class="progress-labels"><span>Paiement effectué : ${pct} %</span><span>${complete ? "✔ Soldé" : fmtFCFA(Math.max(0, resteAPayer(s))) + " restant"}</span></div>
        </div>
      </div>

      <div class="fiche-section">
        <h3>📜 Historique des versements</h3>
        <div class="table-scroll">
          <table class="table" style="min-width:100%">
            <thead><tr><th class="num">N°</th><th class="num">Montant</th><th>Date</th><th>Mode</th><th>Réf.</th><th>Observation</th><th>Actions</th></tr></thead>
            <tbody>${versementsRows || `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Aucun versement enregistré.</td></tr>`}</tbody>
          </table>
        </div>
        <p class="muted" style="margin-top:10px"><strong>Total versé :</strong> ${fmtFCFA(totalVerse(s))}</p>
      </div>
    </div>`;
  goTo("detail");
}

/** Génère les lignes de lots individuelles d'un souscripteur. */
function lotRows(s) {
  const n = Number(s.nombreLots) || 0;
  const numbers = getLotNumbers(s);
  if (n <= 0) return `<tr><td colspan="4" class="muted" style="text-align:center">Aucun lot</td></tr>`;
  let html = "";
  for (let i = 1; i <= n; i++) {
    html += `
      <tr>
        <td><span class="code-cell">${esc(numbers[i - 1])}</span></td>
        <td class="num">${fmtSuperficie(s.superficie)}</td>
        <td class="num">${fmtFCFA(s.prixUnitaire)}</td>
        <td class="num">${fmtFCFA(s.prixUnitaire)}</td>
      </tr>`;
  }
  return html;
}

/* ---------- Page Versements ---------- */
function renderVersements() {
  const rows = [];
  subscribers.forEach((s) => {
    (s.versements || []).slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((v) => {
      rows.push({ s, v });
    });
  });
  rows.sort((a, b) => b.v.date.localeCompare(a.v.date));
  $("#versements-empty").classList.toggle("hidden", rows.length > 0);
  $("#versements-tbody").innerHTML = rows.map(({ s, v }) => `
    <tr>
      <td class="num">#${v.id}</td>
      <td><span class="name-cell">${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</span></td>
      <td><span class="code-cell">${esc(s.code)}</span></td>
      <td class="num"><strong>${fmtFCFA(v.montant)}</strong></td>
      <td>${fmtDate(v.date)}</td>
      <td>${esc(v.mode)}</td>
      <td>${esc(v.observation || "—")}</td>
      <td><div class="actions-cell">
        <button class="btn-icon-action" data-open-sub="${s.id}" title="Voir souscripteur">👁</button>
      </div></td>
    </tr>`).join("");
}

/* ---------- Page Lots ---------- */
function renderLots() {
  const all = [];
  subscribers.forEach((s) => {
    const n = Number(s.nombreLots) || 0;
    const numbers = getLotNumbers(s);
    for (let i = 1; i <= n; i++) {
      all.push({ s, num: i, numero: numbers[i - 1] });
    }
  });
  const totalLots = all.length;
  const totalSuperficie = subscribers.reduce((x, s) => x + (Number(s.nombreLots) || 0) * (Number(s.superficie) || 0), 0);
  const totalPrix = subscribers.reduce((x, s) => x + prixTotal(s), 0);
  const soldes = all.filter(({ s }) => statut(s) === "soldé").length;
  $("#lots-stats").innerHTML = `
    ${statCard("🧱", "blue", "Lots", totalLots, "enregistrés")}
    ${statCard("📐", "gray", "Superficie", fmtSuperficie(totalSuperficie), "cumulée")}
    ${statCard("🏦", "blue", "Valeur", fmtFCFA(totalPrix), "prix total")}
    ${statCard("✓", "green", "Lots soldés", soldes, "payés")}`;

  $("#lots-empty").classList.toggle("hidden", all.length > 0);
  const st = renderLotsStatus(s => statut(s));
  $("#lots-tbody").innerHTML = all.map(({ s, num, numero }) => `
    <tr class="clickable" data-id="${s.id}">
      <td><span class="code-cell">${esc(numero)}</span></td>
      <td><span class="name-cell">${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</span></td>
      <td><span class="code-cell">${esc(s.code)}</span></td>
      <td class="num">${fmtSuperficie(s.superficie)}</td>
      <td class="num">${fmtFCFA(s.prixUnitaire)}</td>
      <td class="num">${fmtFCFA(s.prixUnitaire)}</td>
      <td>${badgeHTML(s)}</td>
    </tr>`).join("");
}

function renderLotsStatus(fn) { /* simple helper, statut déjà calculé dans badgeHTML */ }

/* ---------- Rapports ---------- */
function renderRapports() {
  const total = subscribers.length;
  const soldes = subscribers.filter((s) => statut(s) === "soldé").length;
  const enCours = subscribers.filter((s) => statut(s) === "en cours").length;
  const nonPayes = subscribers.filter((s) => statut(s) === "non payé").length;
  const totalAttendu = subscribers.reduce((s, x) => s + prixTotal(x), 0);
  const totalEncaisse = subscribers.reduce((s, x) => s + totalVerse(x), 0);
  const totalReste = totalAttendu - totalEncaisse;
  $("#report-summary").innerHTML = `
    ${rsItem("Souscripteurs", total)}
    ${rsItem("Soldés", soldes)}
    ${rsItem("En cours", enCours)}
    ${rsItem("Non payé", nonPayes)}
    ${rsItem("Montant attendu", fmtFCFA(totalAttendu))}
    ${rsItem("Montant encaissé", fmtFCFA(totalEncaisse))}
    ${rsItem("Reste à encaisser", fmtFCFA(totalReste))}
    ${rsItem("Taux de recouvrement", pct(totalAttendu, totalEncaisse) + " %")}`;
}
function rsItem(l, v) { return `<div class="rs-item"><span>${l}</span><strong>${v}</strong></div>`; }

/* ---------- Paramètres ---------- */
function renderParametres() {
  const auth = getAuth();
  $("#s-user").value = auth.user;
  $("#s-pass").value = auth.pass;
  // Affichage de la configuration cloud Supabase.
  const urlField = $("#db-url");
  const anonField = $("#db-anon");
  if (urlField) urlField.value = supabaseConfig.url || "";
  if (anonField) anonField.value = supabaseConfig.anonKey || "";
  const status = $("#db-status");
  if (status) {
    status.textContent = isCloudEnabled()
      ? "✓ Mode cloud actif — les données sont partagées via Supabase."
      : "Mode local — les données restent dans ce navigateur. Activez le cloud pour les partager.";
  }
  renderJournal();
}

/** Adapte l'indication de l'écran de connexion selon le mode actif. */
function updateLoginHint() {
  const h = $("#login-hint");
  if (!h) return;
  if (isCloudEnabled()) {
    h.innerHTML = '<strong>Mode cloud :</strong> connectez-vous avec votre <strong>e-mail</strong> et votre <strong>mot de passe</strong> Supabase Auth.';
  } else if (isPublicDeployment()) {
    h.innerHTML = '<strong>Configuration cloud manquante :</strong> renseignez les identifiants Supabase dans le code avant de publier cette application.';
  } else {
    h.innerHTML = 'Accès par défaut (local) : identifiant <strong>admin</strong> — mot de passe <strong>admin123</strong>.';
  }
}

function renderJournal() {
  const j = getJournal();
  $("#journal-empty").classList.toggle("hidden", j.length > 0);
  $("#journal-tbody").innerHTML = j.slice(0, 50).map((e) => `
    <tr><td>${e.date}</td><td>${esc(e.user)}</td><td>${esc(e.action)}</td></tr>`).join("");
}

/* ----------------------------------------------------------------------------
   7. RECHERCHE RAPIDE (barre en haut)
   ---------------------------------------------------------------------------- */

/** Recherche instantanée sur nom, prénom ou code — affiche une liste. */
function runGlobalSearch(q) {
  const box = $("#search-results");
  q = q.trim().toLowerCase();
  if (!q) {
    box.classList.add("hidden");
    return;
  }
  const results = subscribers.filter((s) => {
    const hay = (s.nom + " " + s.prenom + " " + s.code + " " + s.nom + s.prenom).toLowerCase();
    // Recherche sur le nom seul, prénom seul, nom+prénom, code.
    return hay.includes(q);
  });
  if (!results.length) {
    box.innerHTML = `<div class="search-result-item"><div class="sr-main"><span class="sr-name">Aucun souscripteur trouvé.</span><div class="sr-sub">Vérifiez le nom ou le code saisi.</div></div></div>`;
  } else {
    box.innerHTML = results.slice(0, 8).map((s) => `
      <div class="search-result-item" data-open-sub="${s.id}">
        <div class="search-avatar">${esc((s.prenom[0] || "?").toUpperCase())}</div>
        <div class="sr-main">
          <div class="sr-name">${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</div>
          <div class="sr-sub">${esc(s.code)} · ${s.nombreLots} lot(s) · ${fmtSuperficie(s.superficie)}</div>
        </div>
        <div class="sr-right">
          <div style="font-weight:700">${fmtFCFA(Math.max(0, resteAPayer(s)))}</div>
          <span class="statut">${badgeHTML(s)}</span>
        </div>
      </div>`).join("");
  }
  box.classList.remove("hidden");
}

/* ----------------------------------------------------------------------------
   8. CRUD — SOUSCRIPTEURS & VERSEMENTS
   ---------------------------------------------------------------------------- */

/* ----- Formulaire nouveau / modifier ----- */
let editingId = null;

function resetForm() {
  editingId = null;
  $("#form-title").textContent = "Nouveau souscripteur";
  $("#form-subtitle").textContent = "Renseignez les informations du souscripteur.";
  $("#btn-save-form").textContent = "Enregistrer le souscripteur";
  $("#subscriber-form").reset();
  $("#f-lots").value = 1;
  renderLotNumberFields();
  $("#f-date").value = todayISO();
  $("#f-code").value = nextCode();
  $("#f-code-suggest").textContent = nextCode();
  updatePreview();
}

function loadFormForEdit(id) {
  const s = subscribers.find((x) => x.id === id);
  if (!s) return;
  editingId = id;
  $("#form-title").textContent = "Modifier le souscripteur";
  $("#form-subtitle").textContent = `Modification de ${s.nom.toUpperCase()} ${s.prenom}`;
  $("#btn-save-form").textContent = "Mettre à jour";
  $("#f-nom").value = s.nom;
  $("#f-prenom").value = s.prenom;
  $("#f-code").value = s.code;
  $("#f-ilot").value = s.ilot || "";
  $("#f-date").value = s.dateAdhesion;
  $("#f-lots").value = s.nombreLots;
  renderLotNumberFields(s.numerosLots || []);
  $("#f-superficie").value = s.superficie;
  $("#f-prix").value = s.prixUnitaire;
  $("#f-verse-initial").value = "";
  updatePreview();
  goTo("ajouter");
}

function renderLotNumberFields(values = []) {
  const container = $("#lot-numbers-fields");
  if (!container) return;
  const count = Number($("#f-lots").value) || 0;
  container.innerHTML = Array.from({ length: count }, (_, index) => `
    <div class="field">
      <label for="f-lot-number-${index + 1}">Numéro du lot ${index + 1}</label>
      <input type="number" id="f-lot-number-${index + 1}" name="lot-number-${index + 1}"
        min="1" step="1" value="${esc(values[index] || "")}" placeholder="ex. ${index + 1}" required />
    </div>`).join("");
}

function getFormLotNumbers() {
  return $$("#lot-numbers-fields input").map((input) => Number(input.value)).filter((number) => Number.isInteger(number) && number > 0);
}

/** Met à jour l'aperçu des calculs en temps réel dans le formulaire. */
function updatePreview() {
  const lots = Number($("#f-lots").value) || 0;
  const prix = Number($("#f-prix").value) || 0;
  const initial = Number($("#f-verse-initial").value) || 0;
  const total = lots * prix;
  const verse = initial;
  const reste = total - verse;
  $("#pv-total").textContent = fmtFCFA(total);
  $("#pv-verse").textContent = fmtFCFA(verse);
  $("#pv-reste").textContent = fmtFCFA(Math.max(0, reste));
  const st = reste <= 0 ? "soldé" : (verse === 0 ? "non payé" : "en cours");
  $("#pv-statut").textContent = STATUT_LABEL[st];
  $("#pv-statut").className = "badge " + STATUT_BADGE[st];
}

async function submitSubscriber(e) {
  e.preventDefault();
  const code = $("#f-code").value.trim();
  const expectedLotCount = Number($("#f-lots").value) || 0;
  const lotNumbers = getFormLotNumbers();
  if (lotNumbers.length !== expectedLotCount) {
    toast("Renseignez le numéro de chaque lot.", "error");
    return;
  }
  if (new Set(lotNumbers).size !== lotNumbers.length) {
    toast("Chaque numéro de lot doit être différent.", "error");
    return;
  }
  // Vérification d'unicité du code.
  const dup = subscribers.find((s) => s.code.toLowerCase() === code.toLowerCase() && s.id !== editingId);
  if (dup) {
    toast("Ce code est déjà utilisé. Choisissez un code unique.", "error");
    return;
  }
  const payload = {
    code: code,
    nom: $("#f-nom").value.trim(),
    prenom: $("#f-prenom").value.trim(),
    ilot: $("#f-ilot").value.trim(),
    numerosLots: lotNumbers,
    nombreLots: Number($("#f-lots").value) || 0,
    superficie: Number($("#f-superficie").value) || 0,
    prixUnitaire: Number($("#f-prix").value) || 0,
    dateAdhesion: $("#f-date").value || todayISO(),
  };

  const initial = Number($("#f-verse-initial").value) || 0;
  let savedSub = null;
  if (editingId) {
    const s = subscribers.find((x) => x.id === editingId);
    Object.assign(s, payload);
    // Si un versement initial a été saisi lors d'une modification, on l'ajoute.
    if (initial > 0) {
      s.versements.push({
        id: nextVersementId(),
        montant: initial,
        date: $("#f-date").value || todayISO(),
        mode: "Autre",
        ref: "",
        observation: "Versement initial",
      });
    }
    savedSub = s;
    journalLog(`Modification du souscripteur ${payload.code}`);
  } else {
    const s = {
      id: nextSouscripteurId(),
      ...payload,
      versements: [],
    };
    if (initial > 0) {
      s.versements.push({
        id: nextVersementId(), montant: initial, date: s.dateAdhesion || todayISO(),
        mode: "Autre", ref: "", observation: "Versement initial",
      });
    }
    subscribers.push(s);
    savedSub = s;
    journalLog(`Ajout du souscripteur ${payload.code}`);
  }
  try {
    await persist(savedSub);
  } catch (error) {
    console.warn("Synchronisation cloud échouée :", error);
    toast("Enregistrement local effectué, mais la synchronisation cloud a échoué.", "error");
    return;
  }
  toast(editingId ? "Souscripteur modifié avec succès." : "Souscripteur ajouté avec succès.", "success");
  resetForm();
  goTo("souscripteurs");
  renderDashboard();
}

/* ----- Suppression d'un souscripteur ----- */
function confirmDeleteSubscriber(id) {
  const s = subscribers.find((x) => x.id === id);
  if (!s) return;
  confirmAction(`Voulez-vous vraiment supprimer ce souscripteur (${s.nom.toUpperCase()} ${s.prenom}) ? Toutes ses données et ses versements seront supprimés.`, () => {
    subscribers = subscribers.filter((x) => x.id !== id);
    journalLog(`Suppression du souscripteur ${s.code}`);
    persistDelete(id).then(() => {
      toast("Souscripteur supprimé.", "success");
    }).catch((error) => {
      console.warn("Suppression cloud échouée :", error);
      toast("Suppression locale effectuée, mais la suppression cloud a échoué.", "error");
    });
    if (currentDetailId === id) currentDetailId = null;
    goTo("souscripteurs");
    renderSouscripteurs();
    renderDashboard();
  });
}

/* ----- Versements ----- */
function openPaymentModal(subId, payId) {
  const s = subscribers.find((x) => x.id === subId);
  if (!s) return;
  const existing = payId ? s.versements.find((v) => v.id === payId) : null;
  $("#payment-modal-title").textContent = existing ? "Modifier le versement" : "Ajouter un versement";
  $("#p-id").value = existing ? payId : "";
  $("#p-sub-id").value = subId;
  $("#payment-target").innerHTML = `Souscripteur : <strong>${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</strong> — ${esc(s.code)}`;

  $("#p-montant").value = existing ? existing.montant : "";
  $("#p-date").value = existing ? existing.date : todayISO();
  $("#p-mode").value = existing ? existing.mode : "Espèces";
  $("#p-ref").value = existing ? (existing.ref || "") : "";
  $("#p-obs").value = existing ? (existing.observation || "") : "";
  updatePaymentPreview();
  openModal("modal-payment");
}

function updatePaymentPreview() {
  const subId = $("#p-sub-id").value;
  const s = subscribers.find((x) => x.id == subId);
  if (!s) return;
  const montant = Number($("#p-montant").value) || 0;
  const after = totalVerse(s) + montant;
  const reste = prixTotal(s) - after;
  $("#pv-after").textContent = fmtFCFA(after);
  $("#pv-reste-after").textContent = fmtFCFA(Math.max(0, reste));
  const st = reste <= 0 ? "soldé" : (after === 0 ? "non payé" : "en cours");
  $("#pv-statut-after").textContent = STATUT_LABEL[st];
  $("#pv-statut-after").className = "badge " + STATUT_BADGE[st];
}

async function submitPayment(e) {
  e.preventDefault();
  const subId = Number($("#p-sub-id").value);
  const payId = $("#p-id").value ? Number($("#p-id").value) : null;
  const s = subscribers.find((x) => x.id === subId);
  if (!s) return;
  const payload = {
    montant: Number($("#p-montant").value) || 0,
    date: $("#p-date").value || todayISO(),
    mode: $("#p-mode").value,
    ref: $("#p-ref").value.trim(),
    observation: $("#p-obs").value.trim(),
  };
  if (payload.montant <= 0) { toast("Le montant doit être supérieur à 0.", "error"); return; }

  if (payId) {
    const v = s.versements.find((x) => x.id === payId);
    Object.assign(v, payload);
    journalLog(`Modification du versement #${payId} de ${s.code}`);
  } else {
    s.versements.push({ id: nextVersementId(), ...payload });
    journalLog(`Ajout d'un versement de ${fmtFCFA(payload.montant)} à ${s.code}`);
  }
  try {
    await persist(s);
  } catch (error) {
    console.warn("Synchronisation cloud échouée :", error);
    toast("Versement enregistré localement, mais la synchronisation cloud a échoué.", "error");
    return;
  }
  toast(payId ? "Versement modifié." : "Versement enregistré.", "success");
  closeModal("modal-payment");
  renderSouscripteurs();
  renderVersements();
  if (currentDetailId === subId) openDetail(subId);
  renderDashboard();
}

function confirmDeletePayment(subId, payId) {
  const s = subscribers.find((x) => x.id === subId);
  if (!s) return;
  const v = s.versements.find((y) => y.id === payId);
  confirmAction(`Voulez-vous vraiment supprimer ce versement de ${fmtFCFA(v.montant)} ?`, async () => {
    s.versements = s.versements.filter((y) => y.id !== payId);
    journalLog(`Suppression du versement #${payId} de ${s.code}`);
    try {
      await persist(s);
      toast("Versement supprimé.", "success");
    } catch (error) {
      console.warn("Synchronisation cloud échouée :", error);
      toast("Suppression locale effectuée, mais la synchronisation cloud a échoué.", "error");
    }
    renderSouscripteurs();
    renderVersements();
    if (currentDetailId === subId) openDetail(subId);
    renderDashboard();
  });
}

/* ----------------------------------------------------------------------------
   9. EXPORTS (CSV / JSON / IMPRESSION)
   ---------------------------------------------------------------------------- */

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const header = ["Code", "Nom", "Prénom", "Îlot", "Lots", "Superficie", "Prix unitaire", "Prix total", "Total versé", "Reste à payer", "Statut", "Date d'adhésion"];
  const lines = subscribers.map((s) => [
    s.code, s.nom, s.prenom, s.ilot || "", s.nombreLots, s.superficie, s.prixUnitaire,
    prixTotal(s), totalVerse(s), Math.max(0, resteAPayer(s)), STATUT_LABEL[statut(s)],
    fmtDate(s.dateAdhesion),
  ]);
  const csv = [header, ...lines].map((r) => r.map(csvCell).join(";")).join("\r\n");
  download("souscripteurs_" + todayISO() + ".csv", "\ufeff" + csv, "text/csv;charset=utf-8");
  journalLog("Export CSV");
  toast("Export CSV téléchargé.", "success");
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportJSON() {
  download("souscripteurs_" + todayISO() + ".json", JSON.stringify(subscribers, null, 2), "application/json");
  journalLog("Export JSON");
  toast("Export JSON téléchargé.", "success");
}

/** Fiche d'impression propre pour un souscripteur. */
function buildPrintHTML(s) {
  const pct = pourcentPaiement(s).toFixed(1);
  const rows = (s.versements || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map((v, i) => `
    <tr><td>${i + 1}</td><td>${fmtDate(v.date)}</td><td>${esc(v.mode)}</td><td style="text-align:right">${fmtFCFA(v.montant)}</td><td>${esc(v.ref || "—")}</td><td>${esc(v.observation || "—")}</td></tr>`
  ).join("");
  const lotRowsHtml = Array.from({ length: Number(s.nombreLots) || 0 }, (_, i) => `
    <tr><td>${esc(getLotNumbers(s)[i])}</td><td>${fmtSuperficie(s.superficie)}</td><td style="text-align:right">${fmtFCFA(s.prixUnitaire)}</td></tr>`).join("");

  return `
    <style>
      *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
      body{margin:0;padding:24px;color:#12324f}
      h1{font-size:22px;margin:0}
      .head{display:flex;justify-content:space-between;border-bottom:3px solid #1f5f93;padding-bottom:12px;margin-bottom:16px}
      .muted{color:#5b6b7c;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
      th{background:#e8f1fa;text-align:left;padding:6px 8px}
      td{padding:6px 8px;border-bottom:1px solid #e3e8ef}
      .sec{margin-top:18px}
      .t{font-size:15px;font-weight:700;margin-bottom:6px;color:#12324f}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .tot{font-size:14px;font-weight:700;margin-top:10px}
    </style>
    <div class="head">
      <div>
        <h1>GestiLot — Fiche Souscripteur</h1>
        <div class="muted">Lotissement &amp; gestion foncière</div>
      </div>
      <div class="muted">Édité le ${new Date().toLocaleString("fr-FR")}</div>
    </div>
    <div class="t">IDENTITÉ</div>
    <div class="grid">
      <div><div class="muted">Nom</div><strong>${esc(s.nom.toUpperCase())}</strong></div>
      <div><div class="muted">Prénom</div><strong>${esc(s.prenom)}</strong></div>
      <div><div class="muted">Code</div><strong>${esc(s.code)}</strong></div>
      <div><div class="muted">Îlot</div><strong>${esc(s.ilot || "—")}</strong></div>
      <div><div class="muted">Date d'adhésion</div><strong>${fmtDate(s.dateAdhesion)}</strong></div>
    </div>

    <div class="t">LOTISSEMENT</div>
    <div class="grid">
      <div><div class="muted">Nombre de lots</div><strong>${s.nombreLots}</strong></div>
      <div><div class="muted">Superficie par lot</div><strong>${fmtSuperficie(s.superficie)}</strong></div>
      <div><div class="muted">Superficie totale</div><strong>${fmtSuperficie((Number(s.nombreLots) || 0) * (Number(s.superficie) || 0))}</strong></div>
      <div><div class="muted">Prix unitaire</div><strong>${fmtFCFA(s.prixUnitaire)}</strong></div>
      <div><div class="muted">Prix total</div><strong>${fmtFCFA(prixTotal(s))}</strong></div>
    </div>

    <div class="sec"><div class="t">DÉTAIL DES LOTS</div>
      <table><thead><tr><th>N° lot</th><th>Superficie</th><th style="text-align:right">Prix unitaire</th></tr></thead><tbody>${lotRowsHtml}</tbody></table>
    </div>

    <div class="sec"><div class="t">PAIEMENTS</div>
      <div class="grid">
        <div><div class="muted">Total versé</div><strong style="color:#16a34a">${fmtFCFA(totalVerse(s))}</strong></div>
        <div><div class="muted">Reste à payer</div><strong>${fmtFCFA(Math.max(0, resteAPayer(s)))}</strong></div>
        <div><div class="muted">Statut</div><strong>${STATUT_LABEL[statut(s)]}</strong></div>
        <div><div class="muted">Paiement effectué</div><strong>${pct} %</strong></div>
      </div>
    </div>

    <div class="sec"><div class="t">HISTORIQUE DES VERSEMENTS</div>
      <table><thead><tr><th>N°</th><th>Date</th><th>Mode</th><th style="text-align:right">Montant</th><th>Réf.</th><th>Observation</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="tot">Total versé : ${fmtFCFA(totalVerse(s))}</div>
  `;
}

function printFiche(s) {
  const area = $("#print-area");
  area.innerHTML = buildPrintHTML(s);
  $("body").classList.add("printing");
  window.print();
}

function printReport() {
  const area = $("#print-area");
  const totalAttendu = subscribers.reduce((x, s) => x + prixTotal(s), 0);
  const totalEncaisse = subscribers.reduce((x, s) => x + totalVerse(s), 0);
  const rows = subscribers.map((s) => `
    <tr><td>${esc(s.code)}</td><td>${esc(s.nom.toUpperCase())} ${esc(s.prenom)}</td><td>${s.nombreLots}</td><td style="text-align:right">${fmtFCFA(prixTotal(s))}</td><td style="text-align:right">${fmtFCFA(totalVerse(s))}</td><td style="text-align:right">${fmtFCFA(Math.max(0, resteAPayer(s)))}</td><td>${STATUT_LABEL[statut(s)]}</td></tr>`).join("");
  area.innerHTML = `
    <style>body{font-family:Arial;padding:20px;color:#12324f}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#e8f1fa;text-align:left;padding:6px}td{padding:6px;border-bottom:1px solid #eee}h1{font-size:20px}.muted{color:#5b6b7c}</style>
    <h1>GestiLot — Rapport des souscripteurs</h1>
    <div class="muted">Édité le ${new Date().toLocaleString("fr-FR")}</div>
    <table><thead><tr><th>Code</th><th>Souscripteur</th><th>Lots</th><th>Prix total</th><th>Versé</th><th>Reste</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table>`;
  $("body").classList.add("printing");
  window.print();
}

function afterPrint() { $("body").classList.remove("printing"); }

/* ----------------------------------------------------------------------------
   10. MODALES / TOAST / CONFIRMATION
   ---------------------------------------------------------------------------- */

function openModal(id) { $("#" + id).classList.remove("hidden"); $("body").classList.add("modal-open"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); if ($$(".modal:not(.hidden)").length === 0) $("body").classList.remove("modal-open"); }

let confirmCallback = null;
function confirmAction(message, cb) {
  $("#confirm-message").textContent = message;
  confirmCallback = cb;
  openModal("modal-confirm");
}

let toastTimer = null;
function toast(msg, type) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (type || "");
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
}

/* ----------------------------------------------------------------------------
   11. AUTH — ÉCRAN & SIDEBAR
   ---------------------------------------------------------------------------- */

function showLogin() { $("#login-screen").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp() { $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden"); }

function updateUserUI() {
  if (currentUser) {
    $("#sidebar-user").textContent = currentUser;
    $("#topbar-user").textContent = currentUser;
    $("#topbar-date").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
}

function openSidebar() { $("#sidebar").classList.add("open"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); }

/* ----------------------------------------------------------------------------
   ÉVÉNEMENTS
   ---------------------------------------------------------------------------- */
function bindEvents() {
  // ----- Connexion -----
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("#login-user").value;
    const p = $("#login-pass").value;
    $("#login-error").textContent = "";
    try {
      const okLogin = await login(u, p);
      if (okLogin) {
        $("#login-form").reset();
        showApp();
        updateUserUI();
        renderDashboard();
        toast("Bienvenue, " + currentUser + " !", "success");
      } else {
        $("#login-error").textContent = isCloudEnabled()
          ? "E-mail ou mot de passe incorrect."
          : "Identifiant ou mot de passe incorrect.";
      }
    } catch (err) {
      $("#login-error").textContent = "Erreur de connexion au service.";
    }
  });
  $("#btn-logout").addEventListener("click", logout);

  // ----- Navigation -----
  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => {
    if (btn.dataset.view === "ajouter") resetForm();
    goTo(btn.dataset.view);
  }));
  $$("[data-go]").forEach((btn) => btn.addEventListener("click", () => {
    const v = btn.dataset.go;
    if (v === "ajouter") resetForm();
    goTo(v);
  }));

  // ----- Menu mobile -----
  $("#btn-menu").addEventListener("click", openSidebar);

  // ----- Recherche globale -----
  const gs = $("#global-search");
  gs.addEventListener("input", () => {
    $("#search-clear").classList.toggle("hidden", !gs.value);
    runGlobalSearch(gs.value);
  });
  gs.addEventListener("focus", () => runGlobalSearch(gs.value));
  $("#search-clear").addEventListener("click", () => {
    gs.value = "";
    $("#search-clear").classList.add("hidden");
    $("#search-results").classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#global-search") && !e.target.closest("#search-results")) {
      $("#search-results").classList.add("hidden");
    }
  });

  // ------ Délégation : résultats de recherche + lignes/actions des tableaux -----
  document.addEventListener("click", (e) => {
    // Ligne cliquable -> détail
    const tr = e.target.closest("tr.clickable");
    const openId = e.target.closest("[data-open-sub]");
    if (openId) {
      $("#search-results").classList.add("hidden");
      openDetail(Number(openId.dataset.openSub));
      return;
    }
    if (tr && !e.target.closest("button")) {
      openDetail(Number(tr.dataset.id));
      return;
    }
    // Bouton d'action dans un <tr>
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      const id = Number(actionBtn.closest("tr").dataset.id);
      const action = actionBtn.dataset.action;
      if (action === "voir") openDetail(id);
      if (action === "modifier") loadFormForEdit(id);
      if (action === "supprimer") confirmDeleteSubscriber(id);
      return;
    }
    // Boutons d'édition / suppression d'un versement dans la fiche
    const editPay = e.target.closest("[data-edit-pay]");
    if (editPay) { openPaymentModal(currentDetailId, Number(editPay.dataset.editPay)); return; }
    const delPay = e.target.closest("[data-del-pay]");
    if (delPay) { confirmDeletePayment(currentDetailId, Number(delPay.dataset.delPay)); return; }
  });

  // ----- Pagination -----
  $("#pagination").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (!b || b.disabled) return;
    listState.page = Number(b.dataset.page);
    renderSouscripteurs();
  });

  // ----- Filtres -----
  $$("#filter-statut .seg-btn").forEach((btn) => btn.addEventListener("click", () => {
    $$("#filter-statut .seg-btn").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");
    listState.filters.statut = btn.dataset.statut;
    listState.page = 1;
    renderSouscripteurs();
  }));
  $("#filter-date-from").addEventListener("change", (e) => { listState.filters.from = e.target.value; listState.page = 1; renderSouscripteurs(); });
  $("#filter-date-to").addEventListener("change", (e) => { listState.filters.to = e.target.value; listState.page = 1; renderSouscripteurs(); });
  $("#sort-select").addEventListener("change", (e) => { listState.sort = e.target.value; listState.page = 1; renderSouscripteurs(); });

  // ----- Formulaire souscripteur -----
  $("#f-lots").addEventListener("input", () => {
    renderLotNumberFields(getFormLotNumbers());
    updatePreview();
  });
  ["#f-prix", "#f-verse-initial"].forEach((s) => $(s).addEventListener("input", updatePreview));
  $("#f-code-auto").addEventListener("click", () => { const c = nextCode(); $("#f-code").value = c; $("#f-code-suggest").textContent = c; });
  $("#subscriber-form").addEventListener("submit", submitSubscriber);
  $("#btn-cancel-form").addEventListener("click", () => { resetForm(); goTo("souscripteurs"); });

  // ----- Fiche détaillée : actions -----
  $("#btn-add-payment").addEventListener("click", () => openPaymentModal(currentDetailId, null));
  $("#btn-edit-subscriber").addEventListener("click", () => loadFormForEdit(currentDetailId));
  $("#btn-delete-subscriber").addEventListener("click", () => confirmDeleteSubscriber(currentDetailId));
  $("#btn-print-fiche").addEventListener("click", () => {
    const s = subscribers.find((x) => x.id === currentDetailId);
    if (s) { printFiche(s); journalLog("Impression de la fiche " + s.code); }
  });
  $("#btn-export-pdf").addEventListener("click", () => {
    const s = subscribers.find((x) => x.id === currentDetailId);
    if (s) { printFiche(s); journalLog("Export PDF de la fiche " + s.code); }
  });

  // ----- Modal versement -----
  $("#p-montant").addEventListener("input", updatePaymentPreview);
  $("#payment-form").addEventListener("submit", submitPayment);

  // ----- Modales / close -----
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); }));
  $("#confirm-ok").addEventListener("click", () => {
    closeModal("modal-confirm");
    if (confirmCallback) { confirmCallback(); confirmCallback = null; }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $$(".modal").forEach((m) => closeModal(m.id)); $("#search-results").classList.add("hidden"); }
  });

  // ----- Rapports -----
  $("#btn-export-csv").addEventListener("click", exportCSV);
  $("#btn-export-json").addEventListener("click", exportJSON);
  $("#btn-export-print").addEventListener("click", printReport);

  // ----- Paramètres -----
  $("#settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = $("#s-user").value.trim();
    const p = $("#s-pass").value;
    if (!u || !p) { $("#settings-msg").textContent = "Identifiant et mot de passe requis."; return; }
    LS.setItem(AUTH_KEY, JSON.stringify({ user: u, pass: p }));
    currentUser = u;
    updateUserUI();
    journalLog("Mise à jour des paramètres du compte");
    $("#settings-msg").textContent = "Compte mis à jour avec succès.";
    toast("Paramètres enregistrés.", "success");
  });
  // ----- Base de données cloud (Supabase) -----
  const dbForm = $("#db-form");
  if (dbForm) {
    dbForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = $("#db-url").value.trim().replace(/\/+$/, "");
      const anon = $("#db-anon").value.trim();
      if (!url || !anon) { $("#db-status").textContent = "Renseignez l'URL du projet et la clé anon."; return; }
      const previousConfig = supabaseConfig;
      const previousMode = LS.getItem(STORAGE_MODE_KEY);
      supabaseConfig = { url: url, anonKey: anon };
      LS.setItem(STORAGE_MODE_KEY, "cloud");
      $("#db-status").textContent = "Connexion en cours…";
      const res = supabaseToken
        ? await testSupabaseConnection()
        : { ok: true, msg: "Configuration enregistrée. Déconnectez-vous puis connectez-vous avec votre e-mail Supabase Auth." };
      $("#db-status").textContent = res.msg;
      if (res.ok) {
        LS.setItem(SUPABASE_CFG_KEY, JSON.stringify({ url: url, anonKey: anon }));
        toast("Base de données connectée.", "success");
        updateLoginHint();
      }
      else {
        supabaseConfig = previousConfig;
        if (previousMode) LS.setItem(STORAGE_MODE_KEY, previousMode);
        else LS.removeItem(STORAGE_MODE_KEY);
        toast("Connexion impossible.", "error");
      }
    });
  }
  const dbLocal = $("#btn-db-local");
  if (dbLocal) dbLocal.addEventListener("click", () => {
    LS.setItem(STORAGE_MODE_KEY, "local");
    SS.removeItem(SUPABASE_TOKEN_KEY);
    supabaseToken = "";
    updateLoginHint();
    renderParametres();
    toast("Mode local activé.", "success");
  });
  const dbPush = $("#btn-db-push");
  if (dbPush) dbPush.addEventListener("click", async () => {
    if (!isCloudEnabled()) { toast("Configurez d'abord la base Supabase.", "error"); $("#db-status").textContent = "Aucune configuration : saisissez l'URL et la clé anon."; return; }
    $("#db-status").textContent = "Publication vers le cloud en cours…";
    await pushAllToCloud();
    renderParametres();
  });
  const dbPull = $("#btn-db-pull");
  if (dbPull) dbPull.addEventListener("click", async () => {
    if (!isCloudEnabled()) { toast("Configurez d'abord la base Supabase.", "error"); return; }
    $("#db-status").textContent = "Chargement depuis le cloud…";
    const ok = await hydrateFromCloud();
    toast(ok ? "Données chargées depuis le cloud." : "Chargement impossible.", ok ? "success" : "error");
    resetForm();
    goTo("souscripteurs");
    renderDashboard();
    renderParametres();
  });
  const dbApi = $("#btn-db-api");
  if (dbApi) dbApi.addEventListener("click", () => {
    toast("Exécutez le fichier supabase-schema.sql dans le SQL Editor de votre projet Supabase.", "success");
  });

  $("#btn-reset-data").addEventListener("click", () => {
    confirmAction("Réinitialiser les données avec le jeu de démonstration ? Vos données actuelles seront remplacées.", async () => {
      subscribers = seedData();
      saveData();
      if (isCloudEnabled()) await persistAllOnCloud();
      journalLog("Réinitialisation des données");
      resetForm();
      goTo("souscripteurs");
      renderDashboard();
      toast("Données de démonstration réinitialisées.", "success");
    });
  });
  $("#btn-clear-data").addEventListener("click", () => {
    confirmAction("Effacer définitivement toutes les données ? Cette action est irréversible.", async () => {
      subscribers = [];
      saveData();
      if (isCloudEnabled()) await clearAllOnCloud();
      journalLog("Suppression de toutes les données");
      resetForm();
      goTo("souscripteurs");
      renderDashboard();
      toast("Toutes les données ont été supprimées.", "success");
    });
  });

  window.addEventListener("afterprint", afterPrint);
}

/* ----------------------------------------------------------------------------
   INITIALISATION
   ---------------------------------------------------------------------------- */
async function init() {
  loadSupabaseConfig();      // lit la configuration cloud éventuelle
  restoreSupabaseToken();    // restaure la session Supabase
  bindEvents();
  setDefaultInputs();
  updateUserUI();
  renderJournal();
  updateLoginHint();
  renderParametres();

  if (isLogged()) {
    showApp();
    // Recharge les données partagées depuis le cloud si actif.
    if (isCloudEnabled()) await hydrateFromCloud();
    renderDashboard();
  } else {
    showLogin();
  }
}

function setDefaultInputs() {
  $("#f-date").value = todayISO();
  $("#f-code").value = nextCode();
  $("#f-code-suggest").textContent = nextCode();
  renderLotNumberFields();
}

/* Démarrage au chargement de la page. */
document.addEventListener("DOMContentLoaded", init);
