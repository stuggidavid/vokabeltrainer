// Foto-Import: Bilder verkleinern und mit Claude die Vokabeln herauslesen.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.134.0/+esm';
const MODEL = 'claude-opus-5-5';

let sdk;
async function loadSdk() {
  try {
    sdk ??= (await import(SDK_URL)).default;
  } catch (e) {
    console.error(e);
    throw new Error('Keine Verbindung zum Internet. Für den Foto-Import wird Internet gebraucht.');
  }
  return sdk;
}

async function client(apiKey) {
  const Anthropic = await loadSdk();
  // Die App läuft nur im Browser auf eurem eigenen Gerät, daher der direkte Zugriff.
  return { Anthropic, api: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
}

// Verkleinert ein Foto auf max. 1600 px (spart Kosten, reicht zum Lesen) und liefert JPEG-Base64.
export function prepareImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      resolve({ preview: dataUrl, media_type: 'image/jpeg', data: dataUrl.split(',')[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht geöffnet werden.')); };
    img.src = url;
  });
}

const SYSTEM = `Du liest Vokabeln aus Fotos von Schulbuchseiten (Englisch oder Französisch für deutschsprachige Schulkinder).
Übertrage jede Vokabel als Paar aus Fremdwort ("fx") und deutscher Bedeutung ("de").
- Lautschrift weglassen. Beispielsätze nur übernehmen, wenn sie die einzige Übersetzung sind.
- Französische Nomen mit Artikel (le/la/l'/les), bei l'/les das Geschlecht als Notiz, z. B. "m." oder "f.".
- Englische Verben so wie im Buch (meist mit "to").
- Mehrere deutsche Bedeutungen mit Komma trennen.
- Kurze Zusatzinfos (Plural, unregelmäßige Formen, "AE/BE") kommen in "note", sonst leerer Text.
- Wörter, die über einen Seitenrand oder ein Foto hinweg abgeschnitten sind, nur übernehmen, wenn sie eindeutig lesbar sind.
- Reihenfolge wie im Buch. Keine Vokabeln erfinden.
"title" ist die Überschrift der Lektion/Unit, falls sichtbar (z. B. "Unit 3 – Station 1"), sonst leer.`;

const SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', enum: ['en', 'fr', 'other'] },
    title: { type: 'string' },
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: { fx: { type: 'string' }, de: { type: 'string' }, note: { type: 'string' } },
        required: ['fx', 'de', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['language', 'title', 'words'],
  additionalProperties: false,
};

export async function extractVocab(apiKey, images) {
  if (!apiKey) throw new Error('Es ist noch kein API-Schlüssel eingetragen (Eltern-Bereich).');
  const { Anthropic, api } = await client(apiKey);
  let response;
  try {
    response = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
          { type: 'text', text: images.length > 1 ? 'Hier sind mehrere Seiten. Lies alle Vokabeln heraus.' : 'Lies alle Vokabeln heraus.' },
        ],
      }],
    });
  } catch (e) {
    throw new Error(friendlyError(Anthropic, e));
  }
  if (response.stop_reason === 'refusal') throw new Error('Die KI hat dieses Bild nicht verarbeitet. Bitte ein anderes Foto versuchen.');
  if (response.stop_reason === 'max_tokens') throw new Error('Zu viele Vokabeln auf einmal. Bitte weniger Seiten pro Foto-Import.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let result;
  try { result = JSON.parse(text); } catch { throw new Error('Die Antwort konnte nicht gelesen werden. Bitte nochmal versuchen.'); }
  result.words = result.words.filter(w => w.fx.trim() && w.de.trim());
  return result;
}

// Prüft den Schlüssel ohne Kosten (Modell-Info abrufen).
export async function testKey(apiKey) {
  const { Anthropic, api } = await client(apiKey);
  try {
    await api.models.retrieve(MODEL);
    return 'Der Schlüssel funktioniert ✓';
  } catch (e) {
    throw new Error(friendlyError(Anthropic, e));
  }
}

function friendlyError(Anthropic, e) {
  console.error(e);
  if (e instanceof Anthropic.AuthenticationError) return 'Der API-Schlüssel ist ungültig. Bitte im Eltern-Bereich prüfen.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Der API-Schlüssel hat keine Berechtigung. Ist Guthaben auf dem Konto?';
  if (e instanceof Anthropic.RateLimitError) return 'Gerade zu viele Anfragen. Bitte kurz warten und nochmal versuchen.';
  if (e instanceof Anthropic.BadRequestError) return 'Die Anfrage wurde abgelehnt: ' + (e.message || 'unbekannter Fehler');
  // Bei ungültigem Schlüssel blockiert der Browser die Fehlerantwort (CORS), daher sieht das wie ein Verbindungsfehler aus.
  if (e instanceof Anthropic.APIConnectionError) return navigator.onLine
    ? 'Keine Verbindung zum KI-Dienst. Bitte den API-Schlüssel im Eltern-Bereich prüfen.'
    : 'Keine Verbindung zum Internet.';
  if (e instanceof Anthropic.APIError) return 'Der KI-Dienst hat einen Fehler gemeldet. Bitte später nochmal versuchen.';
  return e?.message || 'Unbekannter Fehler';
}
