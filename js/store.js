// Speichert alle Daten (Profile, Listen, Lernstand) lokal im Gerät.
const KEY = 'vokabeltrainer.v1';

function defaults() {
  return { version: 1, settings: { apiKey: '' }, profiles: [], lists: [], activeProfileId: null };
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

export function newWord(fx, de, note = '') {
  return { id: uid(), fx: fx.trim(), de: de.trim(), note: note.trim(), box: 0, due: 0, seen: false, right: 0, wrong: 0 };
}

const defaultPrefs = () => ({ direction: 'mix', mode: 'auto', size: 10, reviewDirection: 'mix', reviewListIds: [] });

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

export function exportJSON() {
  const { apiKey, ...settings } = state.settings; // API-Schlüssel nicht mit exportieren
  return JSON.stringify({ ...state, settings, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.profiles) || !Array.isArray(data.lists)) throw new Error('Keine gültige Sicherungsdatei');
  const apiKey = state.settings.apiKey;
  Object.assign(state, defaults(), data);
  state.settings = { ...state.settings, apiKey };
  state.profiles.forEach(migrateProfile);
  save();
}
