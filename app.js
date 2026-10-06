// Suivi des incidents PDV — application web (TEDDYCOM)
//
// Les droits sont garantis par la base (règles par ligne + fonctions saisir_motif /
// saisir_action) : l'interface ne fait que masquer ce que l'utilisateur ne peut pas faire.
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
};

const ROLES = { vm: 'VM', superviseur: 'Superviseur', direction: 'Direction', admin: 'Administrateur' };
const STATUTS = ['À justifier', 'Justifié', 'Action en cours', 'Action terminée', 'Repris'];
const COULEUR = {
  'À justifier': 's-rouge', 'Justifié': 's-bleu', 'Action en cours': 's-orange',
  'Action terminée': 's-vert', 'Repris': 's-gris',
};
const COLONNES = 'id,zone,emoov,date_debut,numero,vm,site,type_incident,ca_habituel,perte_estimee,' +
  'realisation,ecart,date_reprise,detecte_le,date_donnees,motif,detail,motif_saisi_par,' +
  'motif_saisi_le,action,stk_ressource,action_debut,action_fin,action_saisie_par,action_saisie_le,statut';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = (n) => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR') + ' F');
const jj = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const horodatage = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const emailDe = (login) => `${login.trim().toLowerCase()}@${DOMAINE_LOGIN}`;
const $ = (sel) => app.querySelector(sel);

// « yao.plagbe » → « PLAGBE Yao » (même présentation que les comptes)
function nomVm(login) {
  const m = String(login || '').split('.');
  if (m.length < 2) return login || '—';
  return `${m.slice(1).join(' ').toUpperCase()} ${m[0].charAt(0).toUpperCase()}${m[0].slice(1)}`;
}

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

function barre(titre, retour) {
  const p = S.profil;
  return `<header class="barre">
    ${retour ? `<a href="${retour}" aria-label="Retour">←</a>` : ''}
    <h1>${esc(titre)}</h1>
    ${!retour && p.role === 'admin' ? '<a href="#/admin">Comptes</a>' : ''}
    ${!retour ? '<a href="#/compte" aria-label="Mon compte">☰</a>' : ''}
  </header>`;
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
    app.innerHTML = `<main><div class="panneau"><p class="erreur">${esc(messageErreur(e))}</p>
      <button class="bouton" id="reessayer">Réessayer</button></div></main>`;
    $('#reessayer').onclick = chargerProfil;
  }
}

function ecranConnexion(erreur) {
  S.profil = null;
  app.innerHTML = `<main><form class="panneau connexion" id="f" novalidate>
      <h1>Incidents PDV</h1>
      <p class="aide">Connectez-vous avec votre login TEDDYCOM.</p>
      <label for="login">Login</label>
      <input id="login" name="login" autocomplete="username" autocapitalize="none"
             autocorrect="off" spellcheck="false" placeholder="prenom.nom" required>
      <label for="mdp">Mot de passe</label>
      <input id="mdp" name="mdp" type="password" autocomplete="current-password" required>
      <button class="bouton" id="ok">Se connecter</button>
      <p class="erreur" id="err">${esc(erreur || '')}</p>
    </form></main>`;
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
  app.innerHTML = `${obligatoire ? '' : barre('Mot de passe', '#/compte')}
    <main><form class="panneau ${obligatoire ? 'connexion' : ''}" id="f" novalidate>
      <h2>${obligatoire ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}</h2>
      ${obligatoire ? `<p class="aide">Première connexion (ou compte réinitialisé) : remplacez le code
        initial par un mot de passe personnel d'au moins 6 caractères.</p>` : ''}
      ${connaitAncien ? '' : `<label for="ancien">Mot de passe actuel</label>
        <input id="ancien" type="password" autocomplete="current-password">`}
      <label for="nouveau">Nouveau mot de passe</label>
      <input id="nouveau" type="password" autocomplete="new-password" minlength="6">
      <label for="confirm">Confirmez le nouveau mot de passe</label>
      <input id="confirm" type="password" autocomplete="new-password">
      <button class="bouton" id="ok">Enregistrer</button>
      ${obligatoire ? '<button type="button" class="bouton secondaire" id="sortir">Se déconnecter</button>' : ''}
      <p class="erreur" id="err"></p>
    </form></main>`;
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
  ]);
  for (const r of [motifs, actions, etat]) if (r.error) throw r.error;
  S.incidents = incidents;
  S.motifs = motifs.data.map((m) => m.libelle);
  S.actions = actions.data.map((a) => a.libelle);
  S.etat = etat.data;
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
// ---------------------------------------------------------------------------
function router() {
  if (!S.profil || S.profil.doit_changer_mdp) return;
  const h = location.hash;
  const m = h.match(/^#\/incident\/(\d+)$/);
  if (m) return ecranFiche(Number(m[1]));
  if (h === '#/admin' && S.profil.role === 'admin') return ecranAdmin();
  if (h === '#/compte') return ecranCompte();
  if (h === '#/mot-de-passe') return ecranMotDePasse(false);
  ecranListe();
}
window.addEventListener('hashchange', router);

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

function ecranListe() {
  const p = S.profil;
  const f = S.filtres;
  const base = S.incidents.filter((i) => (!f.zone || i.zone === f.zone) && (!f.vm || i.vm === f.vm));
  const nb = (st) => base.filter((i) => st === 'ouverts' ? i.statut !== 'Repris'
    : st === 'tous' || i.statut === st).length;
  const options = [['ouverts', 'Non repris'], ...STATUTS.map((s) => [s, s]), ['tous', 'Tous']]
    .map(([v, t]) => `<option value="${esc(v)}" ${f.statut === v ? 'selected' : ''}>${esc(t)} (${nb(v)})</option>`)
    .join('');
  const zones = [...new Set(S.incidents.map((i) => i.zone))].sort();
  const vms = [...new Set(S.incidents.filter((i) => !f.zone || i.zone === f.zone).map((i) => i.vm))]
    .sort((a, b) => nomVm(a).localeCompare(nomVm(b)));
  const voitZones = ['direction', 'admin'].includes(p.role);
  const voitVms = p.role !== 'vm';

  const liste = incidentsFiltres();
  const perte = liste.reduce((s, i) => s + (i.statut === 'Repris' ? 0 : Number(i.perte_estimee) || 0), 0);
  const dates = S.etat.filter((e) => !p.zone || e.zone === p.zone).map((e) => e.derniere_date).sort();
  const donneesAu = dates.length ? jj(dates[0]) : '—';

  app.innerHTML = `${barre('Incidents PDV')}
    <main>
      <p class="info">${esc(p.nom)} · ${esc(ROLES[p.role])}${p.zone ? ' ' + esc(p.zone.replace('ZONE', 'Zone ')) : ''}
        · données au ${donneesAu}</p>
      <div class="filtres">
        <select id="f-statut" class="${voitZones || voitVms ? '' : 'large'}" aria-label="Statut">${options}</select>
        ${voitZones ? `<select id="f-zone" aria-label="Zone"><option value="">Toutes zones</option>
          ${zones.map((z) => `<option value="${z}" ${f.zone === z ? 'selected' : ''}>${z.replace('ZONE', 'Zone ')}</option>`).join('')}
          </select>` : ''}
        ${voitVms ? `<select id="f-vm" class="${voitZones ? 'large' : ''}" aria-label="VM"><option value="">Tous les VM</option>
          ${vms.map((v) => `<option value="${esc(v)}" ${f.vm === v ? 'selected' : ''}>${esc(nomVm(v))}</option>`).join('')}
          </select>` : ''}
        <input id="f-recherche" class="large" type="search" placeholder="Rechercher : Stk, site, motif…"
               value="${esc(f.recherche)}" aria-label="Rechercher">
      </div>
      <p class="resume">${liste.length} incident${liste.length > 1 ? 's' : ''}
        ${perte ? ` · perte en cours ${fcfa(perte)}` : ''}
        · <a href="#" id="actualiser">Actualiser</a></p>
      <div id="cartes">${liste.slice(0, S.affiches).map(carte).join('')
        || '<p class="centre">Aucun incident pour ces critères.</p>'}</div>
      ${liste.length > S.affiches ? '<button class="bouton secondaire" id="plus">Afficher plus</button>' : ''}
      <p class="aide">Incidents en cours et incidents repris depuis moins de ${JOURS_HISTORIQUE} jours.</p>
    </main>`;

  const changer = (cle) => (ev) => {
    S.filtres[cle] = ev.target.value;
    if (cle === 'zone') S.filtres.vm = '';
    S.affiches = TAILLE_PAGE;
    garderFiltres();
    ecranListe();
  };
  $('#f-statut').onchange = changer('statut');
  if (voitZones) $('#f-zone').onchange = changer('zone');
  if (voitVms) $('#f-vm').onchange = changer('vm');
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
  $('#actualiser').onclick = async (ev) => {
    ev.preventDefault();
    try {
      await chargerDonnees();
      ecranListe();
      toast('Liste à jour.');
    } catch (e) { toast(messageErreur(e)); }
  };
  $('#cartes').onclick = () => { S.defilement = window.scrollY; };
  window.scrollTo(0, S.defilement);
}

function carte(i) {
  const c = COULEUR[i.statut] || 's-gris';
  return `<a class="carte ${c}" href="#/incident/${i.id}">
    <div class="l1"><span class="badge ${c}">${esc(i.statut)}</span>
      <span class="perte">${fcfa(i.perte_estimee)}</span></div>
    <div class="site">${esc(i.site || 'Site non renseigné')}</div>
    <div class="detail">${esc(i.emoov)} · ${esc(i.type_incident)} · depuis le ${jj(i.date_debut)}</div>
    ${S.profil.role !== 'vm' ? `<div class="detail">${esc(nomVm(i.vm))}</div>` : ''}
    ${i.motif ? `<div class="motif">Motif : ${esc(i.motif)}</div>` : ''}
  </a>`;
}

// ---------------------------------------------------------------------------
// Fiche d'un incident
// ---------------------------------------------------------------------------
function ecranFiche(id) {
  const i = S.incidents.find((x) => x.id === id);
  if (!i) { location.hash = ''; return; }
  const c = COULEUR[i.statut] || 's-gris';
  const ecart = i.ecart == null ? '—'
    : `<span class="${i.ecart >= 0 ? 'positif' : 'negatif'}">${i.ecart >= 0 ? '+' : ''}${fcfa(i.ecart)}</span>`;
  // La valeur déjà saisie reste proposée même si elle a été retirée de la liste
  const optionsListe = (liste, valeur) => `<option value="">— Choisir —</option>` +
    [...liste, ...(valeur && !liste.includes(valeur) ? [valeur] : [])]
      .map((x) => `<option value="${esc(x)}" ${x === valeur ? 'selected' : ''}>${esc(x)}</option>`).join('');

  const motif = peutSaisirMotif(i)
    ? `<form id="f-motif" novalidate>
        <label for="motif">Motif</label>
        <select id="motif">${optionsListe(S.motifs, i.motif)}</select>
        <label for="detail">Détail</label>
        <textarea id="detail" maxlength="500" placeholder="Ce qui s'est passé, ce qui est prévu…">${esc(i.detail)}</textarea>
        <button class="bouton" id="ok-motif">Enregistrer le motif</button>
      </form>`
    : `<p class="lecture">${i.motif ? `<b>${esc(i.motif)}</b>${i.detail ? '\n' + esc(i.detail) : ''}`
        : 'Pas encore de motif.'}</p>`;

  const action = peutSaisirAction(i)
    ? `<form id="f-action" novalidate>
        <label for="action">Action corrective</label>
        <select id="action">${optionsListe(S.actions, i.action)}</select>
        <label for="stk">Stk ressource</label>
        <input id="stk" inputmode="numeric" autocomplete="off" value="${esc(i.stk_ressource)}"
               placeholder="Numéro emoov de la ressource">
        <div class="deux">
          <div><label for="debut">Date de début</label><input id="debut" type="date" value="${esc(i.action_debut)}"></div>
          <div><label for="fin">Date de fin</label><input id="fin" type="date" value="${esc(i.action_fin)}"></div>
        </div>
        <p class="aide">Laissez « Action corrective » vide pour effacer l'action.</p>
        <button class="bouton" id="ok-action">Enregistrer l'action</button>
      </form>`
    : (i.action ? `<dl class="chiffres">
        <div><dt>Action</dt><dd>${esc(i.action)}</dd></div>
        <div><dt>Stk ressource</dt><dd>${esc(i.stk_ressource || '—')}</dd></div>
        <div><dt>Début</dt><dd>${jj(i.action_debut)}</dd></div>
        <div><dt>Fin</dt><dd>${jj(i.action_fin)}</dd></div></dl>`
      : '<p class="lecture">Pas d\'action corrective pour le moment.</p>');

  app.innerHTML = `${barre(`Incident n° ${i.numero ?? ''}`, '#/')}
    <main>
      <section class="panneau">
        <div class="entete-fiche"><h2>${esc(i.site || 'Site non renseigné')}</h2>
          <span class="badge ${c}">${esc(i.statut)}</span></div>
        <p class="info">${esc(i.emoov)} · ${esc(nomVm(i.vm))} · ${esc(i.zone.replace('ZONE', 'Zone '))}</p>
        <dl class="chiffres">
          <div><dt>Incident</dt><dd>${esc(i.type_incident)}</dd></div>
          <div><dt>Début</dt><dd>${jj(i.date_debut)}</dd></div>
          <div><dt>CA habituel du jour</dt><dd>${fcfa(i.ca_habituel)}</dd></div>
          <div><dt>Perte estimée</dt><dd>${fcfa(i.perte_estimee)}</dd></div>
          <div><dt>Détecté le</dt><dd>${jj(i.detecte_le)}</dd></div>
          <div><dt>Fin de l'incident</dt><dd>${jj(i.date_reprise)}</dd></div>
          <div><dt>Réalisation de l'action</dt><dd>${fcfa(i.realisation)}</dd></div>
          <div><dt>Écart</dt><dd>${ecart}</dd></div>
        </dl>
        <p class="trace">Chiffres calculés chaque matin (ventes au ${jj(i.date_donnees)}).</p>
      </section>
      <section class="panneau">
        <h2>Justification</h2>
        ${motif}
        ${i.motif_saisi_par ? `<p class="trace">Saisi par ${esc(i.motif_saisi_par)} le ${horodatage(i.motif_saisi_le)}</p>` : ''}
      </section>
      <section class="panneau">
        <h2>Action corrective</h2>
        ${action}
        ${i.action_saisie_par ? `<p class="trace">Saisie par ${esc(i.action_saisie_par)} le ${horodatage(i.action_saisie_le)}</p>` : ''}
      </section>
    </main>`;
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
      p_id: id, p_motif: $('#motif').value, p_detail: $('#detail').value,
    }), 'Motif enregistré.');
  }
  if ($('#f-action')) {
    $('#f-action').onsubmit = enregistrer('#ok-action', () => {
      const debut = $('#debut').value || null;
      const fin = $('#fin').value || null;
      if ($('#action').value && !debut) return { error: new Error("Indiquez la date de début de l'action.") };
      if (debut && fin && fin < debut) return { error: new Error('La date de fin est avant la date de début.') };
      return sb.rpc('saisir_action', {
        p_id: id, p_action: $('#action').value, p_stk: $('#stk').value, p_debut: debut, p_fin: fin,
      });
    }, 'Action enregistrée.');
  }
}

// ---------------------------------------------------------------------------
// Mon compte
// ---------------------------------------------------------------------------
function ecranCompte() {
  const p = S.profil;
  app.innerHTML = `${barre('Mon compte', '#/')}
    <main><section class="panneau">
      <h2>${esc(p.nom)}</h2>
      <p class="info">${esc(p.login)} · ${esc(ROLES[p.role])}${p.zone ? ' · ' + esc(p.zone.replace('ZONE', 'Zone ')) : ''}</p>
      <a class="bouton secondaire" href="#/mot-de-passe" style="text-align:center;text-decoration:none">Changer mon mot de passe</a>
      <button class="bouton danger" id="sortir">Se déconnecter</button>
    </section></main>`;
  $('#sortir').onclick = deconnecter;
}

// ---------------------------------------------------------------------------
// Administration des comptes
// ---------------------------------------------------------------------------
async function ecranAdmin() {
  app.innerHTML = `${barre('Comptes', '#/')}<main><p class="centre">Chargement…</p></main>`;
  let comptes;
  try {
    const { data, error } = await sb.from('profils').select('*').order('role').order('zone').order('login');
    if (error) throw error;
    comptes = data;
  } catch (e) {
    $('main').innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`;
    return;
  }
  const ordre = { admin: 0, direction: 1, superviseur: 2, vm: 3 };
  comptes.sort((a, b) => ordre[a.role] - ordre[b.role] || (a.zone || '').localeCompare(b.zone || '')
    || a.login.localeCompare(b.login));
  const ligne = (c) => `<div class="compte">
      <div class="qui"><div><b>${esc(c.nom)}</b></div>
        <div class="aide">${esc(c.login)} · ${esc(ROLES[c.role])}${c.zone ? ' ' + esc(c.zone.replace('ZONE', 'Z')) : ''}
          · ${!c.actif ? 'désactivé' : c.doit_changer_mdp ? 'code initial' : 'mot de passe personnel'}</div></div>
      ${c.id !== S.profil.id && c.actif
        ? `<button class="bouton danger" data-login="${esc(c.login)}">Réinitialiser</button>` : ''}
    </div>`;
  $('main').innerHTML = `<section class="panneau">
      <p class="aide">« Réinitialiser » remet le mot de passe à ${MDP_INITIAL} et oblige à le changer
        à la prochaine connexion. Pour votre propre compte, passez par l'autre compte administrateur.</p>
      <input id="cherche" type="search" placeholder="Rechercher un compte…" aria-label="Rechercher un compte">
      <div id="comptes">${comptes.map(ligne).join('')}</div>
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
