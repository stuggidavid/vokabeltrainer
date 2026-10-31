# Vokabeltrainer

Eine Web-App für iPad und iPhone zum Vokabellernen (Englisch und Französisch). Sie wird über Safari auf den Home-Bildschirm gelegt und läuft dann wie eine App, ganz ohne App Store.

## Funktionen

- **Profile** für jedes Kind, mit eigenem Lernstand, Punkten, Level und Abzeichen. Name und Bild ändern die Kinder selbst über ✏️.
- **Karteikasten** mit 6 Fächern: Richtige Wörter wandern ein Fach weiter und kommen erst nach 1, 2, 4, 8 bzw. 16 Tagen wieder dran. Falsche Wörter gehen zurück in Fach 0 und werden in derselben Runde noch einmal abgefragt. Ab Fach 3 gilt ein Wort als „gut gelernt“.
- **Vor jeder Runde** wählt man Richtung, Abfrage-Art und Rundengröße (5/10/20). Die letzte Wahl ist voreingestellt.
  - **Automatisch:** neue Wörter per Multiple-Choice, ab Fach 2 zum Eintippen
  - **Multiple-Choice:** bringt Wörter höchstens bis Fach 2 (5 Punkte)
  - **Eintippen:** bringt Wörter bis Fach 5 (10 Punkte), nur so werden sie „gut gelernt“
- **🃏 Schnell durchgehen:** Karteikarten aus frei wählbaren Listen umdrehen und selbst bewerten. Wörter steigen dadurch nicht auf. „Wusste ich nicht“ macht ein Wort sofort fällig, und am Ende lassen sich die unsicheren Wörter direkt üben (1 Punkt pro Wort).
- **Bücher:** Eine Buch-Datei (`.json`) bringt den Vokabelteil eines Schulbuchs mit, gegliedert in Unités und Abschnitte (A1, B2 … mit Seitenzahl). Sonderkästen wie „Auf einen Blick“, Konjugationen und Wortfamilien sind eigene ★-Abschnitte. Im Buch kreuzt man an, was geübt wird. Buch-Dateien liegen im Ordner `buecher/` und kommen wegen des Urheberrechts nicht ins öffentliche Repository. Eine neue Version derselben Datei aktualisiert das Buch, der Lernstand bleibt erhalten.
- **✍️ Sätze üben:** Beispielsätze aus dem Buch als Lückensatz (fehlendes Wort in der richtigen Form eintippen) oder als Satz-Puzzle (Kärtchen in die richtige Reihenfolge bringen). Sätze haben einen eigenen Karteikasten. Nach jeder Vokabel zeigt die App den Beispielsatz und liest ihn vor.
- **Nachsichtige Prüfung:** Groß-/Kleinschreibung, „to“ und deutsche Artikel sind egal. Fehlende französische Akzente oder Artikel zählen als richtig, die App zeigt aber einen Hinweis. Mehrere Bedeutungen („sich erinnern, behalten“) werden alle akzeptiert.
- **Vorlesen** der Fremdwörter (Sprachausgabe des Geräts)
- **Foto-Import:** Die App liest Vokabelseiten aus dem Schulbuch mit der Claude API aus. Das Ergebnis lässt sich vor dem Speichern prüfen und korrigieren.
- **Offline nutzbar** (außer dem Foto-Import). Alle Daten bleiben auf dem Gerät.
- **Eltern-Bereich** mit Rechenaufgabe als Kindersperre: API-Schlüssel, Profile verwalten, Sicherung exportieren und importieren.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `css/style.css` | Grundgerüst und Design |
| `js/app.js` | Bildschirme und Bedienung |
| `js/srs.js` | Lernlogik: Karteikasten, Antwortprüfung, Punkte, Abzeichen |
| `js/scan.js` | Foto-Import über die Claude API |
| `js/store.js` | Speichern im Gerät (localStorage) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installierbarkeit und Offline-Betrieb |
| `tools/make_icons.py` | Erzeugt die Icons neu |

## Lokal testen (am PC)

```bash
python -m http.server 8000
```

Dann <http://localhost:8000> im Browser öffnen.

## Auf iPad/iPhone bringen

Das iPad braucht die App unter einer **https-Adresse**, sonst funktioniert die Installation auf dem Home-Bildschirm nicht richtig. Am einfachsten und kostenlos geht das mit **GitHub Pages**:

1. Bei <https://github.com> ein Konto anlegen und ein neues Repository erstellen, z. B. `vokabeltrainer`.
2. Alle Dateien dieses Ordners hochladen (außer `.claude/`).
3. Im Repository unter **Settings → Pages** als Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)` wählen.
4. Nach ca. 1 Minute ist die App unter `https://<benutzername>.github.io/vokabeltrainer/` erreichbar.
5. Diese Adresse auf dem iPad in **Safari** öffnen, dann **Teilen → „Zum Home-Bildschirm“** antippen.

Alternativ geht Netlify Drop (<https://app.netlify.com/drop>): einfach den Ordner ins Browserfenster ziehen.

**Updates:** Nach Änderungen an der App die Versionsnummer in `sw.js` (`vokabeltrainer-v1` → `-v2`) erhöhen und neu hochladen. Die Geräte laden die neue Version beim nächsten Start.

## Foto-Import einrichten

1. Auf <https://console.anthropic.com> ein Konto anlegen, etwas Guthaben aufladen und unter **API Keys** einen Schlüssel erzeugen.
2. **Empfehlung:** Dort unter *Limits* ein niedriges monatliches Ausgabelimit setzen (z. B. 5 €).
3. In der App auf ⚙️ tippen, die Rechenaufgabe lösen und den Schlüssel eintragen. Mit „Testen“ lässt er sich prüfen.

Verwendet wird das Modell `claude-opus-5-5`. Ein Foto kostet grob ein paar Cent. Der Schlüssel wird nur auf dem jeweiligen Gerät gespeichert und nicht in Sicherungen exportiert. Er lässt sich jederzeit in der Konsole widerrufen.

Bei Ablehnungen leitet die Claude API die Anfrage automatisch an ein Ersatzmodell weiter (`fallbacks: "default"`). Bei Vokabelfotos sollte das praktisch nie nötig sein.

## Wichtig zu wissen

- Die Daten liegen **nur auf dem einen Gerät**. Am besten ab und zu im Eltern-Bereich eine Sicherung exportieren, z. B. nach iCloud Drive.
- Wird die App vom Home-Bildschirm gelöscht, sind auch die Daten weg (vorher exportieren!).
