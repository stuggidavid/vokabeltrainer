import * as S from './store.js';
import { state, save } from './store.js';
import * as SRS from './srs.js';
import { prepareImage, extractVocab, testKey } from './scan.js';

const $app = document.getElementById('app');
const AVATARS = ['🐱', '🐶', '🐰', '🐴', '🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🦁', '🐨', '🐧', '🐬', '🦖', '🐝', '🚀', '⚽', '🎸', '🌈'];
const LANGS = {
  en: { flag: '🇬🇧', name: 'Englisch', voice: 'en-GB' },
  fr: { flag: '🇫🇷', name: 'Französisch', voice: 'fr-FR' },
  de: { flag: '🇩🇪', name: 'Deutsch', voice: 'de-DE' },
};
const MODES = { auto: 'Automatisch', choice: 'Multiple-Choice', type: 'Eintippen' };
const MODE_HINTS = {
  auto: 'Neue Wörter mit Multiple-Choice, bekannte Wörter zum Eintippen.',
  choice: 'Mit Multiple-Choice kommen Wörter höchstens bis Fach 2. Damit sie als „gut gelernt“ zählen, musst du sie eintippen.',
  type: 'Du schreibst jedes Wort selbst – so wie im Vokabeltest.',
};
const DIRECTIONS = { fx2de: 'Fremdsprache → Deutsch', de2fx: 'Deutsch → Fremdsprache', mix: 'Gemischt' };
const SIZES = { 5: '5', 10: '10', 20: '20' };
const SENT_MODES = { mix: 'Gemischt', gap: 'Lückensatz', puzzle: 'Satz-Puzzle' };
const SENT_HINTS = {
  mix: 'Mal fehlt ein Wort im Satz, mal setzt du den ganzen Satz aus Kärtchen zusammen.',
  gap: 'Ein Wort fehlt im Satz – du tippst es ein, so wie es im Satz stehen muss.',
  puzzle: 'Du siehst den deutschen Satz und setzt den französischen aus Kärtchen zusammen.',
};
const BOX_COLORS = ['var(--box0)', 'var(--box1)', 'var(--box2)', 'var(--box3)', 'var(--box4)', 'var(--box5)'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let view = { name: 'profiles' };
let session = null;
let review = null;
let modal = null;
let parentUnlocked = false;

function go(name, params = {}) {
  view = { name, ...params };
  modal = null;
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (view.name !== 'profiles' && view.name !== 'parent-gate' && view.name !== 'parent'
      && view.name !== 'profile-edit' && !S.activeProfile()) view = { name: 'profiles' };
  $app.innerHTML = VIEWS[view.name]() + (modal ? MODALS[modal.type]() : '');
  document.body.classList.toggle('modal-open', !!modal);
  AFTER[view.name]?.();
}

function openModal(m) { modal = m; render(); }
function closeModal() { modal = null; render(); }

const validWords = list => list.words.filter(w => w.fx && w.de);
// Wörter mit Beispielsatz, der sich als Lückensatz oder Puzzle abfragen lässt.
const sentenceItems = lists => lists.flatMap(list => validWords(list)
  .filter(w => w.ex?.fx && SRS.sentenceModes(w.ex, w, list.lang).length).map(word => ({ word, list })));
// Buch-Abschnitte zählen für „Heute dran“ erst, wenn das Kind dort angefangen hat.
const isStarted = l => !l.book || l.words.some(w => w.seen || w.ex?.seen);
const langsOf = p => [...new Set(S.listsOf(p.id).map(l => l.lang))];
function currentLang(p) {
  const langs = langsOf(p);
  return langs.includes(p.prefs.lang) ? p.prefs.lang : langs[0] || '';
}
const listsInLang = (p, lang) => S.listsOf(p.id).filter(l => !lang || l.lang === lang);
const pageRange = b => b.page ? `S. ${b.page}${b.pageEnd && b.pageEnd !== b.page ? `–${b.pageEnd}` : ''}` : '';

// Beispielsatz mit hervorgehobener Lücke.
function sentenceHTML(ex, word, lang) {
  const p = SRS.sentenceParts(ex, word, lang);
  return `${esc(p.before)}<b>${esc(p.gap)}</b>${esc(p.after)}`;
}
const exampleBlock = (word, lang) => word.ex?.fx ? `
  <div class="example"><div><span lang="${lang}">${sentenceHTML(word.ex, word, lang)}</span>
    <button class="icon-btn small" data-action="speak" data-text="${esc(SRS.sentenceParts(word.ex, word, lang).plain)}" data-lang="${lang}" aria-label="Satz vorlesen">🔊</button></div>
    ${word.ex.de ? `<small>${esc(word.ex.de)}</small>` : ''}</div>` : '';
const extraInfo = word => `${word.tip ? `<p class="small tip">💡 ${esc(word.tip)}</p>` : ''}${word.note ? `<p class="small">ℹ️ ${esc(word.note)}</p>` : ''}`;

// Knopfleiste zum Auswählen einer Rundeneinstellung (wird direkt im Profil gemerkt).
const seg = (key, options, current) => `<div class="seg">${Object.entries(options).map(([v, t]) =>
  `<button class="${v === String(current) ? 'sel' : ''}" data-action="set-pref" data-k="${key}" data-v="${v}">${t}</button>`).join('')}</div>`;

const modalShell = (title, body) => `
  <div class="modal-backdrop" data-action="backdrop">
    <div class="modal" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn small" data-action="close-modal" aria-label="Schließen">✕</button></div>
      ${body}
    </div>
  </div>`;

// ---------- kleine Helfer ----------
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

function speak(text, lang) {
  if (!('speechSynthesis' in window) || !LANGS[lang]) return;
  const u = new SpeechSynthesisUtterance(text.replace(/\([^)]*\)/g, ''));
  u.lang = LANGS[lang].voice;
  u.rate = 0.9;
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find(v => v.lang.replace('_', '-') === u.lang) || voices.find(v => v.lang.startsWith(lang)) || null;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function confetti() {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  document.body.append(c);
  const ctx = c.getContext('2d');
  const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#a29bfe', '#ff9ff3'];
  const parts = Array.from({ length: 140 }, () => ({
    x: c.width / 2, y: c.height * 0.35, r: (4 + Math.random() * 5) * devicePixelRatio,
    vx: (Math.random() - 0.5) * 22 * devicePixelRatio, vy: (-Math.random() * 18 - 4) * devicePixelRatio,
    color: colors[Math.floor(Math.random() * colors.length)], rot: Math.random() * 6,
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.6 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += 0.2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (t - start < 3000) requestAnimationFrame(frame); else c.remove();
  })(start);
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;

function profileStats(p, lang) {
  const lists = listsInLang(p, lang).filter(isStarted);
  const words = lists.flatMap(l => l.words).filter(w => w.fx && w.de);
  const now = Date.now();
  return {
    lists, total: words.length,
    due: words.filter(w => SRS.isDue(w, now)).length,
    fresh: words.filter(w => !w.seen).length,
    solid: words.filter(w => w.box >= 3).length,
  };
}

function boxBar(words) {
  const valid = words.filter(w => w.fx && w.de);
  if (!valid.length) return '<div class="boxbar empty"></div>';
  const counts = [0, 0, 0, 0, 0, 0];
  let unseen = 0;
  for (const w of valid) w.seen ? counts[w.box]++ : unseen++;
  const seg = (n, color) => n ? `<span style="flex:${n};background:${color}"></span>` : '';
  return `<div class="boxbar">${counts.map((n, i) => seg(n, BOX_COLORS[i])).join('')}${seg(unseen, 'var(--unseen)')}</div>`;
}

const langOptions = sel => Object.entries(LANGS).filter(([k]) => k !== 'de')
  .map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l.flag} ${l.name}</option>`).join('');

// ---------- Bildschirme ----------
const VIEWS = {
  profiles() {
    const cards = state.profiles.map(p => `
      <button class="profile-card" data-action="pick-profile" data-id="${p.id}">
        <span class="avatar">${p.avatar}</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="meta">Level ${SRS.levelOf(p.xp)}${SRS.currentStreak(p) ? ` · 🔥 ${SRS.currentStreak(p)}` : ''}</span>
      </button>`).join('');
    return `
      <header class="top">
        <span></span><h1>Vokabeltrainer</h1>
        <button class="icon-btn" data-action="open-parent" aria-label="Eltern-Bereich">⚙️</button>
      </header>
      <p class="lead">${state.profiles.length ? 'Wer lernt heute?' : 'Willkommen! Lege zuerst ein Profil an.'}</p>
      <div class="profile-grid">
        ${cards}
        <button class="profile-card add" data-action="new-profile"><span class="avatar">＋</span><span class="pname">Neues Profil</span></button>
      </div>
      ${isIOS && !isStandalone ? `<div class="hint">💡 Tipp: In Safari auf <b>Teilen</b> und dann auf <b>„Zum Home-Bildschirm“</b> tippen. Dann startet der Trainer wie eine richtige App.</div>` : ''}`;
  },

  'profile-edit'() {
    const p = state.profiles.find(x => x.id === view.id);
    const avatar = view.avatar || p?.avatar || AVATARS[state.profiles.length % AVATARS.length];
    view.avatar = avatar;
    return `
      <header class="top">
        <button class="icon-btn" data-action="back-from-profile-edit" aria-label="Zurück">←</button>
        <h1>${p ? 'Profil bearbeiten' : 'Neues Profil'}</h1><span></span>
      </header>
      <form class="card form" data-submit="save-profile">
        <label>Name<input name="name" required maxlength="20" value="${esc(p?.name)}" placeholder="z. B. Lena" autocomplete="off"></label>
        <div class="label">Bild</div>
        <div class="avatar-grid">
          ${AVATARS.map(a => `<button type="button" class="avatar-choice ${a === avatar ? 'sel' : ''}" data-action="pick-avatar" data-a="${a}">${a}</button>`).join('')}
        </div>
        <button class="btn primary big" type="submit">Speichern</button>
      </form>`;
  },

  home() {
    const p = S.activeProfile();
    const lang = currentLang(p);
    const langs = langsOf(p);
    const all = listsInLang(p, lang);
    const st = profileStats(p, lang);
    const L = SRS.levelOf(p.xp);
    const pct = Math.round(100 * (p.xp - SRS.xpForLevel(L)) / (SRS.xpForLevel(L + 1) - SRS.xpForLevel(L)));
    const streak = SRS.currentStreak(p);
    const todo = st.due + st.fresh;
    const books = new Map();
    for (const l of all.filter(l => l.book)) {
      if (!books.has(l.book.id)) books.set(l.book.id, { id: l.book.id, title: l.book.title, lists: [] });
      books.get(l.book.id).lists.push(l);
    }
    const bookCards = [...books.values()].map(b => {
      const words = b.lists.flatMap(validWords);
      const units = [...new Set(b.lists.map(l => l.book.unitTitle.split(' · ')[0]))];
      return `
      <div class="list-card">
        <button class="list-main" data-action="open-book" data-id="${b.id}">
          <span class="flag">📘</span>
          <span class="list-info"><b>${esc(b.title)}</b><small>${esc(units[0])}${units.length > 1 ? ` bis ${esc(units.at(-1))}` : ''} · ${words.length} Wörter · ${words.filter(w => w.box >= SRS.SOLID_BOX).length} gut gelernt</small>${boxBar(words)}</span>
          <span class="chev">›</span>
        </button>
      </div>`;
    }).join('');
    const firstBook = [...books.keys()][0];
    const lists = all.filter(l => !l.book).sort((a, b) => b.createdAt - a.createdAt).map(l => {
      const valid = validWords(l);
      return `
      <div class="list-card">
        <button class="list-main" data-action="edit-list" data-id="${l.id}">
          <span class="flag">${LANGS[l.lang]?.flag || '🏳️'}</span>
          <span class="list-info"><b>${esc(l.name)}</b><small>${valid.length} Wörter · ${valid.filter(w => w.box >= SRS.SOLID_BOX).length} gut gelernt</small>${boxBar(l.words)}</span>
        </button>
        <div class="list-actions">
          <button class="btn small" data-action="learn-list" data-id="${l.id}" ${valid.length ? '' : 'disabled'}>Lernen</button>
          <button class="btn small" data-action="review-list" data-id="${l.id}" ${valid.length ? '' : 'disabled'} aria-label="Durchgehen">🃏</button>
        </div>
      </div>`;
    }).join('');
    return `
      <header class="top">
        <button class="icon-btn avatar-btn" data-action="switch-profile" aria-label="Profil wechseln">${p.avatar}</button>
        <div class="who"><b>${esc(p.name)} <button class="edit-name" data-action="edit-own-profile" aria-label="Profil bearbeiten">✏️</button></b><small>Level ${L} · ${p.xp} Punkte</small><div class="xpbar"><span style="width:${pct}%"></span></div></div>
        <div class="streak ${streak ? 'on' : ''}" title="Tage am Stück">🔥 ${streak}</div>
      </header>

      ${langs.length > 1 ? `<div class="seg tabs">${langs.map(k => `<button class="${k === lang ? 'sel' : ''}" data-action="set-lang" data-v="${k}">${LANGS[k]?.flag || ''} ${LANGS[k]?.name || k}</button>`).join('')}</div>` : ''}

      <section class="card hero">
        ${!all.length
          ? `<h2>Noch keine Vokabeln</h2><p>Füge dein Schulbuch hinzu, fotografiere eine Vokabelseite oder lege eine Liste an.</p>
             <button class="btn primary big" data-action="open-books">📚 Buch hinzufügen</button>
             <button class="btn hero-2" data-action="scan">📷 Vokabeln fotografieren</button>`
          : st.total === 0
          ? `<h2>Los geht's!</h2><p>Öffne dein Buch und wähle aus, was du lernen möchtest.</p>
             <button class="btn primary big" data-action="open-book" data-id="${firstBook}">📘 Buch öffnen</button>`
          : `${todo > 0
              ? `<h2>Heute dran: ${todo} ${todo === 1 ? 'Wort' : 'Wörter'}</h2><p>${st.due} zum Wiederholen · ${st.fresh} neu</p>
                 <button class="btn primary big" data-action="learn-all">Los geht's! 🚀</button>`
              : `<h2>Alles erledigt für heute! 🎉</h2><p>Du kannst trotzdem frei üben.</p>
                 <button class="btn primary big" data-action="learn-all">Freies Üben</button>`}
             <button class="btn hero-2" data-action="review-pick">🃏 Schnell durchgehen</button>`}
      </section>

      <div class="section-head">
        <h2>Meine Bücher</h2>
        <button class="btn small" data-action="open-books">＋ Buch</button>
      </div>
      ${bookCards || '<p class="small center">Noch kein Buch. Mit „＋ Buch“ holst du dir die Vokabeln aus deinem Schulbuch.</p>'}

      <div class="section-head">
        <h2>Meine Listen</h2>
        <div class="row">
          <button class="btn small" data-action="scan">📷 Foto</button>
          <button class="btn small" data-action="new-list">＋ Liste</button>
        </div>
      </div>
      ${lists || '<p class="small center">Noch keine Listen.</p>'}

      <div class="section-head"><h2>Abzeichen</h2></div>
      <div class="badges">
        ${Object.entries(SRS.BADGES).map(([k, b]) => `<div class="badge ${p.badges.includes(k) ? 'got' : ''}" title="${esc(b.text)}"><span>${b.icon}</span><small>${b.name}</small></div>`).join('')}
      </div>
      <button class="legend" data-action="info">Karteikasten: ${BOX_COLORS.map((c, i) => `<span><i style="background:${c}"></i>${i}</span>`).join('')}<span><i style="background:var(--unseen)"></i>neu</span><span>ℹ️ Wie funktioniert das?</span></button>`;
  },

  // Buch: Unités mit ihren Abschnitten (A1, B2 … und ★-Sonderkästen) zum Ankreuzen.
  book() {
    const p = S.activeProfile();
    const lists = S.listsOf(p.id).filter(l => l.book?.id === view.id).sort((a, b) => a.book.order - b.book.order);
    if (!lists.length) return VIEWS.home();
    const sel = new Set(view.sel);
    const units = [];
    for (const l of lists) {
      if (units.at(-1)?.id !== l.book.unit) units.push({ id: l.book.unit, title: l.book.unitTitle, lists: [] });
      units.at(-1).lists.push(l);
    }
    view.open ??= new Set(units.filter(u => u.lists.some(l => sel.has(l.id))).map(u => u.id));
    if (!view.open.size) view.open.add(units[0].id);
    const chosen = lists.filter(l => sel.has(l.id));
    const nWords = chosen.reduce((n, l) => n + validWords(l).length, 0);
    const nSent = sentenceItems(chosen).length;
    const html = units.map(u => {
      const words = u.lists.flatMap(validWords);
      const allSel = u.lists.every(l => sel.has(l.id)), someSel = u.lists.some(l => sel.has(l.id));
      const pages = u.lists.flatMap(l => [l.book.page, l.book.pageEnd]).filter(Boolean);
      const open = view.open.has(u.id);
      return `
      <section class="card unit">
        <div class="unit-head">
          <button class="unit-check ${allSel ? 'on' : someSel ? 'some' : ''}" data-action="toggle-unit" data-unit="${esc(u.id)}" aria-label="Ganze Unité auswählen"><span class="box-check">${allSel ? '✓' : someSel ? '–' : ''}</span></button>
          <button class="unit-title" data-action="toggle-open" data-unit="${esc(u.id)}">
            <span class="grow"><b>${esc(u.title)}</b><small>${pages.length ? `S. ${Math.min(...pages)}–${Math.max(...pages)} · ` : ''}${words.length} Wörter · ${words.filter(w => w.box >= SRS.SOLID_BOX).length} gut gelernt</small>${boxBar(words)}</span>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </button>
        </div>
        ${open ? `<div class="pick-list sections">${u.lists.map(l => {
          const v = validWords(l);
          return `
          <button class="pick-row ${sel.has(l.id) ? 'sel' : ''} ${l.book.extra ? 'extra' : ''}" data-action="toggle-section" data-id="${l.id}">
            <span class="box-check">${sel.has(l.id) ? '✓' : ''}</span>
            <span class="grow"><b>${esc(l.book.name)}</b><small>${[pageRange(l.book), `${v.length} ${v.length === 1 ? 'Wort' : 'Wörter'}`, `${v.filter(w => w.box >= SRS.SOLID_BOX).length} gut gelernt`].filter(Boolean).join(' · ')}</small>${boxBar(v)}</span>
          </button>`;
        }).join('')}</div>` : ''}
      </section>`;
    }).join('');
    return `
      <header class="top">
        <button class="icon-btn" data-action="back-home" aria-label="Zurück">←</button>
        <h1>${esc(lists[0].book.title)}</h1><span></span>
      </header>
      <p class="small center">Kreuze an, was du üben möchtest – ganze Unités oder einzelne Abschnitte. ★ sind die Sonderkästen.</p>
      ${html}
      <button class="btn danger-outline wide" data-action="remove-book">Buch aus meinem Profil entfernen</button>
      <div class="sel-bar">
        <div class="small center">${chosen.length ? `${nWords} Wörter · ${nSent} Sätze ausgewählt` : 'Noch nichts ausgewählt'}</div>
        <div class="row stretch">
          <button class="btn primary" data-action="book-learn" ${nWords ? '' : 'disabled'}>Lernen</button>
          <button class="btn" data-action="book-sentences" ${nSent ? '' : 'disabled'}>✍️ Sätze</button>
          <button class="btn" data-action="book-review" ${nWords ? '' : 'disabled'} aria-label="Schnell durchgehen">🃏</button>
        </div>
      </div>`;
  },

  'list-edit'() {
    const l = S.getList(view.id);
    if (!l) return VIEWS.home();
    const rows = l.words.map(w => `
      <div class="word-row" data-wid="${w.id}">
        <input data-field="fx" value="${esc(w.fx)}" placeholder="${LANGS[l.lang]?.name || 'Fremdwort'}" lang="${l.lang}" autocapitalize="off" autocomplete="off" spellcheck="false">
        <input data-field="de" value="${esc(w.de)}" placeholder="Deutsch" lang="de" autocapitalize="off" autocomplete="off" spellcheck="false">
        <button class="icon-btn small" data-action="speak-word" data-id="${w.id}" aria-label="Vorlesen">🔊</button>
        <button class="icon-btn small danger" data-action="del-word" data-id="${w.id}" aria-label="Löschen">✕</button>
        <input data-field="note" class="note" value="${esc(w.note)}" placeholder="Notiz (optional)" autocomplete="off">
        <input data-exfield="fx" class="note" value="${esc(w.ex?.fx)}" placeholder="Beispielsatz (optional)" lang="${l.lang}" autocapitalize="off" autocomplete="off" spellcheck="false">
        <input data-exfield="de" class="note" value="${esc(w.ex?.de)}" placeholder="Satz auf Deutsch" lang="de" autocapitalize="off" autocomplete="off" spellcheck="false">
        <span class="dots" title="Fach ${w.seen ? w.box : 'neu'}">${w.seen ? `<i style="background:${BOX_COLORS[w.box]}"></i>Fach ${w.box}` : '<i style="background:var(--unseen)"></i>neu'}</span>
      </div>`).join('');
    return `
      <header class="top">
        <button class="icon-btn" data-action="back-home" aria-label="Zurück">←</button>
        <h1>Liste</h1>
        <button class="btn small" data-action="learn-list" data-id="${l.id}">Lernen</button>
      </header>
      <div class="card form">
        <label>Name<input data-list-field="name" value="${esc(l.name)}" maxlength="40"></label>
        <label>Sprache<select data-list-field="lang">${langOptions(l.lang)}</select></label>
      </div>
      <div class="section-head"><h2>${l.words.length} Wörter</h2>
        <div class="row"><button class="btn small" data-action="scan" data-list="${l.id}">📷 Foto</button><button class="btn small" data-action="add-word">＋ Wort</button></div>
      </div>
      <div class="words">${rows || '<p class="small center">Noch keine Wörter. Tippe auf „＋ Wort“ oder fotografiere die Vokabeln.</p>'}</div>
      ${l.words.length > 5 ? '<button class="btn wide" data-action="add-word">＋ Wort</button>' : ''}
      ${validWords(l).length ? `<button class="btn wide" data-action="review-list" data-id="${l.id}">🃏 Schnell durchgehen</button>` : ''}
      <button class="btn danger-outline wide" data-action="delete-list">Liste löschen</button>`;
  },

  scan() {
    const p = S.activeProfile();
    const s = view;
    const header = `
      <header class="top">
        <button class="icon-btn" data-action="${s.listId ? 'back-list' : 'back-home'}" aria-label="Zurück">←</button>
        <h1>Vokabeln fotografieren</h1><span></span>
      </header>`;
    if (s.status === 'loading') return header + `
      <div class="card center loading"><div class="spinner"></div><h2>Ich lese die Vokabeln …</h2><p>Das dauert meist 20–60 Sekunden.</p></div>`;
    if (s.status === 'review') {
      const lists = S.listsOf(p.id).filter(l => !l.book);
      const checked = s.result.words.filter(w => w.use).length;
      return header + `
        <div class="card">
          <h2>${s.result.words.length} Vokabeln gefunden</h2>
          <p class="small">Bitte kurz kontrollieren. Du kannst alles noch ändern oder Wörter abwählen.</p>
        </div>
        <div class="words review">
          ${s.result.words.map((w, i) => `
            <div class="word-row ${w.use ? '' : 'off'}" data-ri="${i}">
              <input data-rfield="fx" value="${esc(w.fx)}" autocapitalize="off" autocomplete="off" spellcheck="false">
              <input data-rfield="de" value="${esc(w.de)}" autocapitalize="off" autocomplete="off" spellcheck="false">
              <label class="check"><input type="checkbox" data-rfield="use" ${w.use ? 'checked' : ''}></label>
              <span></span>
              <input data-rfield="note" class="note" value="${esc(w.note)}" placeholder="Notiz (optional)" autocomplete="off">
              ${w.example ? `
                <input data-rfield="example" class="note" value="${esc(w.example)}" placeholder="Beispielsatz" autocapitalize="off" autocomplete="off" spellcheck="false">
                <input data-rfield="example_de" class="note" value="${esc(w.example_de)}" placeholder="Satz auf Deutsch" autocapitalize="off" autocomplete="off" spellcheck="false">` : ''}
            </div>`).join('')}
        </div>
        <div class="card form">
          <label>Speichern in
            <select data-sfield="target">
              <option value="new" ${s.target === 'new' ? 'selected' : ''}>➕ Neue Liste</option>
              ${lists.map(l => `<option value="${l.id}" ${s.target === l.id ? 'selected' : ''}>${LANGS[l.lang]?.flag || ''} ${esc(l.name)}</option>`).join('')}
            </select>
          </label>
          ${s.target === 'new' ? `
            <label>Name der Liste<input data-sfield="newName" value="${esc(s.newName)}" maxlength="40"></label>
            <label>Sprache<select data-sfield="lang">${langOptions(s.lang)}</select></label>` : ''}
          <button class="btn primary big" data-action="scan-save" ${checked ? '' : 'disabled'}>${checked} Vokabeln übernehmen</button>
        </div>
        <button class="btn wide" data-action="scan-reset">Neue Fotos machen</button>`;
    }
    return header + `
      <div class="card">
        <p>Fotografiere die Vokabelseite im Schulbuch. Möglichst gerade von oben, mit gutem Licht. Mehrere Seiten gehen auch.</p>
        ${state.settings.apiKey ? '' : '<p class="warn">⚠️ Für den Foto-Import muss ein Erwachsener zuerst im Eltern-Bereich (⚙️) einen API-Schlüssel eintragen.</p>'}
        <div class="row stretch">
          <label class="btn big"><input type="file" accept="image/*" capture="environment" data-change="add-photos" hidden>📷 Foto aufnehmen</label>
          <label class="btn big"><input type="file" accept="image/*" multiple data-change="add-photos" hidden>🖼️ Aus Fotos wählen</label>
        </div>
        ${s.images.length ? `<div class="thumbs">${s.images.map((img, i) => `<div class="thumb"><img src="${img.preview}" alt="Foto ${i + 1}"><button class="icon-btn small danger" data-action="del-photo" data-i="${i}" aria-label="Foto entfernen">✕</button></div>`).join('')}</div>` : ''}
        ${s.error ? `<p class="warn">⚠️ ${esc(s.error)}</p>` : ''}
        <button class="btn primary big wide" data-action="scan-run" ${s.images.length && state.settings.apiKey ? '' : 'disabled'}>✨ Vokabeln erkennen</button>
      </div>`;
  },

  train() {
    const it = session.items[session.idx];
    const total = session.items.length;
    const a = session.answered;
    const top = `
      <header class="top train-top">
        <button class="icon-btn" data-action="quit-train" aria-label="Beenden">✕</button>
        <div class="progress"><span style="width:${Math.round(100 * (session.idx + (a ? 1 : 0)) / total)}%"></span></div>
        <span class="count">${Math.min(session.idx + 1, total)}/${total}</span>
      </header>
      ${session.practice ? '<p class="small center">Freies Üben – zählt nicht für den Karteikasten</p>' : ''}`;
    const tag = it.retry ? '<span class="tag">nochmal</span>' : `<span class="tag box">${it.box === null ? 'neu' : `Fach ${it.box}`}</span>`;
    if (it.mode === 'gap' || it.mode === 'puzzle') return top + sentenceCard(it, a, tag);
    const prompt = it.dir === 'fx2de' ? it.word.fx : it.word.de;
    const promptLang = it.dir === 'fx2de' ? it.list.lang : 'de';
    const expected = it.dir === 'fx2de' ? it.word.de : it.word.fx;
    const ansLang = it.dir === 'fx2de' ? 'de' : it.list.lang;
    const question = it.dir === 'fx2de' ? 'Was heißt das auf Deutsch?' : `Was heißt das auf ${LANGS[it.list.lang]?.name || 'der Fremdsprache'}?`;

    let body;
    if (it.mode === 'choice') {
      body = `<div class="choices">${it.choices.map((c, i) => {
        let cls = '';
        if (a) cls = c === expected ? 'right' : (i === a.chosen ? 'wrong' : 'dim');
        return `<button class="choice ${cls}" data-action="choose" data-i="${i}" ${a ? 'disabled' : ''}>${esc(c)}</button>`;
      }).join('')}</div>`;
    } else {
      body = `
        <form class="type-form" data-submit="type-answer">
          <input name="answer" id="answer" lang="${ansLang}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="Deine Antwort" value="${esc(a?.input)}" ${a ? 'disabled' : ''} class="${a ? (a.ok ? 'right' : 'wrong') : ''}">
          ${a ? '' : `<button class="btn primary" type="submit">Prüfen</button>`}
        </form>
        ${a ? '' : `<button class="link" data-action="dont-know">Weiß ich nicht</button>`}`;
    }

    let feedback = '';
    if (a) {
      const hint = a.hint === 'accent' ? `Achte auf die genaue Schreibweise: <b>${esc(expected)}</b>`
        : a.hint === 'article' ? `Denk an den Artikel: <b>${esc(expected)}</b>` : '';
      feedback = `
        <div class="feedback ${a.ok ? 'ok' : 'bad'}">
          <div class="fb-title">${a.ok ? pickPraise() : (a.close ? 'Fast richtig!' : 'Leider falsch')}</div>
          ${a.ok ? (hint ? `<p>${hint}</p>` : '') : `<p>Richtig ist: <b>${esc(expected)}</b></p>`}
          ${exampleBlock(it.word, it.list.lang)}
          ${extraInfo(it.word)}
          <button class="btn primary big" data-action="next" id="next">Weiter →</button>
        </div>`;
    }

    return top + `
      <section class="card quiz">
        <div class="q-head"><span class="flag">${LANGS[it.list.lang]?.flag || ''}</span><span class="small">${question}</span>${tag}</div>
        <div class="prompt">${esc(prompt)}
          ${promptLang !== 'de' ? `<button class="icon-btn small" data-action="speak" data-text="${esc(prompt)}" data-lang="${promptLang}" aria-label="Vorlesen">🔊</button>` : ''}
        </div>
        ${body}
      </section>
      ${feedback}`;
  },

  result() {
    const r = view;
    const stars = r.accuracy >= 0.9 ? 3 : r.accuracy >= 0.7 ? 2 : 1;
    return `
      <section class="card center result">
        <div class="stars">${[1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : ''}">★</span>`).join('')}</div>
        <h1>${stars === 3 ? 'Super gemacht!' : stars === 2 ? 'Gut gemacht!' : 'Weiter so!'}</h1>
        <p>${r.right} von ${r.total} beim ersten Versuch richtig</p>
        <p class="xp-gain">+${r.xp} Punkte</p>
        ${r.levelUp ? `<p class="levelup">🎊 Level ${r.level} erreicht!</p>` : ''}
        ${r.streak > 1 ? `<p>🔥 ${r.streak} Tage am Stück!</p>` : ''}
        ${r.badges.length ? `<div class="new-badges"><h2>Neue Abzeichen</h2>${r.badges.map(k => `<div class="badge got big"><span>${SRS.BADGES[k].icon}</span><small>${SRS.BADGES[k].name}</small></div>`).join('')}</div>` : ''}
        <div class="row stretch">
          <button class="btn big" data-action="back-home">Fertig</button>
          <button class="btn primary big" data-action="again">Nochmal</button>
        </div>
      </section>`;
  },

  review() {
    const it = review.items[review.idx];
    const total = review.items.length;
    const prompt = it.dir === 'fx2de' ? it.word.fx : it.word.de;
    const promptLang = it.dir === 'fx2de' ? it.list.lang : 'de';
    const back = it.dir === 'fx2de' ? it.word.de : it.word.fx;
    const backLang = it.dir === 'fx2de' ? 'de' : it.list.lang;
    const speakBtn = (text, lang) => lang !== 'de'
      ? `<button class="icon-btn small" data-action="speak" data-text="${esc(text)}" data-lang="${lang}" aria-label="Vorlesen">🔊</button>` : '';
    return `
      <header class="top train-top">
        <button class="icon-btn" data-action="quit-review" aria-label="Beenden">✕</button>
        <div class="progress"><span style="width:${Math.round(100 * review.idx / total)}%"></span></div>
        <span class="count">${review.idx + 1}/${total}</span>
      </header>
      <section class="card quiz flashcard">
        <div class="q-head"><span class="flag">${LANGS[it.list.lang]?.flag || ''}</span><span class="small">Weißt du es?</span></div>
        <div class="prompt">${esc(prompt)} ${speakBtn(prompt, promptLang)}</div>
        ${review.flipped
          ? `<div class="flip-answer">${esc(back)} ${speakBtn(back, backLang)}</div>
             ${exampleBlock(it.word, it.list.lang)}
             ${extraInfo(it.word)}
             <div class="row stretch self-grade">
               <button class="btn big bad" data-action="review-answer" data-ok="0">✗ Wusste ich nicht</button>
               <button class="btn big good" data-action="review-answer" data-ok="1" id="knew">✓ Wusste ich</button>
             </div>`
          : `<button class="btn primary big wide" data-action="flip" id="flip">Umdrehen</button>`}
      </section>`;
  },

  'review-result'() {
    const r = view;
    const shown = r.unsure.slice(0, 12);
    return `
      <section class="card center result">
        <div class="big-icon">🃏</div>
        <h1>${r.known} von ${r.total} gewusst</h1>
        <p class="xp-gain">+${r.xp} Punkte</p>
        ${r.badges.length ? `<div class="new-badges"><h2>Neue Abzeichen</h2>${r.badges.map(k => `<div class="badge got big"><span>${SRS.BADGES[k].icon}</span><small>${SRS.BADGES[k].name}</small></div>`).join('')}</div>` : ''}
        ${r.unsure.length ? `
          <p>Diese Wörter sitzen noch nicht:</p>
          <div class="chips">${shown.map(x => `<span>${esc(x.word.fx)}</span>`).join('')}${r.unsure.length > shown.length ? `<span>… +${r.unsure.length - shown.length}</span>` : ''}</div>
          <button class="btn primary big wide" data-action="practice-unsure">Die ${r.unsure.length} unsicheren Wörter jetzt üben</button>`
        : '<p>Alles gewusst – super! 🎉</p>'}
        <div class="row stretch">
          <button class="btn big" data-action="back-home">Fertig</button>
          <button class="btn big" data-action="review-again">Nochmal durchgehen</button>
        </div>
      </section>`;
  },

  'parent-gate'() {
    view.a ??= 6 + Math.floor(Math.random() * 4);
    view.b ??= 6 + Math.floor(Math.random() * 4);
    return `
      <header class="top"><button class="icon-btn" data-action="back-profiles" aria-label="Zurück">←</button><h1>Eltern-Bereich</h1><span></span></header>
      <form class="card form center" data-submit="parent-gate">
        <p>Bitte rechnen:</p>
        <p class="gate-q">${view.a} × ${view.b} = ?</p>
        <input name="r" inputmode="numeric" autocomplete="off" class="center">
        <button class="btn primary big" type="submit">OK</button>
      </form>`;
  },

  parent() {
    const key = state.settings.apiKey;
    return `
      <header class="top"><button class="icon-btn" data-action="back-profiles" aria-label="Zurück">←</button><h1>Eltern-Bereich</h1><span></span></header>
      <section class="card form">
        <h2>Foto-Import (Claude API)</h2>
        <p class="small">Für das Erkennen der Vokabeln auf Fotos wird ein API-Schlüssel von
          <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> benötigt.
          Pro Foto fallen nur wenige Cent an. Tipp: Dort ein monatliches Ausgabelimit setzen.</p>
        <label>API-Schlüssel<input type="password" id="apikey" placeholder="${key ? 'gespeichert: …' + esc(key.slice(-4)) : 'sk-ant-…'}" autocomplete="off"></label>
        <div class="row">
          <button class="btn primary" data-action="save-key">Speichern</button>
          ${key ? '<button class="btn" data-action="test-key">Testen</button><button class="btn danger-outline" data-action="clear-key">Entfernen</button>' : ''}
        </div>
        <p class="small" id="key-status"></p>
      </section>
      <section class="card">
        <h2>Profile</h2>
        ${state.profiles.map(p => `
          <div class="parent-row">
            <span class="avatar sm">${p.avatar}</span>
            <span class="grow"><b>${esc(p.name)}</b><small>${S.listsOf(p.id).reduce((n, l) => n + l.words.length, 0)} Wörter · Level ${SRS.levelOf(p.xp)}</small></span>
            <button class="btn small" data-action="edit-profile" data-id="${p.id}">Bearbeiten</button>
            <button class="icon-btn small danger" data-action="delete-profile" data-id="${p.id}" aria-label="Profil löschen">🗑️</button>
          </div>`).join('') || '<p class="small">Noch keine Profile.</p>'}
      </section>
      <section class="card form">
        <h2>Sicherung</h2>
        <p class="small">Alle Daten liegen nur auf diesem Gerät. Exportiere ab und zu eine Sicherung (z. B. in iCloud Drive).</p>
        <div class="row">
          <button class="btn" data-action="export">⬇️ Exportieren</button>
          <label class="btn"><input type="file" accept="application/json,.json" data-change="import" hidden>⬆️ Importieren</label>
        </div>
      </section>`;
  },
};

// Lückensatz oder Satz-Puzzle
function sentenceCard(it, a, tag) {
  const { parts, list } = it;
  const lang = list.lang;
  let body;
  if (it.mode === 'gap') {
    const w = Math.max(5, parts.gap.length + 2);
    body = `
      <form class="gap-form" data-submit="gap-answer">
        <p class="sentence" lang="${lang}">${esc(parts.before)}<input name="answer" id="answer" class="gap-input ${a ? (a.ok ? 'right' : 'wrong') : ''}" style="width:${w}ch"
          lang="${lang}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(a?.input)}" ${a ? 'disabled' : ''}>${esc(parts.after)}</p>
        ${a ? '' : '<button class="btn primary big wide" type="submit">Prüfen</button>'}
      </form>
      ${a ? '' : '<button class="link" data-action="dont-know">Weiß ich nicht</button>'}`;
  } else {
    const done = it.placed.length === it.pool.length;
    body = `
      <div class="puzzle-line ${a ? (a.ok ? 'right' : 'wrong') : ''}" lang="${lang}">
        ${it.placed.map((pi, i) => `<button class="tile" data-action="unplace" data-i="${i}" ${a ? 'disabled' : ''}>${esc(it.pool[pi])}</button>`).join('') || '<span class="small">Tippe die Kärtchen in der richtigen Reihenfolge an.</span>'}
      </div>
      ${a ? '' : `
        <div class="puzzle-pool" lang="${lang}">
          ${it.pool.map((t, i) => `<button class="tile ${it.placed.includes(i) ? 'used' : ''}" data-action="place" data-i="${i}" ${it.placed.includes(i) ? 'disabled' : ''}>${esc(t)}</button>`).join('')}
        </div>
        <button class="btn primary big wide" data-action="check-puzzle" ${done ? '' : 'disabled'}>Prüfen</button>
        <button class="link" data-action="dont-know">Weiß ich nicht</button>`}`;
  }
  let feedback = '';
  if (a) {
    const hint = a.hint === 'accent' ? `Achte auf die genaue Schreibweise: <b>${esc(parts.gap)}</b>` : '';
    feedback = `
      <div class="feedback ${a.ok ? 'ok' : 'bad'}">
        <div class="fb-title">${a.ok ? pickPraise() : (a.close ? 'Fast richtig!' : 'Leider falsch')}</div>
        ${a.ok && hint ? `<p>${hint}</p>` : ''}
        ${a.ok ? '' : '<p>Richtig ist:</p>'}
        ${exampleBlock(it.word, lang)}
        <p class="small">Vokabel: <b>${esc(it.word.fx)}</b> – ${esc(it.word.de)}</p>
        ${extraInfo(it.word)}
        <button class="btn primary big" data-action="next" id="next">Weiter →</button>
      </div>`;
  }
  return `
    <section class="card quiz">
      <div class="q-head"><span class="flag">${LANGS[lang]?.flag || ''}</span>
        <span class="small">${it.mode === 'gap' ? 'Welches Wort fehlt?' : 'Bilde den Satz!'}</span>${tag}</div>
      <div class="sentence-de">${esc(it.word.ex.de) || '&nbsp;'}</div>
      ${body}
    </section>
    ${feedback}`;
}

const PRAISE = ['Richtig! 🎉', 'Super! ⭐', 'Klasse! 💪', 'Genau! ✅', 'Stark! 🚀', 'Perfekt! 🌟'];
const pickPraise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];

const AFTER = {
  train() {
    if (modal) return;
    if (session.answered) document.getElementById('next')?.focus();
    else document.getElementById('answer')?.focus();
  },
  review() {
    if (modal) return;
    document.getElementById(review.flipped ? 'knew' : 'flip')?.focus();
  },
};

// ---------- Auswahlfenster ----------
const MODALS = {
  // Vor jeder Lernrunde: Richtung, Abfrage-Art, Rundengröße (letzte Wahl ist vorausgewählt).
  learn() {
    const pr = S.activeProfile().prefs;
    const lists = modal.listIds.map(S.getList).filter(Boolean);
    let info;
    if (modal.words) {
      info = `${modal.words.length} unsichere ${modal.words.length === 1 ? 'Wort' : 'Wörter'}`;
    } else {
      const words = lists.flatMap(validWords);
      const due = words.filter(w => SRS.isDue(w)).length, fresh = words.filter(w => !w.seen).length;
      info = due + fresh
        ? `${due} zum Wiederholen · ${fresh} neu`
        : 'Alles erledigt – das wird freies Üben (zählt nicht für den Karteikasten).';
    }
    const what = listsLabel(lists);
    return modalShell('Neue Runde', `
      <p class="small">${what} · ${info}</p>
      <div class="label">Richtung</div>${seg('direction', DIRECTIONS, pr.direction)}
      <div class="label">Abfrage</div>${seg('mode', MODES, pr.mode)}
      <p class="small hint-text">${MODE_HINTS[pr.mode]}</p>
      ${modal.words ? '' : `<div class="label">Wörter pro Runde</div>${seg('size', SIZES, pr.size)}`}
      <button class="btn primary big wide" data-action="start-learn">Los geht's! 🚀</button>`);
  },

  // Vor einer Sätze-Runde: Übungsart und Rundengröße.
  sentences() {
    const pr = S.activeProfile().prefs;
    const lists = modal.listIds.map(S.getList).filter(Boolean);
    const exs = sentenceItems(lists).map(x => x.word.ex);
    const due = exs.filter(e => SRS.isDue(e)).length, fresh = exs.filter(e => !e.seen).length;
    return modalShell('✍️ Sätze üben', `
      <p class="small">${listsLabel(lists)} · ${exs.length} Sätze · ${due + fresh ? `${due} zum Wiederholen · ${fresh} neu` : 'alles erledigt – das wird freies Üben'}</p>
      <div class="label">Übung</div>${seg('sentenceMode', SENT_MODES, pr.sentenceMode)}
      <p class="small hint-text">${SENT_HINTS[pr.sentenceMode]}</p>
      <div class="label">Sätze pro Runde</div>${seg('size', SIZES, pr.size)}
      <button class="btn primary big wide" data-action="start-sentences">Los geht's! ✍️</button>`);
  },

  // Bücher auf diesem Gerät, plus Buch-Datei laden.
  books() {
    const p = S.activeProfile();
    const rows = state.books.map(b => {
      const n = b.units.reduce((s, u) => s + u.sections.reduce((t, sec) => t + sec.words.length, 0), 0);
      return `
        <div class="parent-row">
          <span class="flag">${LANGS[b.lang]?.flag || '📘'}</span>
          <span class="grow"><b>${esc(b.title)}</b><small>${b.units.length} Kapitel · ${n} Wörter</small></span>
          ${S.hasBook(p.id, b.id) ? '<span class="small">✓ schon dabei</span>' : `<button class="btn small primary" data-action="add-book" data-id="${esc(b.id)}">Hinzufügen</button>`}
        </div>`;
    }).join('');
    return modalShell('📚 Buch hinzufügen', `
      ${rows || '<p class="small">Auf diesem Gerät ist noch kein Buch gespeichert.</p>'}
      <label class="btn wide"><input type="file" accept="application/json,.json" data-change="import-book" hidden>📂 Buch-Datei laden</label>
      <p class="small">Die Buch-Datei (.json) bekommst du z. B. per AirDrop oder Mail. Speichere sie in der App „Dateien“ und lade sie hier.
        Ist ein Buch schon da, wird es mit der neuen Datei aktualisiert – der Lernstand bleibt erhalten.</p>`);
  },

  // Vor dem Durchgehen: Listen und Richtung wählen.
  review() {
    const p = S.activeProfile();
    const sel = new Set(modal.selected);
    const lists = modal.pool.map(S.getList).filter(l => l && validWords(l).length);
    const total = lists.filter(l => sel.has(l.id)).reduce((n, l) => n + validWords(l).length, 0);
    return modalShell('🃏 Schnell durchgehen', `
      <div class="pick-head"><div class="label">Listen</div>
        <div class="row"><button class="btn small" data-action="review-all">Alle</button><button class="btn small" data-action="review-none">Keine</button></div>
      </div>
      <div class="pick-list">
        ${lists.map(l => `
          <button class="pick-row ${sel.has(l.id) ? 'sel' : ''}" data-action="toggle-review-list" data-id="${l.id}">
            <span class="box-check">${sel.has(l.id) ? '✓' : ''}</span>
            <span class="flag">${LANGS[l.lang]?.flag || ''}</span>
            <span class="grow"><b>${esc(l.name)}</b><small>${validWords(l).length} Wörter</small></span>
          </button>`).join('')}
      </div>
      <div class="label">Richtung</div>${seg('reviewDirection', DIRECTIONS, p.prefs.reviewDirection)}
      <p class="small hint-text">Umdrehen und ehrlich sagen, ob du es wusstest. Unsichere Wörter kommen in der nächsten Lernrunde dran.</p>
      <button class="btn primary big wide" data-action="start-review" ${total ? '' : 'disabled'}>${total} Wörter durchgehen</button>`);
  },

  info() {
    const rows = SRS.INTERVALS.map((d, i) => `
      <tr><td><i style="background:${BOX_COLORS[i]}"></i> Fach ${i}</td>
      <td>${i === 0 ? 'neu oder falsch – kommt gleich wieder dran' : `wieder dran nach ${d} ${d === 1 ? 'Tag' : 'Tagen'}`}</td></tr>`).join('');
    return modalShell('Der Karteikasten', `
      <p>Jedes Wort wandert durch 6 Fächer:</p>
      <ul class="info-list">
        <li><b>Richtig</b> → ein Fach weiter. Es kommt erst nach ein paar Tagen wieder dran.</li>
        <li><b>Falsch</b> → zurück in Fach 0. Es wird gleich nochmal geübt.</li>
        <li>Ab <b>Fach 3</b> gilt ein Wort als <b>gut gelernt</b>.</li>
        <li>Mit <b>Multiple-Choice</b> kommt ein Wort höchstens bis Fach 2. Für „gut gelernt“ musst du es <b>eintippen</b>.</li>
      </ul>
      <table class="info-table">${rows}</table>
      <p class="small">So landen die Wörter im Langzeitgedächtnis. Freies Üben und Durchgehen schieben Wörter nicht weiter.</p>
      <p class="small"><b>Punkte:</b> Eintippen 10 · Multiple-Choice 5 · Durchgehen 1 pro Wort · Runde geschafft +20</p>
      <button class="btn primary big wide" data-action="close-modal">Alles klar</button>`);
  },
};

function listsLabel(lists) {
  if (lists.length === 1) return esc(lists[0].name);
  return `${lists.length} ${lists.every(l => l.book) ? 'Abschnitte' : 'Listen'}`;
}

// ---------- Training ----------
// Entweder aus Listen (fällige + neue Wörter) oder mit fest vorgegebenen Wörtern (unsichere aus dem Durchgehen).
function startSession(lists, { picked = null } = {}) {
  const p = S.activeProfile();
  const pr = p.prefs;
  const valid = lists.map(l => ({ ...l, words: validWords(l) }));
  let practice = false;
  if (!picked) {
    picked = SRS.buildSession(valid, { size: pr.size });
    if (!picked.length) {
      practice = true;
      picked = SRS.buildSession(valid, { practice, size: pr.size });
    }
  }
  if (!picked.length) return toast('Hier gibt es noch keine Wörter.');
  const items = picked.map(({ word, list }) => {
    const dir = pr.direction === 'mix' ? (Math.random() < 0.5 ? 'fx2de' : 'de2fx') : pr.direction;
    let mode = pr.mode === 'auto' ? (word.box >= 2 ? 'type' : 'choice') : pr.mode;
    const answerOf = w => (dir === 'fx2de' ? w.de : w.fx);
    let choices;
    if (mode === 'choice') {
      const correct = answerOf(word);
      const pool = [...new Set([...list.words, ...valid.filter(l => l.lang === list.lang).flatMap(l => l.words)]
        .map(answerOf).filter(x => x && x !== correct))];
      choices = SRS.shuffle([correct, ...SRS.shuffle(pool).slice(0, 3)]);
      if (choices.length < 3) mode = 'type';
    }
    return { word, list, target: word, dir, mode, choices, retry: false, box: word.seen ? word.box : null };
  });
  session = { kind: 'words', items, idx: 0, firstCount: items.length, right: 0, xp: 0, answered: null, practice, listIds: lists.map(l => l.id) };
  go('train');
}

// Puzzle-Kärtchen mischen (möglichst nicht schon in der richtigen Reihenfolge).
function shufflePuzzle(it) {
  let pool = SRS.shuffle(it.tokens);
  for (let i = 0; i < 5 && pool.join(' ') === it.tokens.join(' '); i++) pool = SRS.shuffle(it.tokens);
  return { ...it, pool, placed: [] };
}

// Sätze-Runde: Beispielsätze haben einen eigenen Karteikasten (word.ex.box …).
function startSentences(lists) {
  const pr = S.activeProfile().prefs;
  const owner = new Map();
  const pseudo = lists.map(l => ({ ...l, words: sentenceItems([l]).map(({ word }) => (owner.set(word.ex, word), word.ex)) }));
  let practice = false;
  let picked = SRS.buildSession(pseudo, { size: pr.size });
  if (!picked.length) {
    practice = true;
    picked = SRS.buildSession(pseudo, { practice, size: pr.size });
  }
  if (!picked.length) return toast('Hier gibt es keine Beispielsätze.');
  const items = picked.map(({ word: ex, list }) => {
    const word = owner.get(ex);
    const real = S.getList(list.id);
    const modes = SRS.sentenceModes(ex, word, real.lang);
    const mode = modes.includes(pr.sentenceMode) ? pr.sentenceMode : modes[Math.floor(Math.random() * modes.length)];
    const parts = SRS.sentenceParts(ex, word, real.lang);
    const it = { word, list: real, target: ex, mode, parts, tokens: SRS.sentenceTokens(parts.plain), retry: false, box: ex.seen ? ex.box : null };
    return mode === 'puzzle' ? shufflePuzzle(it) : it;
  });
  session = { kind: 'sentences', items, idx: 0, firstCount: items.length, right: 0, xp: 0, answered: null, practice, listIds: lists.map(l => l.id) };
  go('train');
}

function answer(ok, extra = {}) {
  const it = session.items[session.idx];
  if (!it.retry) {
    if (!session.practice) SRS.grade(it.target, ok, { maxBox: it.mode === 'choice' ? SRS.CHOICE_MAX_BOX : SRS.MAX_BOX });
    if (ok) session.right++;
  }
  if (ok) session.xp += it.retry ? SRS.XP.retry : SRS.XP[it.mode];
  else if (!it.retry) {
    const again = { ...it, retry: true, choices: it.choices && SRS.shuffle(it.choices) };
    session.items.push(it.mode === 'puzzle' ? shufflePuzzle(again) : again);
  }
  session.answered = { ok, ...extra };
  save();
  render();
  const text = it.parts ? it.parts.plain : it.word.fx;
  if ('speechSynthesis' in window) setTimeout(() => speak(text, it.list.lang), 250);
}

function finishSession() {
  const p = S.activeProfile();
  const levelBefore = SRS.levelOf(p.xp);
  const perfect = session.right === session.firstCount && session.firstCount >= 5;
  const xp = session.xp + SRS.XP.finish + (perfect ? SRS.XP.perfect : 0);
  p.xp += xp;
  p.sessions++;
  SRS.touchStreak(p);
  const badges = SRS.earnedBadges(p, S.listsOf(p.id), { perfect });
  save();
  const level = SRS.levelOf(p.xp);
  go('result', {
    right: session.right, total: session.firstCount, accuracy: session.right / session.firstCount,
    xp, level, levelUp: level > levelBefore, streak: SRS.currentStreak(p), badges, listIds: session.listIds, kind: session.kind,
  });
  if (session.right / session.firstCount >= 0.7 || badges.length) confetti();
}

// ---------- Durchgehen (Karteikarten) ----------
// pool = Listen, die im Fenster zur Wahl stehen (Standard: alles Begonnene in der aktuellen Sprache).
function openReviewPicker(selected, pool) {
  const p = S.activeProfile();
  pool ??= [...new Set([...listsInLang(p, currentLang(p)).filter(isStarted).map(l => l.id), ...(selected || [])])];
  pool = pool.filter(id => { const l = S.getList(id); return l && validWords(l).length; });
  if (!pool.length) return toast('Hier gibt es noch nichts zum Durchgehen – fang erst mit Lernen an.');
  let ids = (selected || p.prefs.reviewListIds).filter(id => pool.includes(id));
  if (!ids.length) {
    const newest = pool.map(S.getList).sort((a, b) => b.createdAt - a.createdAt)[0];
    ids = [newest.id];
  }
  openModal({ type: 'review', selected: ids, pool });
}

function startReview(listIds) {
  const p = S.activeProfile();
  const dirPref = p.prefs.reviewDirection;
  const lists = listIds.map(S.getList).filter(Boolean);
  const items = SRS.shuffle(lists.flatMap(list => validWords(list).map(word => ({
    word, list, dir: dirPref === 'mix' ? (Math.random() < 0.5 ? 'fx2de' : 'de2fx') : dirPref,
  }))));
  if (!items.length) return toast('Keine Wörter ausgewählt.');
  review = { items, idx: 0, flipped: false, known: 0, unsure: [], listIds };
  go('review');
}

function finishReview() {
  const p = S.activeProfile();
  const xp = review.items.length * SRS.XP.review;
  p.xp += xp;
  SRS.touchStreak(p);
  const badges = SRS.earnedBadges(p, S.listsOf(p.id));
  save();
  go('review-result', { known: review.known, total: review.items.length, unsure: review.unsure, xp, badges, listIds: review.listIds });
  if (review.known / review.items.length >= 0.8) confetti();
}

// ---------- Aktionen ----------
function cleanEmptyWords(list) {
  if (list) {
    list.words = list.words.filter(w => w.fx.trim() || w.de.trim());
    for (const w of list.words) if (w.ex && !w.ex.fx.trim()) w.ex = null;
  }
  save();
}

// Auswahl im Buch merken (pro Profil und Buch).
function setBookSel(ids) {
  view.sel = ids;
  S.activeProfile().prefs.bookSel[view.id] = ids;
  save();
  render();
}
const bookLists = () => S.listsOf(state.activeProfileId).filter(l => l.book?.id === view.id);
const selectedBookLists = () => bookLists().filter(l => view.sel.includes(l.id)).sort((a, b) => a.book.order - b.book.order);

function openBook(id) {
  const p = S.activeProfile();
  const own = new Set(S.listsOf(p.id).filter(l => l.book?.id === id).map(l => l.id));
  go('book', { id, sel: (p.prefs.bookSel[id] || []).filter(x => own.has(x)) });
}

const ACTIONS = {
  'pick-profile': el => { state.activeProfileId = el.dataset.id; save(); go('home'); },
  'new-profile': () => go('profile-edit', { from: 'profiles' }),
  'edit-profile': el => go('profile-edit', { id: el.dataset.id, from: 'parent' }),
  'edit-own-profile': () => go('profile-edit', { id: state.activeProfileId, from: 'home' }),
  'back-from-profile-edit': () => go(view.from === 'parent' ? 'parent' : view.from === 'home' ? 'home' : 'profiles'),
  'pick-avatar': el => {
    view.avatar = el.dataset.a;
    document.querySelectorAll('.avatar-choice').forEach(b => b.classList.toggle('sel', b === el));
  },
  'switch-profile': () => go('profiles'),
  'back-profiles': () => go('profiles'),
  'back-home': () => { if (view.name === 'list-edit') cleanEmptyWords(S.getList(view.id)); go('home'); },
  'back-list': () => go('list-edit', { id: view.listId }),
  'open-parent': () => go(parentUnlocked ? 'parent' : 'parent-gate'),

  'learn-all': () => {
    const p = S.activeProfile();
    openModal({ type: 'learn', listIds: listsInLang(p, currentLang(p)).filter(isStarted).map(l => l.id) });
  },
  'learn-list': el => { cleanEmptyWords(S.getList(el.dataset.id)); openModal({ type: 'learn', listIds: [el.dataset.id] }); },
  again: () => openModal({ type: view.kind === 'sentences' ? 'sentences' : 'learn', listIds: view.listIds }),
  'set-lang': el => { S.activeProfile().prefs.lang = el.dataset.v; save(); render(); },

  'open-books': () => openModal({ type: 'books' }),
  'add-book': el => {
    const p = S.activeProfile();
    const book = state.books.find(b => b.id === el.dataset.id);
    S.syncBook(p.id, book);
    p.prefs.lang = book.lang;
    save();
    toast(`${book.title} hinzugefügt ✓`);
    openBook(book.id);
  },
  'open-book': el => openBook(el.dataset.id),
  'remove-book': () => {
    const title = bookLists()[0]?.book.title;
    if (!confirm(`„${title}“ aus deinem Profil entfernen? Dein Lernstand in diesem Buch geht dabei verloren.`)) return;
    S.removeBook(state.activeProfileId, view.id);
    go('home');
  },
  'toggle-section': el => {
    const id = el.dataset.id;
    setBookSel(view.sel.includes(id) ? view.sel.filter(x => x !== id) : [...view.sel, id]);
  },
  'toggle-unit': el => {
    const ids = bookLists().filter(l => l.book.unit === el.dataset.unit).map(l => l.id);
    const all = ids.every(id => view.sel.includes(id));
    view.open.add(el.dataset.unit);
    setBookSel(all ? view.sel.filter(x => !ids.includes(x)) : [...new Set([...view.sel, ...ids])]);
  },
  'toggle-open': el => {
    const u = el.dataset.unit;
    view.open.has(u) ? view.open.delete(u) : view.open.add(u);
    render();
  },
  'book-learn': () => openModal({ type: 'learn', listIds: selectedBookLists().map(l => l.id) }),
  'book-sentences': () => openModal({ type: 'sentences', listIds: selectedBookLists().map(l => l.id) }),
  'book-review': () => { const ids = selectedBookLists().map(l => l.id); openReviewPicker(ids, ids); },
  'start-sentences': () => {
    const lists = modal.listIds.map(S.getList).filter(Boolean);
    modal = null;
    save();
    startSentences(lists);
  },
  place: el => {
    const it = session.items[session.idx];
    if (!it.placed.includes(+el.dataset.i)) it.placed.push(+el.dataset.i);
    render();
  },
  unplace: el => {
    session.items[session.idx].placed.splice(+el.dataset.i, 1);
    render();
  },
  'check-puzzle': () => {
    const it = session.items[session.idx];
    const built = it.placed.map(i => it.pool[i]).join(' ');
    answer(built === it.tokens.join(' '));
  },
  'start-learn': () => {
    const m = modal;
    modal = null;
    const lists = m.listIds.map(S.getList).filter(Boolean);
    save();
    if (m.words) startSession(lists, { picked: m.words });
    else startSession(lists);
  },
  'set-pref': el => {
    const k = el.dataset.k;
    S.activeProfile().prefs[k] = k === 'size' ? +el.dataset.v : el.dataset.v;
    render();
  },
  info: () => openModal({ type: 'info' }),
  'close-modal': () => closeModal(),
  backdrop: (el, e) => { if (e.target === el) closeModal(); },

  'review-pick': () => openReviewPicker(),
  'review-list': el => { cleanEmptyWords(S.getList(el.dataset.id)); openReviewPicker([el.dataset.id]); },
  'review-again': () => openReviewPicker(view.listIds),
  'toggle-review-list': el => {
    const id = el.dataset.id;
    modal.selected = modal.selected.includes(id) ? modal.selected.filter(x => x !== id) : [...modal.selected, id];
    render();
  },
  'review-all': () => { modal.selected = [...modal.pool]; render(); },
  'review-none': () => { modal.selected = []; render(); },
  'start-review': () => {
    const p = S.activeProfile();
    const ids = S.listsOf(p.id).map(l => l.id).filter(id => modal.selected.includes(id));
    p.prefs.reviewListIds = ids;
    save();
    startReview(ids);
  },
  flip: () => {
    review.flipped = true;
    render();
    const it = review.items[review.idx];
    if (it.dir === 'de2fx') speak(it.word.fx, it.list.lang);
  },
  'review-answer': el => {
    const it = review.items[review.idx];
    if (el.dataset.ok === '1') review.known++;
    else {
      SRS.markUnsure(it.word);
      review.unsure.push(it);
    }
    review.idx++;
    review.flipped = false;
    if (review.idx >= review.items.length) finishReview(); else render();
  },
  'quit-review': () => {
    if (review.idx > 0 && !confirm('Durchgehen abbrechen?')) return;
    S.activeProfile().xp += review.idx * SRS.XP.review;
    save();
    go('home');
  },
  'practice-unsure': () => {
    const listIds = [...new Set(view.unsure.map(x => x.list.id))];
    openModal({ type: 'learn', listIds, words: view.unsure });
  },

  'new-list': () => {
    const p = S.activeProfile();
    const own = S.listsOf(p.id).filter(l => !l.book);
    const l = S.newList(p.id, `Liste ${own.length + 1}`, currentLang(p) || 'en');
    state.lists.push(l);
    l.words.push(S.newWord('', ''));
    save();
    go('list-edit', { id: l.id });
  },
  'edit-list': el => go('list-edit', { id: el.dataset.id }),
  'add-word': () => {
    const l = S.getList(view.id);
    l.words.push(S.newWord('', ''));
    save();
    render();
    const rows = document.querySelectorAll('.word-row');
    rows[rows.length - 1]?.querySelector('input')?.focus();
  },
  'del-word': el => {
    const l = S.getList(view.id);
    l.words = l.words.filter(w => w.id !== el.dataset.id);
    save();
    render();
  },
  'speak-word': el => {
    const l = S.getList(view.id);
    const w = l.words.find(x => x.id === el.dataset.id);
    if (w?.fx) speak(w.fx, l.lang);
  },
  'delete-list': () => {
    const l = S.getList(view.id);
    if (!confirm(`Liste „${l.name}“ mit ${l.words.length} Wörtern wirklich löschen?`)) return;
    state.lists = state.lists.filter(x => x.id !== l.id);
    save();
    go('home');
  },

  scan: el => go('scan', { listId: el.dataset.list || null, images: [], status: 'idle', error: '' }),
  'del-photo': el => { view.images.splice(+el.dataset.i, 1); render(); },
  'scan-reset': () => go('scan', { listId: view.listId, images: [], status: 'idle', error: '' }),
  'scan-run': async () => {
    const s = view;
    s.status = 'loading';
    s.error = '';
    render();
    try {
      const result = await extractVocab(state.settings.apiKey, s.images);
      if (view !== s) return; // inzwischen weggeklickt
      if (!result.words.length) throw new Error('Auf den Fotos wurden keine Vokabeln gefunden.');
      result.words.forEach(w => (w.use = true));
      const p = S.activeProfile();
      const lists = S.listsOf(p.id).filter(l => !l.book);
      const target = s.listId || 'new';
      Object.assign(s, {
        status: 'review', result, target,
        newName: result.title || `Liste ${lists.length + 1}`,
        lang: result.language === 'fr' ? 'fr' : 'en',
      });
    } catch (e) {
      if (view !== s) return;
      s.status = 'idle';
      s.error = e.message;
    }
    render();
  },
  'scan-save': () => {
    const s = view;
    const p = S.activeProfile();
    let list = s.target === 'new' ? null : S.getList(s.target);
    if (!list) {
      list = S.newList(p.id, s.newName || 'Neue Liste', s.lang);
      state.lists.push(list);
    }
    const words = s.result.words.filter(w => w.use && w.fx.trim() && w.de.trim());
    list.words.push(...words.map(w => S.newWord(w.fx, w.de, w.note, { ex: { fx: w.example || '', de: w.example_de || '' } })));
    if (!p.badges.includes('scanner')) p.badges.push('scanner');
    save();
    toast(`${words.length} Vokabeln gespeichert ✓`);
    go('list-edit', { id: list.id });
  },

  choose: el => {
    const it = session.items[session.idx];
    const i = +el.dataset.i;
    const expected = it.dir === 'fx2de' ? it.word.de : it.word.fx;
    answer(it.choices[i] === expected, { chosen: i });
  },
  'dont-know': () => answer(false, { input: '' }),
  next: () => {
    session.idx++;
    session.answered = null;
    if (session.idx >= session.items.length) finishSession(); else render();
  },
  'quit-train': () => {
    if (session.idx === 0 && !session.answered) return go('home');
    if (!confirm('Runde wirklich abbrechen? Bisher Gelerntes bleibt gespeichert.')) return;
    S.activeProfile().xp += session.xp;
    save();
    go('home');
  },
  speak: el => speak(el.dataset.text, el.dataset.lang),

  'save-key': () => {
    const v = document.getElementById('apikey').value.trim();
    if (!v) return toast('Bitte einen Schlüssel eingeben.');
    state.settings.apiKey = v;
    save();
    render();
    toast('Schlüssel gespeichert');
  },
  'clear-key': () => {
    if (!confirm('API-Schlüssel entfernen?')) return;
    state.settings.apiKey = '';
    save();
    render();
  },
  'test-key': async () => {
    const out = document.getElementById('key-status');
    out.textContent = 'Prüfe …';
    try { out.textContent = await testKey(state.settings.apiKey); } catch (e) { out.textContent = '⚠️ ' + e.message; }
  },
  'delete-profile': el => {
    const p = state.profiles.find(x => x.id === el.dataset.id);
    if (!confirm(`Profil „${p.name}“ mit allen Listen und dem Lernstand wirklich löschen?`)) return;
    S.deleteProfile(p.id);
    render();
  },
  export: () => {
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vokabeltrainer-sicherung-${SRS.todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};

const SUBMITS = {
  'save-profile': form => {
    const name = form.name.value.trim();
    if (!name) return;
    let p = state.profiles.find(x => x.id === view.id);
    if (!p) {
      p = S.newProfile(name, view.avatar);
      state.profiles.push(p);
      state.activeProfileId = p.id;
    }
    Object.assign(p, { name, avatar: view.avatar });
    save();
    go(view.from === 'parent' ? 'parent' : 'home');
  },
  'type-answer': form => {
    const input = form.answer.value;
    if (!input.trim()) return;
    const it = session.items[session.idx];
    const expected = it.dir === 'fx2de' ? it.word.de : it.word.fx;
    const ansLang = it.dir === 'fx2de' ? 'de' : it.list.lang;
    const r = SRS.checkAnswer(input, expected, ansLang);
    answer(r.ok, { input, hint: r.hint, close: r.close });
  },
  'gap-answer': form => {
    const input = form.answer.value;
    if (!input.trim()) return;
    const it = session.items[session.idx];
    const r = SRS.checkAnswer(input, it.parts.gap, it.list.lang);
    answer(r.ok, { input, hint: r.hint, close: r.close });
  },
  'parent-gate': form => {
    if (+form.r.value === view.a * view.b) { parentUnlocked = true; go('parent'); }
    else { toast('Leider falsch'); view.a = view.b = undefined; render(); }
  },
};

const CHANGES = {
  'add-photos': async input => {
    const s = view;
    const files = [...input.files];
    input.value = '';
    for (const f of files) {
      try { s.images.push(await prepareImage(f)); } catch (e) { s.error = e.message; }
    }
    if (view === s) render();
  },
  import: async input => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (S.isBookFile(JSON.parse(text))) {
        const book = S.importBook(text);
        toast(`Buch „${book.title}“ gespeichert ✓`);
        return render();
      }
      if (!confirm('Achtung: Die Sicherung ersetzt alle aktuellen Daten auf diesem Gerät. Fortfahren?')) return;
      S.importJSON(text);
      toast('Sicherung geladen ✓');
      render();
    } catch (e) {
      alert('Import fehlgeschlagen: ' + e.message);
    }
  },
  'import-book': async input => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const book = S.importBook(await file.text());
      toast(`Buch „${book.title}“ geladen ✓`);
      render();
    } catch (e) {
      alert('Das hat nicht geklappt: ' + (e instanceof SyntaxError ? 'Die Datei ist keine Buch-Datei.' : e.message));
    }
  },
};

// ---------- Ereignisse ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.preventDefault();
  ACTIONS[el.dataset.action]?.(el, e);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-submit]');
  if (!form) return;
  e.preventDefault();
  SUBMITS[form.dataset.submit]?.(form);
});

let saveTimer;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); };

document.addEventListener('input', e => {
  const t = e.target;
  if ((t.dataset.field || t.dataset.exfield) && view.name === 'list-edit') {
    const w = S.getList(view.id)?.words.find(x => x.id === t.closest('[data-wid]').dataset.wid);
    if (!w) return;
    if (t.dataset.field) w[t.dataset.field] = t.value;
    else {
      w.ex ??= { fx: '', de: '', box: 0, due: 0, seen: false, right: 0, wrong: 0 };
      w.ex[t.dataset.exfield] = t.value;
    }
    saveSoon();
  } else if (t.dataset.listField && view.name === 'list-edit') {
    S.getList(view.id)[t.dataset.listField] = t.value;
    saveSoon();
    if (t.dataset.listField === 'lang') render();
  } else if (t.dataset.rfield && view.name === 'scan') {
    const w = view.result.words[+t.closest('[data-ri]').dataset.ri];
    if (t.type === 'checkbox') {
      w.use = t.checked;
      render();
    } else w[t.dataset.rfield] = t.value;
  } else if (t.dataset.sfield && view.name === 'scan') {
    view[t.dataset.sfield] = t.value;
    if (t.dataset.sfield === 'target') render();
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.change) CHANGES[t.dataset.change]?.(t);
});

// Enter in der Wortliste springt zum nächsten Feld bzw. legt ein neues Wort an.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modal) return closeModal();
  if (e.key !== 'Enter' || view.name !== 'list-edit' || !e.target.dataset.field) return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('.words input[data-field="fx"], .words input[data-field="de"]')];
  const i = inputs.indexOf(e.target);
  if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus(); else ACTIONS['add-word']();
});

// ---------- Start ----------
S.load();
if (S.activeProfile()) view = { name: 'home' };
render();
if ('speechSynthesis' in window) speechSynthesis.getVoices();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
