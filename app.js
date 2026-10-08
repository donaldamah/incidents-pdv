// Suivi des incidents PDV — application web (TEDDYCOM)
//
// Les droits sont garantis par la base (règles par ligne + fonctions saisir_motif /
// saisir_action / saisir_commentaire) : l'interface ne fait que masquer ce que
// l'utilisateur ne peut pas faire.
'use strict';

const DOMAINE_LOGIN = 'pdv.teddycom.invalid';   // même valeur que supabase_api.py
const MDP_INITIAL = '123456';
const JOURS_HISTORIQUE = 30;                     // incidents repris : visibles 30 jours
const TAILLE_PAGE = 100;                         // cartes affichées à la fois

const sb = window.supabase.createClient(window.APP_CONFIG.url, window.APP_CONFIG.cle_publique);
const app = document.getElementById('app');

const S = {
  profil: null,
  incidents: [],
  motifs: [],
  actions: [],
  etat: [],
  filtres: null,
  affiches: TAILLE_PAGE,
  defilement: 0,
  mdpConnexion: null,   // mot de passe tapé à la connexion, pour le changement obligatoire
  // Tableau de bord
  tb: null,             // { ligne, vms, zones, j } ou { erreur }
  causes: [],
  commentaires: {},     // login VM → { cause, texte, saisi_le } pour le jour J
  editionCom: false,
  tri: 'ca',
  zoneFiltre: '',
  ouvert: null,         // VM dont le commentaire est déplié dans le classement
  defilerVers: null,
};

const ROLES = { vm: 'VM', superviseur: 'Superviseur', direction: 'Direction', admin: 'Administrateur' };
const STATUTS = ['À justifier', 'Justifié', 'Action en cours', 'Action terminée', 'Repris'];
const COULEUR = {
  'À justifier': 'st-ajust', 'Justifié': 'st-just', 'Action en cours': 'st-encours',
  'Action terminée': 'st-term', 'Repris': 'st-repris',
};
const COLONNES = 'id,zone,emoov,date_debut,numero,vm,site,type_incident,ca_habituel,perte_estimee,' +
  'realisation,ecart,date_reprise,detecte_le,date_donnees,motif,detail,motif_saisi_par,' +
  'motif_saisi_le,action,stk_ressource,action_debut,action_fin,action_saisie_par,action_saisie_le,statut';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nb = (n) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR'));
const fcfa = (n) => (n == null ? '—' : nb(n) + ' F');
const jj = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const jm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const horodatage = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const emailDe = (login) => `${login.trim().toLowerCase()}@${DOMAINE_LOGIN}`;
const $ = (sel) => app.querySelector(sel);
const zoneLib = (z) => String(z || '').replace('ZONE', 'Zone ');

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONGS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre',
  'Octobre', 'Novembre', 'Décembre'];
const date = (iso) => new Date(iso + 'T12:00:00');
// « mer. 30/09 », avec l'année si elle diffère de celle de J
const court = (iso, j) => (iso ? `${JOURS[date(iso).getDay()]} ${jm(iso)}${j && iso.slice(0, 4) !== j.slice(0, 4) ? '/' + iso.slice(2, 4) : ''}` : 'sans donnée');
// période [début, fin] → « 1→7 sept. » (+ année si différente de J)
const periode = (b, j) => (b ? `${+b[0].slice(8)}→${+b[1].slice(8)} ${MOIS[+b[1].slice(5, 7) - 1]}${j && b[1].slice(0, 4) !== j.slice(0, 4) ? ' ' + b[1].slice(2, 4) : ''}` : 'sans donnée');

// Variation de a par rapport à b : texte, classe de couleur, valeur
function variation(a, b) {
  if (a == null || !b) return { t: '—', c: 'stable', v: null };
  const v = (a / b - 1) * 100;
  const t = (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + ' %';
  return { t, c: v > 0.05 ? 'hausse' : v < -0.05 ? 'baisse' : 'stable', v };
}
const varHtml = (a, b, cls = 'var') => { const x = variation(a, b); return `<span class="${cls} ${x.c}">${x.t}</span>`; };

const ICONES = {
  incidents: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  tableau: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  compte: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  gauche: '<path d="m15 18-6-6 6-6"/>',
  droite: '<path d="m9 18 6-6-6-6"/>',
  bulle: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};
const ico = (n, petit) => `<svg class="ico${petit ? ' p' : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[n]}</svg>`;
const LOS = '<i class="losange" aria-hidden="true"></i>';

function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('visible');
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => t.classList.remove('visible'), 3000);
}

function messageErreur(e) {
  const m = String(e?.message || e || '');
  if (/fetch|network|réseau|Load failed/i.test(m)) return 'Pas de connexion : vérifiez le réseau et réessayez.';
  return m || 'Erreur inattendue, réessayez.';
}

// Lecture complète d'une requête, par pages de 1000 lignes (limite de Supabase)
async function toutLire(requete) {
  const lignes = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await requete().range(debut, debut + 999);
    if (error) throw error;
    lignes.push(...data);
    if (data.length < 1000) return lignes;
  }
}

// Appel de la fonction serveur « comptes » (mot de passe, réinitialisation)
async function appelComptes(corps) {
  const { data, error } = await sb.functions.invoke('comptes', { body: corps });
  if (error) {
    let message = messageErreur(error);
    try {
      const j = await error.context.json();
      message = j.erreur || j.message || message;
    } catch { /* réponse sans JSON : on garde le message générique */ }
    throw new Error(message);
  }
  return data;
}

// Puces à choix unique : <div data-groupe="motif"> ; valeur lue au moment d'enregistrer
function puces(groupe, liste, valeur, libelle) {
  const toutes = [...liste, ...(valeur && !liste.includes(valeur) ? [valeur] : [])];
  return `<div class="puces" role="group" aria-label="${esc(libelle)}" data-groupe="${groupe}">${toutes.map((x) =>
    `<button type="button" class="puce" data-valeur="${esc(x)}" aria-pressed="${x === valeur}">${esc(x)}</button>`).join('')}</div>`;
}
const valeurPuces = (groupe) => $(`[data-groupe="${groupe}"] [aria-pressed="true"]`)?.dataset.valeur || '';
app.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-groupe] .puce');
  if (!b) return;
  const choisi = b.getAttribute('aria-pressed') !== 'true';
  b.parentElement.querySelectorAll('.puce').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', String(choisi));
});

// ---------------------------------------------------------------------------
// Bandeau, onglets
// ---------------------------------------------------------------------------
const estDirection = () => ['direction', 'admin'].includes(S.profil.role);
const commentaireManquant = () => S.profil.role === 'vm' && S.tb?.ligne && !S.commentaires[S.profil.login];

function teteLigne() {
  const p = S.profil;
  return `<div class="tete-ligne"><div class="marque">${LOS}Incidents PDV</div>
    <div class="qui"><b>${esc(p.nom)}</b>${esc(ROLES[p.role])}${p.zone ? ' · ' + esc(zoneLib(p.zone)) : ''}</div></div>`;
}
function teteRetour(lien, texte, droite = '') {
  return `<div class="tete-ligne"><a class="retour" href="${lien}">${ico('gauche')}${esc(texte)}</a>
    <div class="qui">${droite}</div></div>`;
}

function nav(actif) {
  const ordre = estDirection() ? ['tableau', 'incidents', 'compte'] : ['incidents', 'tableau', 'compte'];
  const lib = { tableau: 'Tableau de bord', incidents: 'Incidents', compte: 'Compte' };
  const aJustifier = S.profil.role === 'vm' ? S.incidents.filter((i) => i.statut === 'À justifier').length : 0;
  const marque = {
    incidents: aJustifier ? `<span class="pastille">${aJustifier}</span>` : '',
    tableau: commentaireManquant() ? '<span class="pastille point" aria-label="commentaire à saisir"></span>' : '',
    compte: '',
  };
  return `<nav class="app-nav">${ordre.map((k) => `<a class="nav-btn" href="#/${k}" ${k === actif ? 'aria-current="page"' : ''}>
    ${ico(k)}${lib[k]}${marque[k]}</a>`).join('')}</nav>`;
}

// ---------------------------------------------------------------------------
// Démarrage et connexion
// ---------------------------------------------------------------------------
async function demarrer() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return ecranConnexion();
  await chargerProfil();
}

async function chargerProfil() {
  app.innerHTML = '<p class="centre">Chargement…</p>';
  try {
    const { data: { user }, error: e1 } = await sb.auth.getUser();
    if (e1 || !user) {
      if (e1 && /fetch|network/i.test(e1.message)) throw e1;
      await sb.auth.signOut();
      return ecranConnexion();
    }
    const { data, error } = await sb.from('profils').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!data || !data.actif) {
      await sb.auth.signOut();
      return ecranConnexion('Compte inconnu ou désactivé.');
    }
    S.profil = data;
    S.filtres = lireFiltres();
    if (data.doit_changer_mdp) return ecranMotDePasse(true);
    await chargerDonnees();
    router();
  } catch (e) {
    app.innerHTML = `<main class="app-corps"><div class="bloc"><p class="erreur">${esc(messageErreur(e))}</p>
      <button class="btn btn-bleu" id="reessayer">Réessayer</button></div></main>`;
    $('#reessayer').onclick = chargerProfil;
  }
}

function ecranConnexion(erreur) {
  S.profil = null;
  app.innerHTML = `<div class="connexion">
      <div class="marque">${LOS}Incidents PDV</div>
      <p class="accroche">TEDDYCOM · Zones 1 et 2</p>
      <form id="f" novalidate>
        <label class="champ" for="login">Login</label>
        <input id="login" name="login" autocomplete="username" autocapitalize="none"
               autocorrect="off" spellcheck="false" placeholder="prenom.nom" required>
        <label class="champ" for="mdp">Mot de passe</label>
        <input id="mdp" name="mdp" type="password" autocomplete="current-password" required>
        <div class="pile"><button class="btn btn-bleu" id="ok">Se connecter</button></div>
        <p class="erreur" id="err">${esc(erreur || '')}</p>
      </form>
      <p class="pied">Mot de passe oublié : demandez à l'administrateur de réinitialiser votre compte.</p>
    </div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const login = $('#login').value.trim().toLowerCase();
    const mdp = $('#mdp').value;
    if (!login || !mdp) { $('#err').textContent = 'Saisissez votre login et votre mot de passe.'; return; }
    $('#ok').disabled = true;
    $('#err').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: emailDe(login), password: mdp });
    $('#ok').disabled = false;
    if (error) {
      $('#err').textContent = /invalid/i.test(error.message)
        ? 'Login ou mot de passe incorrect.' : messageErreur(error);
      return;
    }
    S.mdpConnexion = mdp;
    location.hash = '';
    await chargerProfil();
  };
  $('#login').focus();
}

// Changement de mot de passe : obligatoire à la première connexion, ou volontaire
function ecranMotDePasse(obligatoire) {
  const connaitAncien = obligatoire && S.mdpConnexion;
  const formulaire = `<form id="f" novalidate>
      <h2>${obligatoire ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}</h2>
      ${obligatoire ? `<p class="aide">Première connexion (ou compte réinitialisé) : remplacez le code
        initial par un mot de passe personnel d'au moins 6 caractères.</p>` : ''}
      ${connaitAncien ? '' : `<label class="champ" for="ancien">Mot de passe actuel</label>
        <input id="ancien" type="password" autocomplete="current-password">`}
      <label class="champ" for="nouveau">Nouveau mot de passe</label>
      <input id="nouveau" type="password" autocomplete="new-password" minlength="6">
      <label class="champ" for="confirm">Confirmez le nouveau mot de passe</label>
      <input id="confirm" type="password" autocomplete="new-password">
      <div class="pile">
        <button class="btn btn-bleu" id="ok">Enregistrer</button>
        ${obligatoire ? '<button type="button" class="btn btn-sec" id="sortir">Se déconnecter</button>' : ''}
      </div>
      <p class="erreur" id="err"></p>
    </form>`;
  app.innerHTML = obligatoire
    ? `<div class="connexion"><div class="marque">${LOS}Incidents PDV</div>
        <p class="accroche">${esc(S.profil.nom)}</p>${formulaire}</div>`
    : `<header class="app-tete">${teteRetour('#/compte', 'Compte')}</header>
       <main class="app-corps"><section class="bloc">${formulaire}</section></main>${nav('compte')}`;
  if (obligatoire) $('#sortir').onclick = deconnecter;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const ancien = connaitAncien ? S.mdpConnexion : $('#ancien').value;
    const nouveau = $('#nouveau').value;
    const err = $('#err');
    if (nouveau.length < 6) { err.textContent = 'Au moins 6 caractères.'; return; }
    if (nouveau === MDP_INITIAL) { err.textContent = 'Choisissez un mot de passe différent du code initial.'; return; }
    if (nouveau !== $('#confirm').value) { err.textContent = 'Les deux saisies ne correspondent pas.'; return; }
    $('#ok').disabled = true;
    err.textContent = '';
    try {
      await appelComptes({ action: 'changer_mdp', ancien, nouveau });
      // Le changement ferme la session : on se reconnecte avec le nouveau mot de passe
      const { error } = await sb.auth.signInWithPassword({ email: emailDe(S.profil.login), password: nouveau });
      if (error) throw error;
      S.mdpConnexion = null;
      toast('Mot de passe enregistré.');
      location.hash = '';
      await chargerProfil();
    } catch (e) {
      err.textContent = messageErreur(e);
      $('#ok').disabled = false;
    }
  };
}

async function deconnecter() {
  S.profil = null;                 // avant signOut : pas de message « session terminée »
  await sb.auth.signOut();
  S.incidents = [];
  S.tb = null;
  S.commentaires = {};
  S.mdpConnexion = null;
  location.hash = '';
  ecranConnexion();
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------
async function chargerDonnees() {
  const depuis = new Date(Date.now() - JOURS_HISTORIQUE * 864e5).toISOString().slice(0, 10);
  const [incidents, motifs, actions, etat] = await Promise.all([
    toutLire(() => sb.from('incidents_vue').select(COLONNES)
      .or(`date_reprise.is.null,detecte_le.gte.${depuis}`)
      .order('detecte_le', { ascending: false }).order('perte_estimee', { ascending: false })
      .order('id')),
    sb.from('motifs').select('libelle').eq('actif', true).order('ordre'),
    sb.from('actions_correctives').select('libelle').eq('actif', true).order('ordre'),
    sb.from('etat_zones').select('*'),
    chargerTableau(),
  ]);
  for (const r of [motifs, actions, etat]) if (r.error) throw r.error;
  S.incidents = incidents;
  S.motifs = motifs.data.map((m) => m.libelle);
  S.actions = actions.data.map((a) => a.libelle);
  S.etat = etat.data;
}

// Tableau de bord : la ligne complète du périmètre de l'utilisateur, plus une version
// allégée des VM (et des zones pour la direction) pour le classement. Une panne ici
// ne bloque pas les incidents.
async function chargerTableau() {
  const role = S.profil.role;
  const complet = role === 'vm' ? 'vm' : role === 'superviseur' ? 'zone' : 'total';
  const leger = role === 'vm' ? null : role === 'superviseur' ? ['vm'] : ['vm', 'zone'];
  try {
    const [l, v, c] = await Promise.all([
      sb.from('tableau_bord_dernier').select('perimetre,cle,zone,nom,date_donnees,donnees').eq('perimetre', complet),
      leger ? sb.from('tableau_bord_dernier')
        .select('perimetre,cle,zone,nom,mois:donnees->mois->ca,jour:donnees->jour->ca').in('perimetre', leger)
        : { data: [] },
      sb.from('causes').select('libelle').eq('actif', true).order('ordre'),
    ]);
    for (const r of [l, v, c]) if (r.error) throw r.error;
    const ligne = l.data[0] || null;
    S.causes = c.data.map((x) => x.libelle);
    S.tb = { ligne, j: ligne?.date_donnees, vms: v.data.filter((x) => x.perimetre === 'vm'),
      zones: v.data.filter((x) => x.perimetre === 'zone') };
    S.commentaires = {};
    if (ligne) {
      const { data, error } = await sb.from('commentaires').select('vm,cause,texte,saisi_le').eq('date_donnees', ligne.date_donnees);
      if (error) throw error;
      for (const x of data) S.commentaires[x.vm] = x;
    }
  } catch (e) {
    S.tb = { erreur: messageErreur(e) };
  }
}

async function rechargerIncident(id) {
  const { data, error } = await sb.from('incidents_vue').select(COLONNES).eq('id', id).maybeSingle();
  if (error) throw error;
  const i = S.incidents.findIndex((x) => x.id === id);
  if (data && i >= 0) S.incidents[i] = data;
  return data;
}

// Filtres propres à chaque utilisateur, gardés sur son téléphone
function lireFiltres() {
  const defaut = { statut: 'ouverts', zone: '', vm: '', recherche: '' };
  try {
    return { ...defaut, ...JSON.parse(localStorage.getItem(`filtres:${S.profil.login}`) || '{}') };
  } catch { return defaut; }
}
function garderFiltres() {
  try { localStorage.setItem(`filtres:${S.profil.login}`, JSON.stringify(S.filtres)); } catch { /* sans effet */ }
}

const peutSaisirMotif = (inc) => (S.profil.role === 'vm' && S.profil.login === inc.vm)
  || (S.profil.role === 'superviseur' && S.profil.zone === inc.zone);
const peutSaisirAction = (inc) => S.profil.role === 'superviseur' && S.profil.zone === inc.zone;

// ---------------------------------------------------------------------------
// Navigation (le bouton « retour » du téléphone fonctionne)
// Accueil : tableau de bord pour la direction et les administrateurs, incidents sinon.
// ---------------------------------------------------------------------------
function router() {
  if (!S.profil || S.profil.doit_changer_mdp) return;
  const h = location.hash;
  const m = h.match(/^#\/incident\/(\d+)$/);
  if (m) return ecranFiche(Number(m[1]));
  if (h === '#/admin' && S.profil.role === 'admin') return ecranAdmin();
  if (h === '#/compte') return ecranCompte();
  if (h === '#/mot-de-passe') return ecranMotDePasse(false);
  if (h === '#/tableau') return ecranTableau();
  if (h === '#/incidents') return ecranListe();
  return estDirection() ? ecranTableau() : ecranListe();
}
window.addEventListener('hashchange', router);

async function actualiser() {
  try {
    await chargerDonnees();
    router();
    toast('Données à jour.');
  } catch (e) { toast(messageErreur(e)); }
}

// ---------------------------------------------------------------------------
// Liste des incidents
// ---------------------------------------------------------------------------
function incidentsFiltres() {
  const f = S.filtres;
  const q = f.recherche.trim().toLowerCase();
  return S.incidents.filter((i) =>
    (f.statut === 'tous' || (f.statut === 'ouverts' ? i.statut !== 'Repris' : i.statut === f.statut))
    && (!f.zone || i.zone === f.zone)
    && (!f.vm || i.vm === f.vm)
    && (!q || i.emoov.includes(q) || (i.site || '').toLowerCase().includes(q)
        || i.vm.includes(q) || (i.motif || '').toLowerCase().includes(q)));
}

const nomVm = (login) => S.tb?.vms?.find((v) => v.cle === login)?.nom || nomDeLogin(login);
// « yao.plagbe » → « PLAGBE Yao » (même présentation que les comptes)
function nomDeLogin(login) {
  const m = String(login || '').split('.');
  if (m.length < 2) return login || '—';
  return `${m.slice(1).join(' ').toUpperCase()} ${m[0].charAt(0).toUpperCase()}${m[0].slice(1)}`;
}

function ecranListe() {
  const p = S.profil;
  const f = S.filtres;
  const base = S.incidents.filter((i) => (!f.zone || i.zone === f.zone) && (!f.vm || i.vm === f.vm));
  const compte = (st) => base.filter((i) => st === 'ouverts' ? i.statut !== 'Repris'
    : st === 'tous' || i.statut === st).length;
  const choix = [['ouverts', 'Non repris'], ...STATUTS.map((s) => [s, s]), ['tous', 'Tous']];
  const zones = [...new Set(S.incidents.map((i) => i.zone))].sort();
  const vms = [...new Set(S.incidents.filter((i) => !f.zone || i.zone === f.zone).map((i) => i.vm))]
    .sort((a, b) => nomVm(a).localeCompare(nomVm(b)));
  const voitZones = estDirection();
  const voitVms = p.role !== 'vm';

  const ouverts = base.filter((i) => i.statut !== 'Repris');
  const perte = ouverts.reduce((s, i) => s + (Number(i.perte_estimee) || 0), 0);
  const liste = incidentsFiltres();
  const dates = S.etat.filter((e) => !p.zone || e.zone === p.zone).map((e) => e.derniere_date).sort();

  app.innerHTML = `<header class="app-tete">${teteLigne()}
      <div class="resume-inc">
        <div><b>${ouverts.length}</b><span>incident${ouverts.length > 1 ? 's' : ''} ouvert${ouverts.length > 1 ? 's' : ''}</span></div>
        <div><b>${fcfa(perte)}</b><span>de perte estimée</span></div>
      </div>
      ${commentaireManquant() ? `<a class="alerte" href="#/tableau" data-vers="bloc-com">${ico('bulle', 1)}<span>Commentaire du jour à saisir</span>${ico('droite', 1)}</a>` : ''}
    </header>
    <main class="app-corps">
      <div class="puces defile" role="group" aria-label="Statut" id="f-statut">${choix.map(([v, t]) =>
        `<button type="button" class="puce" data-statut="${esc(v)}" aria-pressed="${f.statut === v}">${esc(t)}<span class="n">${compte(v)}</span></button>`).join('')}</div>
      ${voitZones || voitVms ? `<div class="filtres">
        ${voitZones ? `<select id="f-zone" aria-label="Zone"><option value="">Toutes zones</option>
          ${zones.map((z) => `<option value="${z}" ${f.zone === z ? 'selected' : ''}>${zoneLib(z)}</option>`).join('')}
          </select>` : ''}
        ${voitVms ? `<select id="f-vm" class="${voitZones ? '' : 'large'}" aria-label="VM"><option value="">Tous les VM</option>
          ${vms.map((v) => `<option value="${esc(v)}" ${f.vm === v ? 'selected' : ''}>${esc(nomVm(v))}</option>`).join('')}
          </select>` : ''}
      </div>` : ''}
      <input id="f-recherche" type="search" placeholder="Rechercher : Stk, site, motif…"
             value="${esc(f.recherche)}" aria-label="Rechercher">
      <p class="resume"><span>${liste.length} incident${liste.length > 1 ? 's' : ''} · ventes au ${dates.length ? jj(dates[0]) : '—'}</span>
        <button type="button" class="lien" id="actualiser">Actualiser</button></p>
      <div class="inc-liste" id="cartes">${liste.slice(0, S.affiches).map(carte).join('')
        || '<p class="centre">Aucun incident pour ces critères.</p>'}</div>
      ${liste.length > S.affiches ? '<button class="btn btn-sec" id="plus">Afficher plus</button>' : ''}
      <p class="aide">Incidents en cours et incidents repris depuis moins de ${JOURS_HISTORIQUE} jours.</p>
    </main>
    ${nav('incidents')}`;

  const changer = (cle, valeur) => {
    S.filtres[cle] = valeur;
    if (cle === 'zone') S.filtres.vm = '';
    S.affiches = TAILLE_PAGE;
    garderFiltres();
    ecranListe();
  };
  $('#f-statut').onclick = (ev) => {
    const b = ev.target.closest('[data-statut]');
    if (b) changer('statut', b.dataset.statut);
  };
  if (voitZones) $('#f-zone').onchange = (ev) => changer('zone', ev.target.value);
  if (voitVms) $('#f-vm').onchange = (ev) => changer('vm', ev.target.value);
  let minuteur;
  $('#f-recherche').oninput = (ev) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      S.filtres.recherche = ev.target.value;
      garderFiltres();
      const champ = ev.target.selectionStart;
      ecranListe();
      const r = $('#f-recherche');
      r.focus();
      r.setSelectionRange(champ, champ);
    }, 300);
  };
  if ($('#plus')) $('#plus').onclick = () => { S.affiches += TAILLE_PAGE; ecranListe(); };
  $('#actualiser').onclick = actualiser;
  $('#cartes').onclick = () => { S.defilement = window.scrollY; };
  const alerte = $('.alerte');
  if (alerte) alerte.onclick = () => { S.defilerVers = alerte.dataset.vers; };
  window.scrollTo(0, S.defilement);
}

function carte(i) {
  const repris = i.statut === 'Repris';
  return `<a class="inc${repris ? ' repris' : ''}" href="#/incident/${i.id}">
    <span class="st ${COULEUR[i.statut] || 'st-repris'}">${LOS}${esc(i.statut)}</span>
    <span class="inc-site">${esc(i.site || 'Site non renseigné')}</span>
    <span class="inc-det">${esc(i.emoov)} · ${esc(i.type_incident)} · ${repris && i.date_reprise
      ? `repris le ${jm(i.date_reprise)}` : `depuis le ${jm(i.date_debut)}`}</span>
    ${S.profil.role !== 'vm' || i.motif ? `<span class="inc-det">${S.profil.role !== 'vm' ? esc(nomVm(i.vm)) : ''}${
      S.profil.role !== 'vm' && i.motif ? ' · ' : ''}${i.motif ? 'Motif : ' + esc(i.motif) : ''}</span>` : ''}
    <span class="inc-perte">${fcfa(i.perte_estimee)}<small>perte estimée</small></span>
  </a>`;
}

// ---------------------------------------------------------------------------
// Fiche d'un incident
// ---------------------------------------------------------------------------
function ecranFiche(id) {
  const i = S.incidents.find((x) => x.id === id);
  if (!i) { location.hash = '#/incidents'; return; }
  const ecart = i.ecart == null ? '—'
    : `<span class="${i.ecart >= 0 ? 'hausse' : 'baisse'}">${i.ecart >= 0 ? '+' : ''}${fcfa(i.ecart)}</span>`;

  const motif = peutSaisirMotif(i)
    ? `<form id="f-motif" novalidate>
        ${puces('motif', S.motifs, i.motif, 'Motif')}
        <label class="champ" for="detail">Détail</label>
        <textarea id="detail" maxlength="500" placeholder="Ce que vous avez constaté sur place.">${esc(i.detail)}</textarea>
        <div class="pile"><button class="btn btn-action" id="ok-motif">Enregistrer le motif</button></div>
        <p class="aide">Touchez à nouveau le motif choisi pour l'effacer.</p>
      </form>`
    : `<p class="lecture">${i.motif ? `<b>${esc(i.motif)}</b>${i.detail ? '\n' + esc(i.detail) : ''}`
        : 'Pas encore de motif.'}</p>`;

  const action = peutSaisirAction(i)
    ? `<form id="f-action" novalidate>
        ${puces('action', S.actions, i.action, 'Action corrective')}
        <label class="champ" for="stk">Stk ressource</label>
        <input id="stk" inputmode="numeric" autocomplete="off" value="${esc(i.stk_ressource)}"
               placeholder="Numéro emoov de la ressource">
        <div class="deux">
          <div><label class="champ" for="debut">Date de début</label><input id="debut" type="date" value="${esc(i.action_debut)}"></div>
          <div><label class="champ" for="fin">Date de fin</label><input id="fin" type="date" value="${esc(i.action_fin)}"></div>
        </div>
        <div class="pile"><button class="btn btn-action" id="ok-action">Enregistrer l'action</button></div>
        <p class="aide">Aucune action choisie : l'action est effacée.</p>
      </form>`
    : (i.action ? `<dl class="chiffres">
        <div><dt>Action</dt><dd class="txt">${esc(i.action)}</dd></div>
        <div><dt>Stk ressource</dt><dd>${esc(i.stk_ressource || '—')}</dd></div>
        <div><dt>Début</dt><dd>${jj(i.action_debut)}</dd></div>
        <div><dt>Fin</dt><dd>${jj(i.action_fin)}</dd></div></dl>`
      : `<p class="lecture" style="color:var(--gris)">Pas encore d'action.${S.profil.role === 'vm' ? ' Elle est saisie par votre superviseur.' : ''}</p>`);

  app.innerHTML = `<header class="app-tete">
      ${teteRetour('#/incidents', 'Incidents', `<b>N° ${esc(i.numero ?? '')}</b>${esc(zoneLib(i.zone))}`)}
      <div class="fiche-site">${esc(i.site || 'Site non renseigné')}</div>
      <div class="fiche-info">${esc(i.emoov)} · ${esc(i.type_incident)}${S.profil.role !== 'vm' ? ' · ' + esc(nomVm(i.vm)) : ''}</div>
      <span class="st fiche-st ${COULEUR[i.statut] || 'st-repris'}">${LOS}${esc(i.statut)}</span>
    </header>
    <main class="app-corps">
      <section class="bloc">
        <h2 class="bloc-titre">${LOS}Chiffres</h2>
        <dl class="chiffres">
          <div><dt>Début de l'incident</dt><dd>${court(i.date_debut)}</dd></div>
          <div><dt>Fin de l'incident</dt><dd class="txt">${i.date_reprise ? court(i.date_reprise) : 'En cours'}</dd></div>
          <div><dt>CA habituel du jour</dt><dd>${fcfa(i.ca_habituel)}</dd></div>
          <div><dt>Perte estimée</dt><dd class="baisse">${fcfa(i.perte_estimee)}</dd></div>
          <div><dt>Détecté le</dt><dd>${court(i.detecte_le)}</dd></div>
          ${i.action ? `<div><dt>Réalisation de l'action</dt><dd>${fcfa(i.realisation)}</dd></div>
          <div><dt>Écart</dt><dd>${ecart}</dd></div>` : ''}
        </dl>
        <p class="trace">Calculés chaque matin, ventes au ${jj(i.date_donnees)}.</p>
      </section>
      <section class="bloc">
        <h2 class="bloc-titre">${LOS}Motif</h2>
        ${motif}
        ${i.motif_saisi_par ? `<p class="trace">Saisi par ${esc(i.motif_saisi_par)} le ${horodatage(i.motif_saisi_le)}</p>` : ''}
      </section>
      <section class="bloc">
        <h2 class="bloc-titre">${LOS}Action corrective</h2>
        ${action}
        ${i.action_saisie_par ? `<p class="trace">Saisie par ${esc(i.action_saisie_par)} le ${horodatage(i.action_saisie_le)}</p>` : ''}
      </section>
    </main>
    ${nav('incidents')}`;
  window.scrollTo(0, 0);

  const enregistrer = (bouton, appel, message) => async (ev) => {
    ev.preventDefault();
    const b = $(bouton);
    b.disabled = true;
    try {
      const { error } = await appel();
      if (error) throw error;
      await rechargerIncident(id);
      toast(message);
      ecranFiche(id);
    } catch (e) {
      toast(messageErreur(e));
      b.disabled = false;
    }
  };
  if ($('#f-motif')) {
    $('#f-motif').onsubmit = enregistrer('#ok-motif', () => sb.rpc('saisir_motif', {
      p_id: id, p_motif: valeurPuces('motif'), p_detail: $('#detail').value,
    }), 'Motif enregistré.');
  }
  if ($('#f-action')) {
    $('#f-action').onsubmit = enregistrer('#ok-action', () => {
      const act = valeurPuces('action');
      const debut = $('#debut').value || null;
      const fin = $('#fin').value || null;
      if (act && !debut) return { error: new Error("Indiquez la date de début de l'action.") };
      if (debut && fin && fin < debut) return { error: new Error('La date de fin est avant la date de début.') };
      return sb.rpc('saisir_action', {
        p_id: id, p_action: act, p_stk: $('#stk').value, p_debut: debut, p_fin: fin,
      });
    }, 'Action enregistrée.');
  }
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------
function comp(libelle, sous, a, b) {
  const x = variation(a, b);
  return `<div class="comp"><span class="comp-l">${libelle}</span><span class="comp-d">${esc(sous)}</span>
    <span class="comp-v ${x.c}">${x.t}</span></div>`;
}

function tableKpi(colonnes, lignes) {
  return `<div style="--n:${colonnes.length}"><div class="kpi-tete"><span></span>${colonnes.map(([l, s]) =>
    `<span>${l}<small>${esc(s)}</small></span>`).join('')}</div>
    ${lignes.map(([nom, val, vars]) => `<div class="kpi"><span class="kpi-nom">${nom}<span class="kpi-val">${val}</span></span>${vars.join('')}</div>`).join('')}</div>`;
}

// Blocs communs : détail du jour J, mois en cours (avec barres), top des forfaits
function blocsIndicateurs(d, sansCaJour) {
  const J = d.jour.dates.j;
  const dj = d.jour.dates, pm = d.mois.periodes;
  const ligneJour = (nom, x) => [nom, nb(x.j), ['s1', 'm1', 'y1'].map((k) => varHtml(x.j, x[k]))];
  const ligneMois = (nom, x, unite = '') => [nom, x.m == null ? '—' : nb(x.m) + unite, ['m1', 'y1'].map((k) => varHtml(x.m, x[k]))];

  const serie = d.serie.m, prec = d.serie.m1;
  const max = Math.max(1, ...serie.filter((v) => v != null), ...prec.filter((v) => v != null));
  const n = serie.length;
  const libelleJour = (k) => n <= 10 || k === 0 || k === n - 1 || (k + 1) % 5 === 0;
  const moisJ = +J.slice(5, 7) - 1, moisP = moisJ === 0 ? 11 : moisJ - 1;
  const barres = `<div class="barres" style="--n:${n};--ecart:${n > 15 ? 2 : 6}px" role="img"
      aria-label="CA par jour, ${MOIS_LONGS[moisJ].toLowerCase()} comparé à ${MOIS_LONGS[moisP].toLowerCase()}">
      ${serie.map((v, k) => `<div class="col"><i class="b b-m${k === n - 1 ? ' j' : ''}" style="height:${((v || 0) / max * 100).toFixed(1)}%"></i>${
        prec[k] != null ? `<i class="b b-p" style="height:${(prec[k] / max * 100).toFixed(1)}%"></i>` : ''}</div>`).join('')}
    </div>
    <div class="barres-l" style="--n:${n};--ecart:${n > 15 ? 2 : 6}px">${serie.map((v, k) => {
      const iso = `${J.slice(0, 8)}${String(k + 1).padStart(2, '0')}`;
      return `<span>${libelleJour(k) ? `<b>${k + 1}</b>${n <= 10 ? JOURS[date(iso).getDay()] : ''}` : ''}</span>`;
    }).join('')}</div>
    <div class="legende"><span><i style="background:var(--moov)"></i>${MOIS_LONGS[moisJ]}</span>
      <span><i style="background:#B8CBDF"></i>${MOIS_LONGS[moisP]}, même quantième</span></div>`;

  const f = d.forfaits;
  return `<section class="bloc">
      <h2 class="bloc-titre">${LOS}Le ${jm(J)} en détail</h2>
      ${tableKpi([['S-1', jm(dj.s1)], ['M-1', jm(dj.m1)], ['Y-1', dj.y1 ? jm(dj.y1) + '/' + dj.y1.slice(2, 4) : '—']], [
        ...(sansCaJour ? [] : [ligneJour('CA sell out', d.jour.ca)]), ligneJour('PDV actifs', d.jour.pdv), ligneJour('Abonnés actifs', d.jour.abonnes)])}
    </section>
    <section class="bloc">
      <h2 class="bloc-titre">${LOS}${MOIS_LONGS[moisJ]}, du 1er au ${+J.slice(8)}</h2>
      ${tableKpi([['vs M-1', periode(pm.m1, J)], ['vs Y-1', periode(pm.y1, J)]], [
        ligneMois('CA sell out', d.mois.ca, ' F'), ligneMois('PDV actifs', d.mois.pdv), ligneMois('Abonnés actifs', d.mois.abonnes)])}
      ${barres}
    </section>
    ${f.length ? `<section class="bloc">
      <h2 class="bloc-titre">${LOS}Top ${f.length} des forfaits</h2>
      <p class="bloc-sous">${MOIS_LONGS[moisJ]}, classés par CA.</p>
      ${f.map((x, k) => `<div class="forf"><span class="forf-r">${k + 1}</span><span class="forf-n">${esc(x.nom)}</span>
        <span class="forf-ca">${fcfa(x.ca)}</span><span class="forf-s">${nb(x.ventes)} ventes</span>
        <span class="jauge"><i style="width:${(x.ca / (f[0].ca || 1) * 100).toFixed(0)}%"></i></span></div>`).join('')}
    </section>` : ''}`;
}

function heroMois(libelle, d) {
  const J = d.jour.dates.j;
  return `<div class="hero">
      <div class="hero-label">${esc(libelle)} · CA sell out du 1er au ${+J.slice(8)} ${MOIS[+J.slice(5, 7) - 1]}</div>
      <div class="hero-val">${nb(d.mois.ca.m)}<small>FCFA</small></div>
      <div class="comps">
        ${comp('vs M-1', periode(d.mois.periodes.m1, J), d.mois.ca.m, d.mois.ca.m1)}
        ${comp('vs Y-1', periode(d.mois.periodes.y1, J), d.mois.ca.m, d.mois.ca.y1)}
        ${comp('J vs S-1', court(J), d.jour.ca.j, d.jour.ca.s1)}
      </div>
    </div>`;
}

function classement(liste, avecZone) {
  const vm = (x) => variation(x.mois?.m, x.mois?.m1).v ?? 0;
  const tri = {
    ca: (a, b) => (b.mois?.m || 0) - (a.mois?.m || 0),
    evo: (a, b) => vm(a) - vm(b),
    manq: (a, b) => (!!S.commentaires[a.cle] - !!S.commentaires[b.cle]) || (b.mois?.m || 0) - (a.mois?.m || 0),
  }[S.tri];
  const l = [...liste].sort(tri);
  return `<div class="puces defile" role="group" aria-label="Tri" style="margin-bottom:6px">
      ${[['ca', 'CA du mois'], ['evo', 'Plus forte baisse'], ['manq', 'Sans commentaire']].map(([k, t]) =>
        `<button type="button" class="puce" data-tri="${k}" aria-pressed="${S.tri === k}">${t}</button>`).join('')}
    </div>
    ${l.map((v, k) => {
      const c = S.commentaires[v.cle];
      const ouvert = S.ouvert === v.cle;
      const j = variation(v.jour?.j, v.jour?.s1);
      const m = variation(v.mois?.m, v.mois?.m1);
      return `<button type="button" class="clas" data-ouvrir="${esc(v.cle)}" aria-expanded="${ouvert}">
        <span class="clas-r">${k + 1}</span>
        <span class="clas-n">${esc(v.nom)}<small>${avecZone ? esc(zoneLib(v.zone)) + ' · ' : ''}J vs S-1 : <span class="${j.c}">${j.t}</span></small></span>
        <span class="clas-ca">${nb(v.mois?.m)}<small class="${m.c}">${m.t} vs M-1</small></span>
        <span class="clas-com ${ouvert ? '' : 'ferme'}">${c ? `<b>${esc(c.cause)}</b> · ${esc(c.texte)}`
          : `<span class="manquant">${LOS}Commentaire manquant</span>`}</span>
      </button>`;
    }).join('')}`;
}

function blocCommentaire(d) {
  const J = d.jour.dates.j;
  const c = S.commentaires[S.profil.login];
  if (c && !S.editionCom) {
    return `<section class="bloc" id="bloc-com">
        <h2 class="bloc-titre">${LOS}Mon commentaire du ${jm(J)}</h2>
        <p class="lecture"><b style="color:var(--moov)">${esc(c.cause)}</b>\n${esc(c.texte)}</p>
        <p class="trace">Enregistré le ${horodatage(c.saisi_le)}. Vous pouvez le modifier.</p>
        <div class="pile"><button class="btn btn-sec" type="button" id="com-modif">Modifier</button></div>
      </section>`;
  }
  const x = variation(d.jour.ca.j, d.jour.ca.s1);
  const consigne = x.v == null ? `Expliquez l'évolution de vos ventes du ${jm(J)}.`
    : `Expliquez votre ${x.v < 0 ? 'baisse' : 'hausse'} de ${x.t.replace(/^[+−]/, '')} par rapport au ${JOURS_LONGS[date(d.jour.dates.s1).getDay()]} ${jm(d.jour.dates.s1)}.`;
  return `<section class="bloc" id="bloc-com">
      <h2 class="bloc-titre">${LOS}Mon commentaire du ${jm(J)}</h2>
      <p class="bloc-sous">${esc(consigne)}</p>
      <form id="f-com" novalidate>
        ${puces('cause', S.causes, c?.cause, 'Cause')}
        <label class="champ" for="com-texte">Précisez</label>
        <textarea id="com-texte" maxlength="300" placeholder="Ex. : trois PDV sans float depuis lundi.">${esc(c?.texte)}</textarea>
        <p class="erreur" id="com-err"></p>
        <button class="btn btn-action" id="com-ok">Enregistrer le commentaire</button>
        ${c ? '<div class="pile"><button class="btn btn-sec" type="button" id="com-annuler">Annuler</button></div>' : ''}
      </form>
    </section>`;
}

function ecranTableau() {
  const p = S.profil;
  const tb = S.tb;
  if (!tb?.ligne) {
    const message = tb?.erreur ? `Tableau de bord indisponible : ${tb.erreur}`
      : 'Pas encore de données : le tableau de bord est mis à jour chaque matin.';
    app.innerHTML = `<header class="app-tete">${teteLigne()}</header>
      <main class="app-corps"><section class="bloc"><p class="lecture">${esc(message)}</p>
        <div class="pile"><button class="btn btn-sec" id="actualiser">Actualiser</button></div></section></main>
      ${nav('tableau')}`;
    $('#actualiser').onclick = actualiser;
    return;
  }
  const d = tb.ligne.donnees;
  const J = d.jour.dates.j;
  let tete, corps;

  if (p.role === 'vm') {
    const ouverts = S.incidents.filter((i) => i.statut !== 'Repris');
    const aJustifier = ouverts.filter((i) => i.statut === 'À justifier').length;
    const perte = ouverts.reduce((s, i) => s + (Number(i.perte_estimee) || 0), 0);
    tete = `<div class="hero">
        <div class="hero-label">CA sell out · ${JOURS_LONGS[date(J).getDay()]} ${jm(J)}</div>
        <div class="hero-val">${nb(d.jour.ca.j)}<small>FCFA</small></div>
        <div class="comps">
          ${comp('vs S-1', court(d.jour.dates.s1, J), d.jour.ca.j, d.jour.ca.s1)}
          ${comp('vs M-1', court(d.jour.dates.m1, J), d.jour.ca.j, d.jour.ca.m1)}
          ${comp('vs Y-1', court(d.jour.dates.y1, J), d.jour.ca.j, d.jour.ca.y1)}
        </div>
        ${commentaireManquant() && !S.editionCom ? `<button class="alerte" type="button" data-defile="bloc-com">${ico('bulle', 1)}<span>Commentaire du jour à saisir</span>${ico('droite', 1)}</button>` : ''}
      </div>`;
    const blocs = blocsIndicateurs(d, true);
    const i = blocs.indexOf('</section>') + '</section>'.length;   // commentaire après le détail du jour
    corps = blocs.slice(0, i) + blocCommentaire(d) + blocs.slice(i) + `
      <section class="bloc rappel">
        <h2 class="bloc-titre">${LOS}Mes incidents ouverts</h2>
        <div class="gros"><div><b>${ouverts.length}</b><span>${aJustifier} à justifier</span></div>
          <div><b>${fcfa(perte)}</b><span>de perte estimée</span></div></div>
        <a class="btn btn-action" href="#/incidents">${aJustifier ? 'Justifier mes incidents' : 'Voir mes incidents'} ${ico('droite', 1)}</a>
      </section>`;
  } else if (p.role === 'superviseur') {
    const manq = tb.vms.filter((v) => !S.commentaires[v.cle]).length;
    tete = heroMois(zoneLib(p.zone), d);
    corps = `<section class="bloc">
        <h2 class="bloc-titre">${LOS}Mes VM</h2>
        <p class="bloc-sous">CA du mois et commentaire du ${jm(J)}.${manq ? ` <span class="manquant">${manq} commentaire${manq > 1 ? 's' : ''} manquant${manq > 1 ? 's' : ''} sur ${tb.vms.length}</span>` : ''}</p>
        ${classement(tb.vms, false)}
      </section>${blocsIndicateurs(d)}`;
  } else {
    const vms = tb.vms.filter((v) => !S.zoneFiltre || v.zone === S.zoneFiltre);
    const zones = [...tb.zones].sort((a, b) => a.cle.localeCompare(b.cle));
    tete = heroMois('Zones 1 et 2', d);
    corps = `<section class="bloc">
        <h2 class="bloc-titre">${LOS}Par zone</h2>
        ${zones.map((z) => {
          const lz = tb.vms.filter((v) => v.zone === z.cle);
          const manq = lz.filter((v) => !S.commentaires[v.cle]).length;
          return `<div class="zone-l"><span class="nm">${esc(z.nom)}<small>${lz.length} VM${manq ? ` · <span class="manquant" style="font-size:12.5px">${manq} sans commentaire</span>` : ''}</small></span>
            <span class="clas-ca">${nb(z.mois?.m)}</span>
            <span class="var">${varHtml(z.mois?.m, z.mois?.m1, '')}<br>${varHtml(z.mois?.m, z.mois?.y1, '')}</span></div>`;
        }).join('')}
        <p class="trace">Variations : vs M-1, puis vs Y-1.</p>
      </section>
      <section class="bloc">
        <h2 class="bloc-titre">${LOS}Classement des VM</h2>
        <div class="puces defile" role="group" aria-label="Zone" style="margin-bottom:8px">${[['', 'Toutes'], ['ZONE1', 'Zone 1'], ['ZONE2', 'Zone 2']].map(([k, t]) =>
          `<button type="button" class="puce" data-zone="${k}" aria-pressed="${S.zoneFiltre === k}">${t}</button>`).join('')}</div>
        ${classement(vms, !S.zoneFiltre)}
      </section>${blocsIndicateurs(d)}`;
  }

  app.innerHTML = `<header class="app-tete">${teteLigne()}${tete}</header>
    <main class="app-corps">${corps}
      <p class="resume"><span>Ventes au ${jj(J)} · calculées chaque matin</span>
        <button type="button" class="lien" id="actualiser">Actualiser</button></p>
    </main>
    ${nav('tableau')}`;

  $('#actualiser').onclick = actualiser;
  app.querySelectorAll('[data-defile]').forEach((b) => {
    b.onclick = () => document.getElementById(b.dataset.defile)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const main = $('main');
  main.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tri], [data-zone], [data-ouvrir]');
    if (!b) return;
    if (b.dataset.tri) S.tri = b.dataset.tri;
    else if (b.dataset.ouvrir) S.ouvert = S.ouvert === b.dataset.ouvrir ? null : b.dataset.ouvrir;
    else S.zoneFiltre = b.dataset.zone;
    const y = window.scrollY;
    ecranTableau();
    window.scrollTo(0, y);
  });
  if ($('#com-modif')) $('#com-modif').onclick = () => { S.editionCom = true; ecranTableau(); S.defilerVers = 'bloc-com'; defiler(); };
  if ($('#com-annuler')) $('#com-annuler').onclick = () => { S.editionCom = false; ecranTableau(); };
  if ($('#f-com')) {
    $('#f-com').onsubmit = async (ev) => {
      ev.preventDefault();
      const cause = valeurPuces('cause');
      const texte = $('#com-texte').value.trim();
      const err = $('#com-err');
      if (!cause) { err.textContent = 'Choisissez une cause.'; return; }
      if (texte.length < 5) { err.textContent = 'Ajoutez une précision de quelques mots.'; return; }
      $('#com-ok').disabled = true;
      err.textContent = '';
      const { error } = await sb.rpc('saisir_commentaire', { p_date: J, p_cause: cause, p_texte: texte });
      if (error) {
        err.textContent = messageErreur(error);
        $('#com-ok').disabled = false;
        return;
      }
      S.commentaires[p.login] = { vm: p.login, cause, texte, saisi_le: new Date().toISOString() };
      S.editionCom = false;
      toast('Commentaire enregistré.');
      ecranTableau();
      S.defilerVers = 'bloc-com';
      defiler();
    };
  }
  if (S.defilerVers) defiler();
  else window.scrollTo(0, 0);
}

function defiler() {
  const el = document.getElementById(S.defilerVers);
  S.defilerVers = null;
  if (el) el.scrollIntoView({ block: 'start' });
}

// ---------------------------------------------------------------------------
// Mon compte
// ---------------------------------------------------------------------------
function ecranCompte() {
  const p = S.profil;
  app.innerHTML = `<header class="app-tete">${teteLigne()}</header>
    <main class="app-corps"><section class="bloc">
      <h2 class="bloc-titre">${LOS}${esc(p.nom)}</h2>
      <p class="bloc-sous">${esc(p.login)} · ${esc(ROLES[p.role])}${p.zone ? ' · ' + esc(zoneLib(p.zone)) : ''}</p>
      <div class="pile">
        ${p.role === 'admin' ? '<a class="btn btn-bleu" href="#/admin">Gérer les comptes</a>' : ''}
        <a class="btn btn-sec" href="#/mot-de-passe">Changer mon mot de passe</a>
        <button class="btn btn-danger" id="sortir">Se déconnecter</button>
      </div>
    </section></main>
    ${nav('compte')}`;
  $('#sortir').onclick = deconnecter;
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Administration des comptes
// ---------------------------------------------------------------------------
async function ecranAdmin() {
  app.innerHTML = `<header class="app-tete">${teteRetour('#/compte', 'Compte', '<b>Comptes</b>')}</header>
    <main class="app-corps"><p class="centre">Chargement…</p></main>${nav('compte')}`;
  let comptes;
  try {
    const { data, error } = await sb.from('profils').select('*').order('role').order('zone').order('login');
    if (error) throw error;
    comptes = data;
  } catch (e) {
    $('main').innerHTML = `<section class="bloc"><p class="erreur">${esc(messageErreur(e))}</p></section>`;
    return;
  }
  const ordre = { admin: 0, direction: 1, superviseur: 2, vm: 3 };
  comptes.sort((a, b) => ordre[a.role] - ordre[b.role] || (a.zone || '').localeCompare(b.zone || '')
    || a.login.localeCompare(b.login));
  const ligne = (c) => `<div class="compte">
      <div class="qui-c"><div><b>${esc(c.nom)}</b></div>
        <div class="aide" style="margin:0">${esc(c.login)} · ${esc(ROLES[c.role])}${c.zone ? ' ' + esc(c.zone.replace('ZONE', 'Z')) : ''}
          · ${!c.actif ? 'désactivé' : c.doit_changer_mdp ? 'code initial' : 'mot de passe personnel'}</div></div>
      ${c.id !== S.profil.id && c.actif
        ? `<button class="btn btn-danger" data-login="${esc(c.login)}">Réinitialiser</button>` : ''}
    </div>`;
  $('main').innerHTML = `<section class="bloc">
      <h2 class="bloc-titre">${LOS}Comptes</h2>
      <p class="bloc-sous">« Réinitialiser » remet le mot de passe à ${MDP_INITIAL} et oblige à le changer
        à la prochaine connexion. Pour votre propre compte, passez par l'autre compte administrateur.</p>
      <input id="cherche" type="search" placeholder="Rechercher un compte…" aria-label="Rechercher un compte">
      <div id="comptes" style="margin-top:8px">${comptes.map(ligne).join('')}</div>
    </section>`;
  $('#cherche').oninput = (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    $('#comptes').innerHTML = comptes
      .filter((c) => !q || c.login.includes(q) || c.nom.toLowerCase().includes(q)).map(ligne).join('');
  };
  $('#comptes').onclick = async (ev) => {
    const b = ev.target.closest('button[data-login]');
    if (!b) return;
    const login = b.dataset.login;
    if (!confirm(`Réinitialiser le compte ${login} ?\nSon mot de passe redeviendra ${MDP_INITIAL}.`)) return;
    b.disabled = true;
    try {
      const r = await appelComptes({ action: 'reinitialiser', login });
      toast(r.message || 'Compte réinitialisé.');
      ecranAdmin();
    } catch (e) {
      toast(messageErreur(e));
      b.disabled = false;
    }
  };
}

// Session expirée ou fermée ailleurs : retour à l'écran de connexion
sb.auth.onAuthStateChange((evenement) => {
  if (evenement === 'SIGNED_OUT' && S.profil) ecranConnexion('Session terminée : reconnectez-vous.');
});

demarrer();
