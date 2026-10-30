import * as S from './store.js';
import { state, save } from './store.js';
import * as SRS from './srs.js';
import { prepareImage, extractVocab, testKey } from './scan.js';

const $app = document.getElementById('app');
const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🦁', '🐨', '🐧', '🐬', '🦖', '🐝', '🚀', '⚽', '🎸', '🌈'];
const LANGS = {
  en: { flag: '🇬🇧', name: 'Englisch', voice: 'en-GB' },
  fr: { flag: '🇫🇷', name: 'Französisch', voice: 'fr-FR' },
  de: { flag: '🇩🇪', name: 'Deutsch', voice: 'de-DE' },
};
const MODES = { auto: 'Automatisch (empfohlen)', choice: 'Immer Auswahl', type: 'Immer eintippen' };
const DIRECTIONS = { mix: 'Gemischt', fx2de: 'Fremdsprache → Deutsch', de2fx: 'Deutsch → Fremdsprache' };
const BOX_COLORS = ['var(--box0)', 'var(--box1)', 'var(--box2)', 'var(--box3)', 'var(--box4)', 'var(--box5)'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let view = { name: 'profiles' };
let session = null;
let parentUnlocked = false;

function go(name, params = {}) {
  view = { name, ...params };
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (view.name !== 'profiles' && view.name !== 'parent-gate' && view.name !== 'parent'
      && view.name !== 'profile-edit' && !S.activeProfile()) view = { name: 'profiles' };
  $app.innerHTML = VIEWS[view.name]();
  AFTER[view.name]?.();
}

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

function profileStats(p) {
  const lists = S.listsOf(p.id);
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
        <label>Abfrage-Art<select name="mode">${Object.entries(MODES).map(([k, t]) => `<option value="${k}" ${k === (p?.mode || 'auto') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <p class="small">Automatisch: neue Wörter mit Auswahl-Antworten, gut gelernte Wörter zum Eintippen.</p>
        <label>Richtung<select name="direction">${Object.entries(DIRECTIONS).map(([k, t]) => `<option value="${k}" ${k === (p?.direction || 'mix') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn primary big" type="submit">Speichern</button>
      </form>`;
  },

  home() {
    const p = S.activeProfile();
    const st = profileStats(p);
    const L = SRS.levelOf(p.xp);
    const pct = Math.round(100 * (p.xp - SRS.xpForLevel(L)) / (SRS.xpForLevel(L + 1) - SRS.xpForLevel(L)));
    const streak = SRS.currentStreak(p);
    const todo = st.due + st.fresh;
    const lists = st.lists.slice().sort((a, b) => b.createdAt - a.createdAt).map(l => {
      const valid = l.words.filter(w => w.fx && w.de);
      return `
      <div class="list-card">
        <button class="list-main" data-action="edit-list" data-id="${l.id}">
          <span class="flag">${LANGS[l.lang]?.flag || '🏳️'}</span>
          <span class="list-info"><b>${esc(l.name)}</b><small>${valid.length} Wörter · ${valid.filter(w => w.box >= 3).length} sitzen</small>${boxBar(l.words)}</span>
        </button>
        <button class="btn small" data-action="learn-list" data-id="${l.id}" ${valid.length ? '' : 'disabled'}>Lernen</button>
      </div>`;
    }).join('');
    return `
      <header class="top">
        <button class="icon-btn avatar-btn" data-action="switch-profile" aria-label="Profil wechseln">${p.avatar}</button>
        <div class="who"><b>${esc(p.name)}</b><small>Level ${L} · ${p.xp} Punkte</small><div class="xpbar"><span style="width:${pct}%"></span></div></div>
        <div class="streak ${streak ? 'on' : ''}" title="Tage am Stück">🔥 ${streak}</div>
      </header>

      <section class="card hero">
        ${st.total === 0
          ? `<h2>Noch keine Vokabeln</h2><p>Fotografiere eine Vokabelseite aus deinem Schulbuch oder lege eine Liste an.</p>
             <button class="btn primary big" data-action="scan">📷 Vokabeln fotografieren</button>`
          : todo > 0
            ? `<h2>Heute dran: ${todo} ${todo === 1 ? 'Wort' : 'Wörter'}</h2>
               <p>${st.due} zum Wiederholen · ${st.fresh} neu</p>
               <button class="btn primary big" data-action="learn-all">Los geht's! 🚀</button>`
            : `<h2>Alles erledigt für heute! 🎉</h2><p>Du kannst trotzdem frei üben.</p>
               <button class="btn primary big" data-action="practice-all">Freies Üben</button>`}
      </section>

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
      <p class="legend">Karteikasten: ${BOX_COLORS.map((c, i) => `<span><i style="background:${c}"></i>${i}</span>`).join('')}<span><i style="background:var(--unseen)"></i>neu</span></p>`;
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
      const lists = S.listsOf(p.id);
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
          ${it.word.note ? `<p class="small">ℹ️ ${esc(it.word.note)}</p>` : ''}
          <button class="btn primary big" data-action="next" id="next">Weiter →</button>
        </div>`;
    }

    return `
      <header class="top train-top">
        <button class="icon-btn" data-action="quit-train" aria-label="Beenden">✕</button>
        <div class="progress"><span style="width:${Math.round(100 * (session.idx + (a ? 1 : 0)) / total)}%"></span></div>
        <span class="count">${Math.min(session.idx + 1, total)}/${total}</span>
      </header>
      ${session.practice ? '<p class="small center">Freies Üben – zählt nicht für den Karteikasten</p>' : ''}
      <section class="card quiz">
        <div class="q-head"><span class="flag">${LANGS[it.list.lang]?.flag || ''}</span><span class="small">${question}</span>
          ${it.retry ? '<span class="tag">nochmal</span>' : `<span class="tag box">${it.box === null ? 'neu' : `Fach ${it.box}`}</span>`}</div>
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
            <span class="grow"><b>${esc(p.name)}</b><small>${S.listsOf(p.id).length} Listen · Level ${SRS.levelOf(p.xp)}</small></span>
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

const PRAISE = ['Richtig! 🎉', 'Super! ⭐', 'Klasse! 💪', 'Genau! ✅', 'Stark! 🚀', 'Perfekt! 🌟'];
const pickPraise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];

const AFTER = {
  train() {
    if (session.answered) document.getElementById('next')?.focus();
    else document.getElementById('answer')?.focus();
  },
};

// ---------- Training ----------
function startSession(lists, { practice = false } = {}) {
  const p = S.activeProfile();
  const valid = lists.map(l => ({ ...l, words: l.words.filter(w => w.fx && w.de) }));
  let picked = SRS.buildSession(valid, { practice });
  if (!picked.length) {
    practice = true;
    picked = SRS.buildSession(valid, { practice, size: 15 });
  }
  if (!picked.length) return toast('Hier gibt es noch keine Wörter.');
  const items = picked.map(({ word, list }) => {
    const dir = p.direction === 'mix' ? (Math.random() < 0.5 ? 'fx2de' : 'de2fx') : p.direction;
    let mode = p.mode === 'auto' ? (word.box >= 2 ? 'type' : 'choice') : p.mode;
    const answerOf = w => (dir === 'fx2de' ? w.de : w.fx);
    let choices;
    if (mode === 'choice') {
      const correct = answerOf(word);
      const pool = [...new Set([...list.words, ...valid.filter(l => l.lang === list.lang).flatMap(l => l.words)]
        .map(answerOf).filter(x => x && x !== correct))];
      choices = SRS.shuffle([correct, ...SRS.shuffle(pool).slice(0, 3)]);
      if (choices.length < 3) mode = 'type';
    }
    return { word, list, dir, mode, choices, retry: false, box: word.seen ? word.box : null };
  });
  session = { items, idx: 0, firstCount: items.length, right: 0, xp: 0, answered: null, practice, listIds: lists.map(l => l.id) };
  go('train');
}

function answer(ok, extra = {}) {
  const it = session.items[session.idx];
  if (!it.retry) {
    if (!session.practice) SRS.grade(it.word, ok);
    if (ok) session.right++;
  }
  if (ok) session.xp += it.retry ? SRS.XP.retry : SRS.XP.right;
  else if (!it.retry) session.items.push({ ...it, retry: true, choices: it.choices && SRS.shuffle(it.choices) });
  session.answered = { ok, ...extra };
  save();
  render();
  const fx = it.word.fx;
  if ('speechSynthesis' in window) setTimeout(() => speak(fx, it.list.lang), 250);
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
    xp, level, levelUp: level > levelBefore, streak: SRS.currentStreak(p), badges, listIds: session.listIds,
  });
  if (session.right / session.firstCount >= 0.7 || badges.length) confetti();
}

// ---------- Aktionen ----------
function cleanEmptyWords(list) {
  if (list) list.words = list.words.filter(w => w.fx.trim() || w.de.trim());
  save();
}

const ACTIONS = {
  'pick-profile': el => { state.activeProfileId = el.dataset.id; save(); go('home'); },
  'new-profile': () => go('profile-edit', { from: 'profiles' }),
  'edit-profile': el => go('profile-edit', { id: el.dataset.id, from: 'parent' }),
  'back-from-profile-edit': () => go(view.from === 'parent' ? 'parent' : 'profiles'),
  'pick-avatar': el => {
    view.avatar = el.dataset.a;
    document.querySelectorAll('.avatar-choice').forEach(b => b.classList.toggle('sel', b === el));
  },
  'switch-profile': () => go('profiles'),
  'back-profiles': () => go('profiles'),
  'back-home': () => { if (view.name === 'list-edit') cleanEmptyWords(S.getList(view.id)); go('home'); },
  'back-list': () => go('list-edit', { id: view.listId }),
  'open-parent': () => go(parentUnlocked ? 'parent' : 'parent-gate'),

  'learn-all': () => startSession(S.listsOf(state.activeProfileId)),
  'practice-all': () => startSession(S.listsOf(state.activeProfileId), { practice: true }),
  'learn-list': el => { const l = S.getList(el.dataset.id); cleanEmptyWords(l); startSession([l]); },
  again: () => startSession(view.listIds.map(S.getList).filter(Boolean)),

  'new-list': () => {
    const p = S.activeProfile();
    const last = S.listsOf(p.id).at(-1);
    const l = S.newList(p.id, `Liste ${S.listsOf(p.id).length + 1}`, last?.lang || 'en');
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
      const lists = S.listsOf(p.id);
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
    list.words.push(...words.map(w => S.newWord(w.fx, w.de, w.note)));
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
    Object.assign(p, { name, avatar: view.avatar, mode: form.mode.value, direction: form.direction.value });
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
    if (!confirm('Achtung: Die Sicherung ersetzt alle aktuellen Daten auf diesem Gerät. Fortfahren?')) return;
    try {
      S.importJSON(await file.text());
      toast('Sicherung geladen ✓');
      render();
    } catch (e) {
      alert('Import fehlgeschlagen: ' + e.message);
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
  if (t.dataset.field && view.name === 'list-edit') {
    const w = S.getList(view.id)?.words.find(x => x.id === t.closest('[data-wid]').dataset.wid);
    if (w) { w[t.dataset.field] = t.value; saveSoon(); }
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
