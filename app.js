/* ==========================================================================
   TopMystère — logique du jeu (JavaScript Vanilla, aucun framework)

   Organisation du fichier :
     1. Configuration
     2. Utilitaires (dates, normalisation du texte, distance de Levenshtein)
     3. Sauvegarde locale (localStorage)
     4. Chargement des énigmes (puzzles.json)
     5. Logique de jeu (proposer, indice, victoire / défaite)
     6. Affichage (plateau, vies, modales…)
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
  MAX_LIVES: 3,
  PUZZLES_URL: 'puzzles.json',
  STORAGE_KEY: 'topmystere:v1',
  // Lien ajouté au message de partage. Laisser vide = adresse actuelle de la page.
  SHARE_URL: '',
};

const EMOJI = { correct: '🟩', wrong: '🟥', hint: '💡' };
const PRAISE = ['Bien vu !', 'Excellent !', 'Yes !', 'Bonne pioche !', 'Incroyable !', 'Exact !'];

/* ---------------------------------------------------------------------------
   2. UTILITAIRES
   --------------------------------------------------------------------------- */

/** Raccourci pour document.getElementById */
const $ = (id) => document.getElementById(id);

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
    status: 'playing', // 'playing' | 'won' | 'lost'
    lives: CONFIG.MAX_LIVES,
    found: [], // rangs trouvés
    hinted: [], // rangs pour lesquels un indice a été donné
    log: [], // historique : { t: 'correct' | 'wrong' | 'hint', v: texte, rank }
    counted: false, // déjà pris en compte dans les stats ?
  };
}

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
      toast(`Déjà trouvé : « ${item.answer} » 😉`);
      clearInput();
      return;
    }
    game.found.push(item.rank);
    game.log.push({ t: 'correct', v: value, rank: item.rank });
    revealRow(item.rank, { animate: true });
    toast(`${PRAISE[Math.floor(Math.random() * PRAISE.length)]} N°${item.rank}`);
    clearInput();
    if (game.found.length === puzzle.items.length) endGame('won');
    else saveStore();
    renderStatus();
    return;
  }

  // ❌ Mauvaise réponse (on ne pénalise pas deux fois la même)
  const norm = normalize(value);
  const already = game.log.some((e) => e.t === 'wrong' && normalize(e.v) === norm);
  if (already) {
    toast('Tu as déjà proposé ça !');
    shakeInput();
    return;
  }
  game.log.push({ t: 'wrong', v: value });
  game.lives -= 1;
  shakeInput();
  clearInput();
  renderLives({ breakIndex: game.lives });
  renderWrongList();
  if (game.lives <= 0) {
    toast('Pas dans le classement… plus de vies !');
    endGame('lost');
  } else {
    toast(`Pas dans le classement ! (${game.lives} ❤️ restante${game.lives > 1 ? 's' : ''})`);
    saveStore();
  }
  renderStatus();
}

/** Indice : coûte 1 vie, révèle la 1re lettre + un indice de la meilleure place encore cachée. */
function useHint() {
  const { game, puzzle } = state;
  if (game.status !== 'playing') return;

  const target = puzzle.items.find((it) => !game.found.includes(it.rank) && !game.hinted.includes(it.rank));
  if (!target) {
    toast('Tous les indices sont déjà affichés !');
    return;
  }
  if (game.lives <= 1) {
    toast('Il te faut au moins 2 vies pour un indice ❤️');
    return;
  }

  game.lives -= 1;
  game.hinted.push(target.rank);
  game.log.push({ t: 'hint', rank: target.rank });
  saveStore();

  renderLives({ breakIndex: game.lives });
  renderHint(target.rank);
  toast(`Indice révélé pour le n°${target.rank} 💡`);
  renderStatus();
  // Fait défiler jusqu'à la ligne concernée (utile pour les Top 10 sur mobile)
  document.querySelector(`.row[data-rank="${target.rank}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    });
    s.history = s.history.slice(0, 30);
    game.counted = true;
  }
  saveStore();

  // En cas de défaite, on révèle les réponses manquantes une par une
  let delay = 600;
  if (status === 'lost') {
    puzzle.items
      .filter((it) => !game.found.includes(it.rank))
      .forEach((it, i) => setTimeout(() => revealRow(it.rank, { animate: true, missed: true }), delay + i * 180));
    delay += puzzle.items.length * 180;
  }

  updateControls();
  setTimeout(openEndModal, delay + 500);
}

/* ---------------------------------------------------------------------------
   6. AFFICHAGE
   --------------------------------------------------------------------------- */
const HEART_SVG =
  '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.1c2.1-.2 3.9.9 5.4 2.8 1.5-1.9 3.3-3 5.4-2.8 3.7.4 5.7 4.3 4.2 7.7C19.5 16.4 12 21 12 21z"/></svg>';

function renderAll() {
  const { puzzle, mode } = state;

  $('puzzle-badge').textContent = `${puzzle.emoji || '🏆'} Top ${puzzle.items.length} · ${puzzle.category}`;
  $('puzzle-number').textContent = mode === 'daily' ? `#${state.dayIndex + 1}` : 'Archive';
  $('puzzle-title').textContent = puzzle.title;
  $('puzzle-source').textContent = puzzle.source ? `Source : ${puzzle.source}` : '';
  $('archive-banner').hidden = mode !== 'archive';

  renderBoard();
  renderLives();
  renderWrongList();
  renderStatus();
  updateControls();
}

/** Construit les N lignes du classement (faces avant cachées + faces arrière révélées). */
function renderBoard() {
  const { puzzle, game } = state;
  const board = $('board');
  board.innerHTML = '';

  for (const item of puzzle.items) {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.rank = item.rank;
    li.innerHTML = `
      <div class="row-inner">
        <div class="face face-front">
          <span class="rank">${item.rank}</span>
          <div class="mystery"><span class="mystery-dots">• • • • •</span></div>
        </div>
        <div class="face face-back">
          <span class="rank">${item.rank}</span>
          <span class="answer">${escapeHtml(item.answer)}</span>
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

/** Retourne une ligne pour afficher la réponse. */
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

/** Affiche la 1re lettre et l'indice sur une ligne encore cachée. */
function renderHint(rank) {
  const item = state.puzzle.items.find((it) => it.rank === rank);
  const box = document.querySelector(`.row[data-rank="${rank}"] .mystery`);
  if (!item || !box) return;
  const firstLetter = item.answer.trim().charAt(0).toUpperCase();
  box.innerHTML = `<span class="mystery-hint"><strong>${escapeHtml(firstLetter)}…</strong> ${escapeHtml(item.hint || '')}</span>`;
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

/** Cœurs : pleins = vies restantes. breakIndex = cœur à animer (celui qu'on vient de perdre). */
function renderLives({ breakIndex = -1 } = {}) {
  const box = $('lives');
  box.innerHTML = '';
  for (let i = 0; i < CONFIG.MAX_LIVES; i++) {
    const wrap = document.createElement('span');
    wrap.innerHTML = HEART_SVG;
    const heart = wrap.firstElementChild;
    if (i >= state.game.lives) heart.classList.add('lost');
    if (i === breakIndex) heart.classList.add('breaking');
    box.appendChild(heart);
  }
  box.setAttribute('aria-label', `${state.game.lives} vie(s) restante(s) sur ${CONFIG.MAX_LIVES}`);
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

function renderStatus() {
  $('progress').textContent = `${state.game.found.length} / ${state.puzzle.items.length} trouvés`;
}

/** Active / désactive les boutons selon l'état de la partie. */
function updateControls() {
  const { game, puzzle } = state;
  const playing = game.status === 'playing';
  const hintsLeft = puzzle.items.some((it) => !game.found.includes(it.rank) && !game.hinted.includes(it.rank));

  $('guess-input').disabled = !playing;
  $('btn-submit').disabled = !playing;
  $('btn-hint').hidden = !playing;
  $('btn-hint').disabled = !playing || !hintsLeft || game.lives <= 1;
  $('btn-results').hidden = playing;
  $('guess-input').placeholder = playing ? 'Propose une réponse…' : game.status === 'won' ? 'Classement complété 🎉' : 'Partie terminée';
}

function clearInput() {
  $('guess-input').value = '';
}

function shakeInput() {
  const input = $('guess-input');
  input.classList.remove('shake');
  void input.offsetWidth; // relance l'animation
  input.classList.add('shake');
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
    [`${pct}%`, 'Victoires'],
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
  const hints = game.hinted.length;

  $('end-emoji').textContent = won ? (game.lives === CONFIG.MAX_LIVES ? '🏆' : '🎉') : '💀';
  $('end-title').textContent = won ? (game.lives === CONFIG.MAX_LIVES ? 'Sans faute !' : 'Bravo !') : 'Perdu…';
  $('end-subtitle').textContent =
    `${game.found.length}/${puzzle.items.length} trouvés` +
    (hints ? ` · ${hints} indice${hints > 1 ? 's' : ''}` : '') +
    ` · ${game.lives} ❤️ restante${game.lives > 1 ? 's' : ''}`;
  $('end-grid').textContent = emojiLine() || '—';

  $('end-stats').innerHTML =
    mode === 'daily' ? statsHtml() : '<p class="stats-note">Partie d\'archive : elle ne compte pas dans tes statistiques.</p>';

  $('end-ranking').innerHTML = puzzle.items
    .map((it) => {
      const ok = game.found.includes(it.rank);
      return `<li class="${ok ? 'ok' : 'ko'}"><span class="r">${it.rank}</span><span class="a">${escapeHtml(it.answer)}</span><span class="v">${escapeHtml(it.value || '')}</span></li>`;
    })
    .join('');

  $('end-next').textContent = mode === 'daily' ? `Prochain classement dans ${timeUntilTomorrow()} ⏳` : '';
  openModal('modal-end');
}

function openStatsModal() {
  $('stats-grid').innerHTML = statsHtml();
  const history = state.store.stats.history.slice(0, 10);
  $('history-list').innerHTML = history.length
    ? history
        .map(
          (h) =>
            `<li><span>${h.won ? '✅' : '❌'} #${h.day + 1} · ${escapeHtml(h.title)}</span><span>${h.found}/${h.total}</span></li>`
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
    const status = !g ? '🆕' : g.status === 'won' ? '✅' : g.status === 'lost' ? '❌' : '▶️';
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

/** Ligne d'émojis dans l'ordre des actions du joueur : 🟩 bonne réponse, 🟥 erreur, 💡 indice. */
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
  const head = mode === 'daily' ? `${CONFIG.GAME_NAME} #${state.dayIndex + 1}` : `${CONFIG.GAME_NAME} (archive)`;
  const hearts = '❤️'.repeat(game.lives) + '🖤'.repeat(CONFIG.MAX_LIVES - game.lives);
  return [
    `${head} ${won ? '🏆' : '💀'} ${game.found.length}/${puzzle.items.length}`,
    `${puzzle.emoji || '🏆'} Top ${puzzle.items.length} · ${puzzle.category}`,
    emojiLine(),
    hearts,
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
  toast(ok ? 'Score copié ! Colle-le où tu veux 📋' : 'Copie impossible sur ce navigateur 😕', 2400);
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
  $('guess-input').disabled = true;
  $('btn-submit').disabled = true;
  $('btn-hint').disabled = true;
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
