// Speichert alle Daten (Profile, Listen, Lernstand) lokal im Gerät.
const KEY = 'vokabeltrainer.v1';

function defaults() {
  return { version: 1, settings: { apiKey: '' }, profiles: [], lists: [], books: [], activeProfileId: null };
}

export const state = defaults();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(state, defaults(), JSON.parse(raw));
  } catch (e) {
    console.error('Laden fehlgeschlagen', e);
  }
  state.profiles.forEach(migrateProfile);
  // Bittet den Browser, die Daten nicht automatisch zu löschen.
  try { navigator.storage?.persist?.(); } catch {}
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
    alert('Speichern hat nicht geklappt. Ist der Gerätespeicher voll?');
    return false;
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const freshProgress = () => ({ box: 0, due: 0, seen: false, right: 0, wrong: 0 });

// ex = Beispielsatz { fx, de } mit eigenem Karteikasten-Fortschritt, tip = Merk-Tipp aus dem Buch.
export function newWord(fx, de, note = '', { ex = null, tip = '' } = {}) {
  return {
    id: uid(), fx: fx.trim(), de: de.trim(), note: note.trim(), tip, ...freshProgress(),
    ex: ex?.fx ? { fx: ex.fx.trim(), de: (ex.de || '').trim(), ...freshProgress() } : null,
  };
}

const defaultPrefs = () => ({
  direction: 'mix', mode: 'auto', size: 10, reviewDirection: 'mix', reviewListIds: [],
  lang: '', sentenceMode: 'mix', bookSel: {},
});

export function newProfile(name, avatar) {
  return {
    id: uid(), name: name.trim(), avatar, prefs: defaultPrefs(),
    xp: 0, streak: { count: 0, lastDay: '' }, badges: [], sessions: 0, createdAt: Date.now(),
  };
}

// Ältere Profile hatten mode/direction direkt am Profil – in die Rundeneinstellungen übernehmen.
function migrateProfile(p) {
  if (!p.prefs) {
    p.prefs = { ...defaultPrefs(), direction: p.direction || 'mix', mode: p.mode || 'auto' };
    delete p.mode;
    delete p.direction;
  }
  p.prefs = { ...defaultPrefs(), ...p.prefs };
}

export function newList(profileId, name, lang) {
  return { id: uid(), profileId, name: name.trim(), lang, createdAt: Date.now(), words: [] };
}

export const activeProfile = () => state.profiles.find(p => p.id === state.activeProfileId) || null;
export const listsOf = profileId => state.lists.filter(l => l.profileId === profileId);
export const getList = id => state.lists.find(l => l.id === id);

export function deleteProfile(id) {
  state.profiles = state.profiles.filter(p => p.id !== id);
  state.lists = state.lists.filter(l => l.profileId !== id);
  if (state.activeProfileId === id) state.activeProfileId = null;
  save();
}

// ---------- Bücher ----------
// Eine Buch-Datei liegt einmal im Gerät (state.books). Jedes Profil, das das Buch nutzt,
// bekommt pro Abschnitt eine eigene Liste mit eigenem Lernstand (list.book verweist auf den Abschnitt).
export const isBookFile = data => data?.type === 'vokabeltrainer-buch';

export function importBook(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  if (!isBookFile(data) || !data.id || !Array.isArray(data.units)) throw new Error('Keine gültige Buch-Datei');
  const old = state.books.findIndex(b => b.id === data.id);
  if (old >= 0) state.books[old] = data; else state.books.push(data);
  // Profile, die das Buch schon haben, bekommen Korrekturen und neue Unités – ihr Lernstand bleibt.
  for (const p of state.profiles) if (hasBook(p.id, data.id)) syncBook(p.id, data);
  save();
  return data;
}

export const hasBook = (profileId, bookId) => listsOf(profileId).some(l => l.book?.id === bookId);

export function syncBook(profileId, book) {
  const keep = new Set();
  let order = 0;
  for (const unit of book.units) {
    for (const sec of unit.sections) {
      let list = listsOf(profileId).find(l => l.book?.id === book.id && l.book.unit === unit.id && l.book.section === sec.id);
      if (!list) {
        list = newList(profileId, '', book.lang);
        state.lists.push(list);
      }
      keep.add(list.id);
      list.name = `${unit.title.split(' · ')[0]} · ${sec.name || sec.id}`;
      list.lang = book.lang;
      list.book = {
        id: book.id, title: book.title, unit: unit.id, unitTitle: unit.title,
        section: sec.id, name: sec.name || sec.id, page: sec.page || null, pageEnd: sec.pageEnd || null,
        extra: !!sec.extra, order: order++,
      };
      const bySrc = new Map(list.words.map(w => [w.src, w]));
      list.words = sec.words.map(src => {
        const key = src.id || src.fx;
        const ex = src.ex ? { fx: src.ex[0], de: src.ex[1] || '' } : null;
        const w = bySrc.get(key) || newWord(src.fx, src.de, '', { ex });
        Object.assign(w, { src: key, fx: src.fx, de: src.de, note: src.note || '', tip: src.tip || '' });
        if (!ex) w.ex = null;
        else if (w.ex) Object.assign(w.ex, ex);
        else w.ex = { ...ex, ...freshProgress() };
        return w;
      });
    }
  }
  state.lists = state.lists.filter(l => l.profileId !== profileId || l.book?.id !== book.id || keep.has(l.id));
}

export function removeBook(profileId, bookId) {
  state.lists = state.lists.filter(l => l.profileId !== profileId || l.book?.id !== bookId);
  save();
}

export function exportJSON() {
  const { apiKey, ...settings } = state.settings; // API-Schlüssel nicht mit exportieren
  return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (isBookFile(data)) return importBook(data);
  if (!Array.isArray(data.profiles) || !Array.isArray(data.lists)) throw new Error('Keine gültige Sicherungsdatei');
  const apiKey = state.settings.apiKey;
  Object.assign(state, defaults(), data);
  state.settings = { ...state.settings, apiKey };
  state.profiles.forEach(migrateProfile);
  save();
}
