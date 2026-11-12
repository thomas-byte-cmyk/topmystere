/* ==========================================================================
   TopMystère — logique du jeu (JavaScript Vanilla, aucun framework)

   Règles actuelles :
     - pas de vies : on peut se tromper autant qu'on veut, les erreurs sont comptées ;
     - le Joker (indice) est gratuit mais apparaît dans le score partagé ;
     - on peut abandonner pour voir le classement complet.

   Organisation du fichier :
     1. Configuration
     2. Utilitaires (dates, normalisation du texte, distance de Levenshtein)
     3. Sauvegarde locale (localStorage)
     4. Chargement des énigmes (puzzles.json)
     5. Logique de jeu (proposer, joker, abandon, victoire)
     6. Affichage (plateau, compteurs, modales, effets)
     7. Partage du score
     8. Démarrage
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------------------
   1. CONFIGURATION — les seuls réglages à modifier en temps normal
   --------------------------------------------------------------------------- */
const CONFIG = {
  GAME_NAME: 'TopMystère',
  // Date (heure locale) du puzzle n°1. Ensuite, un nouveau puzzle chaque jour.
  LAUNCH_DATE: '2026-11-12',
  PUZZLES_URL: 'puzzles.json',
  STORAGE_KEY: 'topmystere:v1',
  // Lien ajouté au message de partage. Laisser vide = adresse actuelle de la page.
  SHARE_URL: '',
  // Nombre d'ampoules en haut du plateau
  BULBS: 16,
};

const EMOJI = { correct: '🟩', wrong: '🟥', hint: '💡' };
const PRAISE = ['Bien vu !', 'Excellent !', 'Yes !', 'Bonne pioche !', 'Incroyable !', 'Exact !'];
const CONFETTI_COLORS = ['#ffd54a', '#ff3b4e', '#5f84f0', '#ffffff', '#f0a030', '#8fe3ff'];

/* ---------------------------------------------------------------------------
   2. UTILITAIRES
   --------------------------------------------------------------------------- */

/** Raccourci pour document.getElementById */
const $ = (id) => document.getElementById(id);

/** Accord simple : plural(2, 'erreur') -> "erreurs" */
const plural = (n, word) => (n > 1 ? `${word}s` : word);

/** Numéro du jour (0, 1, 2…) depuis LAUNCH_DATE, selon l'heure locale du joueur. */
function getDayIndex(date = new Date()) {
  const [y, m, d] = CONFIG.LAUNCH_DATE.split('-').map(Number);
  const launch = Date.UTC(y, m - 1, d);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((today - launch) / 86400000);
}

/**
 * Normalise un texte pour comparer une proposition avec une réponse :
 * minuscules, sans accents, sans ponctuation, sans article de début (le, la, the…),
 * et sans espaces. Ex : "  L'Ère d'ULTRON " -> "eredultron", "GTA V" -> "gtav".
 */
function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // supprime les accents
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ') // toute ponctuation devient un espace
    .trim()
    .replace(/^(the|le|la|les|l|un|une)\s+/, '') // article en début de texte
    .replace(/\s+/g, ''); // on compare sans espaces : "spider man" = "spiderman"
}

/** Distance de Levenshtein : nombre minimal de lettres à changer pour passer de a à b. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Nombre de fautes de frappe tolérées selon la longueur de la réponse. */
function typoTolerance(length) {
  if (length < 5) return 0;
  if (length < 10) return 1;
  return 2;
}

/** Extrait les chiffres d'un texte ("Iron Man 3" -> "3") pour ne pas confondre les suites. */
const digitsOf = (s) => s.replace(/\D/g, '');

/**
 * Cherche à quelle ligne du classement correspond une proposition.
 * 1) correspondance exacte avec la réponse ou un alias
 * 2) sinon, tolérance aux fautes de frappe… seulement si UNE SEULE réponse est proche
 *    et que les chiffres sont identiques (pour ne pas accepter "Iron Man 2" pour "Iron Man 3").
 * Retourne l'élément trouvé, ou null.
 */
function findMatch(puzzle, guess) {
  const g = normalize(guess);
  if (!g) return null;

  const forms = puzzle.items.map((item) => ({
    item,
    variants: [item.answer, ...(item.aliases || [])].map(normalize).filter(Boolean),
  }));

  const exact = forms.find((f) => f.variants.includes(g));
  if (exact) return exact.item;

  if (g.length < 4) return null;
  const close = forms.filter((f) =>
    f.variants.some((v) => digitsOf(v) === digitsOf(g) && levenshtein(g, v) <= typoTolerance(v.length))
  );
  return close.length === 1 ? close[0].item : null;
}

/** "Tetris (EA)" -> "T _ _ _ _ _ ( _ _ )" : 1re lettre visible, les autres masquées. */
function maskAnswer(answer) {
  const a = String(answer).trim();
  return a.charAt(0).toUpperCase() + a.slice(1).replace(/[\p{L}\p{N}]/gu, '_');
}

/** Temps restant avant minuit (heure locale), au format "5 h 12 min". */
function timeUntilTomorrow() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.ceil((tomorrow - now) / 60000);
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

/** Échappe le HTML pour afficher du texte sans risque. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------------------
   3. SAUVEGARDE LOCALE (localStorage)
   Tout est rangé sous une seule clé :
   {
     seenHelp: bool,
     progress: { "daily:3": {...partie}, "archive:cinema-boxoffice-top10": {...} },
     stats: { played, wins, currentStreak, maxStreak, lastWinDay, history: [...] }
   }
   --------------------------------------------------------------------------- */
function defaultStore() {
  return {
    seenHelp: false,
    progress: {},
    stats: { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, lastWinDay: null, history: [] },
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return defaultStore();
    const data = JSON.parse(raw);
    const base = defaultStore();
    return { ...base, ...data, stats: { ...base.stats, ...(data.stats || {}) }, progress: data.progress || {} };
  } catch (err) {
    console.warn('Sauvegarde illisible, on repart de zéro.', err);
    return defaultStore();
  }
}

function saveStore() {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.store));
  } catch (err) {
    console.warn('Impossible de sauvegarder (navigation privée ?)', err);
  }
}

/** Supprime les parties quotidiennes de plus de 60 jours pour garder un stockage léger. */
function pruneOldProgress() {
  for (const key of Object.keys(state.store.progress)) {
    const m = key.match(/^daily:(-?\d+)$/);
    if (m && Number(m[1]) < state.dayIndex - 60) delete state.store.progress[key];
  }
}

/** Série en cours "réelle" : elle retombe à 0 si le joueur a raté un jour. */
function effectiveStreak() {
  const { currentStreak, lastWinDay } = state.store.stats;
  if (lastWinDay === null) return 0;
  return lastWinDay >= state.dayIndex - 1 ? currentStreak : 0;
}

/* ---------------------------------------------------------------------------
   ÉTAT GLOBAL DE L'APPLICATION
   --------------------------------------------------------------------------- */
const state = {
  puzzles: [],
  dayIndex: 0,
  mode: 'daily', // 'daily' ou 'archive'
  puzzle: null, // énigme en cours
  key: '', // clé de sauvegarde de la partie en cours
  game: null, // progression de la partie en cours
  store: null,
};

/** Nouvelle partie vierge pour une énigme. */
function newGame(puzzle) {
  return {
    puzzleId: puzzle.id,
    status: 'playing', // 'playing' | 'won' | 'lost' (= abandon)
    found: [], // rangs trouvés
    hinted: [], // rangs pour lesquels un Joker a été utilisé
    log: [], // historique : { t: 'correct' | 'wrong' | 'hint', v: texte, rank }
    counted: false, // déjà pris en compte dans les stats ?
  };
}

/** Nombre d'erreurs de la partie en cours. */
const errorCount = (game = state.game) => game.log.filter((e) => e.t === 'wrong').length;

/* ---------------------------------------------------------------------------
   4. CHARGEMENT DES ÉNIGMES
   --------------------------------------------------------------------------- */
async function loadPuzzles() {
  const res = await fetch(CONFIG.PUZZLES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const puzzles = (data.puzzles || []).map((p) => ({
    ...p,
    items: [...p.items].sort((a, b) => a.rank - b.rank),
  }));
  if (!puzzles.length) throw new Error('Aucune énigme dans puzzles.json');
  return puzzles;
}

/** Énigme du jour : on fait tourner la liste en boucle. */
function dailyPuzzle() {
  const n = state.puzzles.length;
  return state.puzzles[((state.dayIndex % n) + n) % n];
}

/** Ouvre une énigme (du jour ou d'archive) et restaure la progression éventuelle. */
function openPuzzle(puzzle, mode) {
  state.mode = mode;
  state.puzzle = puzzle;
  state.key = mode === 'daily' ? `daily:${state.dayIndex}` : `archive:${puzzle.id}`;

  const saved = state.store.progress[state.key];
  state.game = saved && saved.puzzleId === puzzle.id ? saved : newGame(puzzle);
  state.store.progress[state.key] = state.game;
  saveStore();

  resetGiveUpButton();
  renderAll();
}

/* ---------------------------------------------------------------------------
   5. LOGIQUE DE JEU
   --------------------------------------------------------------------------- */
function submitGuess(rawValue) {
  const { game, puzzle } = state;
  if (game.status !== 'playing') return;

  const value = rawValue.trim();
  if (!normalize(value)) {
    shakeInput();
    return;
  }

  const item = findMatch(puzzle, value);

  // ✅ Bonne réponse
  if (item) {
    if (game.found.includes(item.rank)) {
      toast(`Déjà trouvé : « ${item.answer} »`);
      clearInput();
      return;
    }
    game.found.push(item.rank);
    game.log.push({ t: 'correct', v: value, rank: item.rank });
    revealRow(item.rank, { animate: true });
    toast(`${PRAISE[Math.floor(Math.random() * PRAISE.length)]} N°${item.rank}`);
    clearInput();
    renderStatus();
    updateControls();
    if (game.found.length === puzzle.items.length) endGame('won');
    else saveStore();
    return;
  }

  // ❌ Mauvaise réponse (on ne compte pas deux fois la même)
  const norm = normalize(value);
  if (game.log.some((e) => e.t === 'wrong' && normalize(e.v) === norm)) {
    toast('Tu as déjà proposé ça !');
    shakeInput();
    return;
  }
  game.log.push({ t: 'wrong', v: value });
  saveStore();
  shakeInput();
  flashWrong();
  clearInput();
  renderWrongList();
  renderStatus({ bump: true });
  toast('Pas dans le classement !');
}

/** Joker : révèle la 1re lettre + un indice de la meilleure place encore cachée. */
function useHint() {
  const { game, puzzle } = state;
  if (game.status !== 'playing') return;

  const target = puzzle.items.find((it) => !game.found.includes(it.rank) && !game.hinted.includes(it.rank));
  if (!target) {
    toast('Tous les jokers sont déjà utilisés !');
    return;
  }

  game.hinted.push(target.rank);
  game.log.push({ t: 'hint', rank: target.rank });
  saveStore();

  renderHint(target.rank);
  updateControls();
  toast(`Joker pour le n°${target.rank} !`);
  // Fait défiler jusqu'à la ligne concernée (utile pour les Top 10 sur mobile)
  document.querySelector(`.row[data-rank="${target.rank}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Abandon : demande une confirmation (2e appui), puis dévoile tout. */
let giveUpTimer = null;
function giveUp() {
  const btn = $('btn-giveup');
  if (state.game.status !== 'playing') return;

  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = 'Sûr ? Appuie encore';
    clearTimeout(giveUpTimer);
    giveUpTimer = setTimeout(resetGiveUpButton, 3500);
    return;
  }
  resetGiveUpButton();
  endGame('lost');
}

function resetGiveUpButton() {
  clearTimeout(giveUpTimer);
  const btn = $('btn-giveup');
  btn.classList.remove('confirm');
  btn.textContent = 'Abandonner';
}

/** Fin de partie : met à jour les stats (seulement pour le défi du jour) et affiche le bilan. */
function endGame(status) {
  const { game, puzzle } = state;
  game.status = status;

  if (state.mode === 'daily' && !game.counted) {
    const s = state.store.stats;
    s.played += 1;
    if (status === 'won') {
      s.wins += 1;
      s.currentStreak = s.lastWinDay === state.dayIndex - 1 ? s.currentStreak + 1 : 1;
      s.lastWinDay = state.dayIndex;
      s.maxStreak = Math.max(s.maxStreak, s.currentStreak);
    } else {
      s.currentStreak = 0;
    }
    s.history.unshift({
      day: state.dayIndex,
      puzzleId: puzzle.id,
      title: puzzle.title,
      won: status === 'won',
      found: game.found.length,
      total: puzzle.items.length,
      errors: errorCount(game),
    });
    s.history = s.history.slice(0, 30);
    game.counted = true;
  }
  saveStore();

  let delay = 700;
  if (status === 'won') {
    document.querySelector('.board-frame').classList.add('celebrate');
    setTimeout(launchConfetti, 500);
  } else {
    // Abandon : on dévoile les réponses manquantes une par une
    puzzle.items
      .filter((it) => !game.found.includes(it.rank))
      .forEach((it, i) => setTimeout(() => revealRow(it.rank, { animate: true, missed: true }), 200 + i * 160));
    delay += puzzle.items.length * 160;
  }

  updateControls();
  setTimeout(openEndModal, delay + 500);
}

/* ---------------------------------------------------------------------------
   6. AFFICHAGE
   --------------------------------------------------------------------------- */
function renderAll() {
  const { puzzle, mode } = state;

  $('puzzle-badge').textContent = `Top ${puzzle.items.length} · ${puzzle.category}`;
  $('puzzle-number').textContent = mode === 'daily' ? `Émission n°${state.dayIndex + 1}` : 'Archive';
  $('puzzle-title').textContent = puzzle.title;
  $('puzzle-source').textContent = puzzle.source ? `Source : ${puzzle.source}` : '';
  $('archive-banner').hidden = mode !== 'archive';
  document.querySelector('.board-frame').classList.toggle('celebrate', state.game.status === 'won');

  renderBulbs();
  renderBoard();
  renderWrongList();
  renderStatus();
  updateControls();
}

function renderBulbs() {
  const box = $('bulbs');
  if (box.childElementCount) return;
  for (let i = 0; i < CONFIG.BULBS; i++) {
    const b = document.createElement('span');
    b.className = 'bulb';
    box.appendChild(b);
  }
}

/** Construit les N panneaux du classement (face cachée + face révélée). */
function renderBoard() {
  const { puzzle, game } = state;
  const board = $('board');
  board.innerHTML = '';
  const compact = puzzle.items.length > 5;
  board.classList.toggle('compact', compact);
  document.body.classList.toggle('is-compact', compact);

  for (const item of puzzle.items) {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.rank = item.rank;
    li.innerHTML = `
      <div class="row-inner">
        <div class="face face-front"><span class="num-oval">${item.rank}</span></div>
        <div class="face face-back">
          <span class="rank">${item.rank}</span>
          <span class="answer"><span>${escapeHtml(item.answer)}</span></span>
          <span class="value">${escapeHtml(item.value || '')}</span>
        </div>
      </div>`;
    board.appendChild(li);
  }

  // Restaure l'état sauvegardé, sans animation
  game.hinted.forEach((rank) => renderHint(rank));
  game.found.forEach((rank) => revealRow(rank, { animate: false }));
  if (game.status === 'lost') {
    puzzle.items.filter((it) => !game.found.includes(it.rank)).forEach((it) => revealRow(it.rank, { animate: false, missed: true }));
  }
  updateAriaLabels();
}

/** Retourne un panneau pour afficher la réponse. */
function revealRow(rank, { animate, missed = false }) {
  const row = document.querySelector(`.row[data-rank="${rank}"]`);
  if (!row) return;
  row.classList.toggle('missed', missed);
  if (!animate) {
    // Pas d'animation : on coupe temporairement la transition
    const inner = row.querySelector('.row-inner');
    inner.style.transition = 'none';
    row.classList.add('revealed');
    void inner.offsetHeight; // force le navigateur à appliquer le style immédiatement
    inner.style.transition = '';
  } else {
    row.classList.add('revealed');
    if (!missed) {
      row.classList.add('just-found');
      setTimeout(() => row.classList.remove('just-found'), 1800);
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  updateAriaLabels();
}

/** Affiche la 1re lettre (le reste masqué) et l'indice sur un panneau encore caché. */
function renderHint(rank) {
  const item = state.puzzle.items.find((it) => it.rank === rank);
  const row = document.querySelector(`.row[data-rank="${rank}"]`);
  if (!item || !row) return;
  row.classList.add('hinted');
  row.querySelector('.face-front').innerHTML = `
    <span class="hint-num">${item.rank}</span>
    <span class="hint-text">
      <span class="hint-mask">${escapeHtml(maskAnswer(item.answer))}</span>
      <span class="hint-clue">${escapeHtml(item.hint || '')}</span>
    </span>`;
}

function updateAriaLabels() {
  document.querySelectorAll('.row').forEach((row) => {
    const item = state.puzzle.items.find((it) => it.rank === Number(row.dataset.rank));
    row.setAttribute(
      'aria-label',
      row.classList.contains('revealed') ? `N°${item.rank} : ${item.answer}, ${item.value}` : `N°${item.rank} : caché`
    );
  });
}

function renderWrongList() {
  const box = $('wrong-list');
  box.innerHTML = '';
  state.game.log
    .filter((e) => e.t === 'wrong')
    .forEach((e) => {
      const chip = document.createElement('span');
      chip.className = 'wrong-chip';
      chip.textContent = e.v;
      box.appendChild(chip);
    });
}

/** Compteur d'erreurs + score "2/5". bump = petite animation sur la croix rouge. */
function renderStatus({ bump = false } = {}) {
  const errors = errorCount();
  const box = document.querySelector('.errors');
  box.classList.toggle('has-errors', errors > 0);
  $('errors-text').textContent = `${errors} ${plural(errors, 'erreur')}`;
  $('score').textContent = `${state.game.found.length}/${state.puzzle.items.length}`;
  if (bump) {
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
  }
}

/** Active / désactive les boutons selon l'état de la partie. */
function updateControls() {
  const { game, puzzle } = state;
  const playing = game.status === 'playing';
  const hintsLeft = puzzle.items.some((it) => !game.found.includes(it.rank) && !game.hinted.includes(it.rank));

  $('guess-input').disabled = !playing;
  $('btn-submit').disabled = !playing;
  $('btn-hint').hidden = !playing;
  $('btn-hint').disabled = !playing || !hintsLeft;
  $('btn-giveup').hidden = !playing;
  $('btn-results').hidden = playing;
  $('guess-input').placeholder = playing ? 'Ta réponse…' : game.status === 'won' ? 'Classement complété !' : 'Partie terminée';
}

function clearInput() {
  $('guess-input').value = '';
}

function shakeInput() {
  const input = $('guess-input');
  input.classList.remove('shake');
  void input.offsetWidth; // relance l'animation
  input.classList.add('shake');
  input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
}

/** Flash rouge sur les bords de l'écran + petite vibration (Android). */
function flashWrong() {
  const el = $('flash');
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  if (navigator.vibrate) navigator.vibrate(120);
}

/** Pluie de confettis en CSS pur (aucune bibliothèque). */
function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    const w = 6 + Math.random() * 6;
    c.style.left = `${Math.random() * 100}%`;
    c.style.width = `${w}px`;
    c.style.height = `${w * (Math.random() > 0.5 ? 2 : 0.6)}px`;
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    c.style.animationDuration = `${2.2 + Math.random() * 1.8}s`;
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    c.style.setProperty('--rot', `${(Math.random() - 0.5) * 1440}deg`);
    layer.appendChild(c);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 5000);
}

let toastTimer = null;
function toast(message, duration = 1900) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ----- Modales ----- */
function openModal(id) {
  const dlg = $(id);
  if (!dlg.open) dlg.showModal();
}

function statsHtml() {
  const s = state.store.stats;
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  const cells = [
    [s.played, 'Parties'],
    [`${pct}%`, 'Réussies'],
    [effectiveStreak(), 'Série en cours'],
    [s.maxStreak, 'Meilleure série'],
  ];
  return cells
    .map(([v, l]) => `<div class="stat"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`)
    .join('');
}

function openEndModal() {
  const { game, puzzle, mode } = state;
  const won = game.status === 'won';
  const errors = errorCount();
  const hints = game.hinted.length;
  const perfect = won && errors === 0 && hints === 0;

  $('modal-end').classList.toggle('lost', !won);
  $('end-kicker').textContent =
    `${mode === 'daily' ? `Émission n°${state.dayIndex + 1}` : 'Archive'} · Top ${puzzle.items.length} ${puzzle.category}`;
  $('end-title').textContent = perfect ? 'Sans faute !' : won ? 'Bravo !' : 'Dommage !';

  $('end-found').textContent = `${game.found.length}/${puzzle.items.length}`;
  $('end-errors').textContent = errors;
  $('end-errors-label').textContent = plural(errors, 'erreur');
  $('end-hints').textContent = hints;
  $('end-hints-label').textContent = plural(hints, 'joker');
  $('end-grid').textContent = emojiLine() || '—';

  $('end-stats').innerHTML =
    mode === 'daily' ? statsHtml() : '<p class="stats-note">Partie d\'archive : elle ne compte pas dans tes statistiques.</p>';

  $('end-ranking').innerHTML = puzzle.items
    .map((it) => {
      const ok = game.found.includes(it.rank);
      return `<li class="${ok ? 'ok' : 'ko'}"><span class="r">${it.rank}</span><span class="a">${escapeHtml(it.answer)}</span><span class="v">${escapeHtml(it.value || '')}</span></li>`;
    })
    .join('');

  $('end-next').textContent = mode === 'daily' ? `Prochaine émission dans ${timeUntilTomorrow()}` : '';
  openModal('modal-end');
}

function openStatsModal() {
  $('stats-grid').innerHTML = statsHtml();
  const history = state.store.stats.history.slice(0, 10);
  $('history-list').innerHTML = history.length
    ? history
        .map(
          (h) =>
            `<li><span>${h.won ? '✅' : '🏳️'} #${h.day + 1} · ${escapeHtml(h.title)}</span><span>${h.found}/${h.total}</span></li>`
        )
        .join('')
    : '<li class="empty">Aucune partie terminée pour l\'instant.</li>';
  openModal('modal-stats');
}

function openArchiveModal() {
  const list = $('archive-list');
  list.innerHTML = '';
  state.puzzles.forEach((p, i) => {
    const g = state.store.progress[`archive:${p.id}`];
    const status = !g ? '🆕' : g.status === 'won' ? '✅' : g.status === 'lost' ? '🏳️' : '▶️';
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="archive-item" type="button">
        <span class="ai-emoji">${p.emoji || '🏆'}</span>
        <span class="ai-text">
          <span class="ai-title">${escapeHtml(p.title)}</span><br/>
          <span class="ai-meta">Énigme ${i + 1} · Top ${p.items.length} · ${escapeHtml(p.category)}</span>
        </span>
        <span class="ai-status" aria-hidden="true">${status}</span>
      </button>`;
    li.querySelector('button').addEventListener('click', () => {
      $('modal-archive').close();
      openPuzzle(p, 'archive');
      if (state.game.status !== 'playing') setTimeout(openEndModal, 400);
    });
    list.appendChild(li);
  });
  openModal('modal-archive');
}

/* ---------------------------------------------------------------------------
   7. PARTAGE DU SCORE
   --------------------------------------------------------------------------- */

/** Ligne d'émojis dans l'ordre des actions du joueur : 🟩 bonne réponse, 🟥 erreur, 💡 joker. */
function emojiLine() {
  return state.game.log.map((e) => EMOJI[e.t] || '').join('');
}

function shareUrl() {
  if (CONFIG.SHARE_URL) return CONFIG.SHARE_URL;
  return location.protocol.startsWith('http') ? location.origin + location.pathname : '';
}

function buildShareText() {
  const { game, puzzle, mode } = state;
  const won = game.status === 'won';
  const errors = errorCount();
  const hints = game.hinted.length;
  const head = mode === 'daily' ? `${CONFIG.GAME_NAME} #${state.dayIndex + 1}` : `${CONFIG.GAME_NAME} (archive)`;
  return [
    `${head} ${won ? '🏆' : '🏳️'} ${game.found.length}/${puzzle.items.length}`,
    `${puzzle.emoji || '🏆'} Top ${puzzle.items.length} · ${puzzle.category}`,
    emojiLine(),
    `❌ ${errors} ${plural(errors, 'erreur')} · 💡 ${hints} ${plural(hints, 'joker')}`,
    shareUrl(),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Copie dans le presse-papiers, avec une méthode de secours pour les vieux navigateurs. */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

async function shareScore() {
  const text = buildShareText();
  const ok = await copyToClipboard(text);
  toast(ok ? 'Score copié ! Colle-le où tu veux' : 'Copie impossible sur ce navigateur', 2400);
  if (!ok) console.log(text);
}

/* ---------------------------------------------------------------------------
   8. DÉMARRAGE
   --------------------------------------------------------------------------- */
function bindEvents() {
  $('guess-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitGuess($('guess-input').value);
  });
  $('btn-hint').addEventListener('click', useHint);
  $('btn-giveup').addEventListener('click', giveUp);
  $('btn-results').addEventListener('click', openEndModal);
  $('btn-share').addEventListener('click', shareScore);
  $('btn-help').addEventListener('click', () => openModal('modal-help'));
  $('btn-stats').addEventListener('click', openStatsModal);
  $('btn-archive').addEventListener('click', openArchiveModal);
  $('btn-back-daily').addEventListener('click', () => openPuzzle(dailyPuzzle(), 'daily'));
  $('btn-restart').addEventListener('click', () => {
    delete state.store.progress[state.key];
    openPuzzle(state.puzzle, 'archive');
    toast('Nouvelle tentative !');
  });

  // Boutons "fermer" des modales + clic sur le fond sombre pour fermer
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  });
  $('modal-help').addEventListener('close', () => {
    state.store.seenHelp = true;
    saveStore();
  });
}

function showLoadError(err) {
  console.error(err);
  const box = $('load-error');
  const isFile = location.protocol === 'file:';
  box.hidden = false;
  box.innerHTML = isFile
    ? `<strong>Le jeu doit être lancé via un petit serveur local.</strong><br/>
       Les navigateurs bloquent la lecture de <code>puzzles.json</code> quand on ouvre la page en double-cliquant.
       Dans un terminal, place-toi dans le dossier du projet puis tape <code>python3 -m http.server 8000</code>,
       et ouvre <code>http://localhost:8000</code>. (Détails dans le README.)`
    : `<strong>Impossible de charger les énigmes.</strong> Vérifie que <code>puzzles.json</code> est présent et valide.<br/><small>${escapeHtml(err.message)}</small>`;
  $('puzzle-title').textContent = 'Oups…';
  ['guess-input', 'btn-submit', 'btn-hint', 'btn-giveup'].forEach((id) => ($(id).disabled = true));
}

async function init() {
  state.store = loadStore();
  state.dayIndex = getDayIndex();
  bindEvents();

  try {
    state.puzzles = await loadPuzzles();
  } catch (err) {
    showLoadError(err);
    return;
  } finally {
    $('app').setAttribute('aria-busy', 'false');
  }

  pruneOldProgress();
  openPuzzle(dailyPuzzle(), 'daily');

  if (!state.store.seenHelp) openModal('modal-help');
  else if (state.game.status !== 'playing') setTimeout(openEndModal, 500);
}

document.addEventListener('DOMContentLoaded', init);

// Expose quelques fonctions dans la console du navigateur pour faciliter les tests
window.TopMystere = { normalize, findMatch, state, resetAll: () => { localStorage.removeItem(CONFIG.STORAGE_KEY); location.reload(); } };
