// Lernlogik: Karteikasten (Leitner), Antwortprüfung, Punkte und Abzeichen.
export const DAY = 86400000;
// Fach 0 = neu/falsch, Fach 5 = sitzt. Tage bis zur nächsten Abfrage:
export const INTERVALS = [0, 1, 2, 4, 8, 16];
export const MAX_BOX = INTERVALS.length - 1;

const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const todayKey = (t = Date.now()) => new Date(t).toLocaleDateString('sv'); // JJJJ-MM-TT

export const isDue = (w, now = Date.now()) => w.seen && w.due <= now;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Erst fällige Wörter (schwächstes Fach zuerst), dann mit neuen Wörtern auffüllen.
export function buildSession(lists, { size = 10, practice = false } = {}) {
  const all = lists.flatMap(list => list.words.map(word => ({ word, list })));
  if (practice) return shuffle(all).slice(0, size);
  const now = Date.now();
  const due = all.filter(x => isDue(x.word, now)).sort((a, b) => a.word.box - b.word.box || a.word.due - b.word.due);
  const fresh = all.filter(x => !x.word.seen);
  return shuffle([...due.slice(0, size), ...fresh.slice(0, Math.max(0, size - due.length))]);
}

// Mit Multiple-Choice steigt ein Wort höchstens bis hierhin. „Gut gelernt“ (ab Fach 3) gibt es nur durch Eintippen.
export const CHOICE_MAX_BOX = 2;
export const SOLID_BOX = 3;

export function grade(word, correct, { maxBox = MAX_BOX } = {}) {
  word.seen = true;
  if (correct) {
    word.right++;
    if (word.box < maxBox) word.box++;
    word.due = startOfDay() + INTERVALS[word.box] * DAY;
  } else {
    word.wrong++;
    word.box = 0;
    word.due = Date.now();
  }
}

// Beim Durchgehen: „Wusste ich nicht“ macht das Wort sofort fällig, das Fach bleibt.
export function markUnsure(word) {
  if (word.seen) word.due = Math.min(word.due, Date.now());
}

// ---------- Antwortprüfung ----------
const ARTICLES = {
  en: /^(to|the|a|an) /,
  de: /^(der|die|das|den|dem|ein|eine|einen|sich) /,
  fr: /^(le |la |les |un |une |des |l'|se |s')/,
};

const clean = s => s.toLowerCase().normalize('NFC')
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/[’`´]/g, "'")
  .replace(/[.!?¡¿;:"«»…]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const noAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const noArticle = (s, lang) => (ARTICLES[lang] ? s.replace(ARTICLES[lang], '') : s).trim();

export function alternatives(expected) {
  return expected.split(/[,;/]/).map(clean).filter(Boolean);
}

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Ergebnis: { ok, hint: 'accent'|'article'|null, close }
export function checkAnswer(input, expected, lang) {
  const inp = clean(input);
  if (!inp) return { ok: false, hint: null, close: false };
  let close = false;
  for (const alt of alternatives(expected)) {
    if (inp === alt) return { ok: true, hint: null };
    const a = noArticle(alt, lang), i = noArticle(inp, lang);
    if (a === i) return { ok: true, hint: lang === 'fr' && a !== alt && i === inp ? 'article' : null };
    // Fehlende Akzente (é, è, ç …) zählen mit Hinweis als richtig, Umlaute im Deutschen nicht (schon ≠ schön).
    if (lang !== 'de' && noAccents(a) === noAccents(i)) return { ok: true, hint: 'accent' };
    if (a.length >= 4 && levenshtein(noAccents(a), noAccents(i)) <= 1) close = true;
  }
  return { ok: false, hint: null, close };
}

// ---------- Punkte, Level, Serie ----------
export const XP = { type: 10, choice: 5, retry: 3, finish: 20, perfect: 20, review: 1 };

// Für Level L braucht man insgesamt 50·L·(L−1) Punkte.
export const levelOf = xp => Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2);
export const xpForLevel = L => 50 * L * (L - 1);

export function touchStreak(profile) {
  const today = todayKey();
  if (profile.streak.lastDay === today) return;
  const yesterday = todayKey(Date.now() - DAY);
  profile.streak.count = profile.streak.lastDay === yesterday ? profile.streak.count + 1 : 1;
  profile.streak.lastDay = today;
}

export function currentStreak(profile) {
  const { lastDay, count } = profile.streak;
  return lastDay === todayKey() || lastDay === todayKey(Date.now() - DAY) ? count : 0;
}

export const BADGES = {
  first:    { icon: '🎉', name: 'Erste Runde',  text: 'Die erste Lernrunde geschafft' },
  perfect:  { icon: '💯', name: 'Fehlerfrei',   text: 'Eine Runde ohne Fehler' },
  streak3:  { icon: '🔥', name: '3 Tage',       text: '3 Tage hintereinander gelernt' },
  streak7:  { icon: '🌟', name: '7 Tage',       text: 'Eine ganze Woche am Stück' },
  streak30: { icon: '🏆', name: '30 Tage',      text: 'Einen Monat lang jeden Tag' },
  words50:  { icon: '🧠', name: '50 gelernt',   text: '50 Wörter gut gelernt (Fach 3 oder höher)' },
  words200: { icon: '📚', name: '200 gelernt',  text: '200 Wörter gut gelernt (Fach 3 oder höher)' },
  scanner:  { icon: '📷', name: 'Fotograf',     text: 'Vokabeln per Foto importiert' },
  level5:   { icon: '🚀', name: 'Level 5',      text: 'Level 5 erreicht' },
  level10:  { icon: '👑', name: 'Level 10',     text: 'Level 10 erreicht' },
};

export function earnedBadges(profile, lists, { perfect = false } = {}) {
  const solid = lists.reduce((n, l) => n + l.words.filter(w => w.box >= SOLID_BOX).length, 0);
  const s = currentStreak(profile), L = levelOf(profile.xp);
  const checks = {
    first: profile.sessions >= 1, perfect, streak3: s >= 3, streak7: s >= 7, streak30: s >= 30,
    words50: solid >= 50, words200: solid >= 200, level5: L >= 5, level10: L >= 10,
  };
  const fresh = Object.keys(checks).filter(k => checks[k] && !profile.badges.includes(k));
  profile.badges.push(...fresh);
  return fresh;
}
