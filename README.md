# Unser Kochbuch

Rezeptsammlung für die Familie, als installierbare Web-App fürs Handy.

**Adresse:** https://nai-c3.github.io/kochen/ (nach der Einrichtung, siehe [SETUP.md](SETUP.md))

## Funktionen
- Rezepte nach Zutat filtern („Alles mit Hähnchen“), nach Name oder Kategorie suchen
- Herzhaft / Süß und Kategorien (#nudeln, #schnell …)
- Zufallsgericht-Würfel; er beachtet die aktiven Filter und lässt kürzlich Gekochtes aus
- Portionen umrechnen, Zutaten und Schritte beim Kochen abhaken, Bildschirm bleibt an
- Neue Rezepte per KI aus Foto, Screenshot, Text oder Link; oder von Hand eintragen
- Gemeinsames Familien-Passwort, Rezepte auch offline lesbar
- Sichern und Importieren aller Rezepte als Datei

## Aufbau
| Teil | Wo | Datei |
|---|---|---|
| Seite (statisch) | GitHub Pages | `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/` |
| Zugangsdaten der Web-App | im Repo | `firebase-config.js` |
| Rezepte und Fotos | Firebase Firestore | Regeln in `firestore.rules` |
| Anmeldung | Firebase Authentication | ein Konto `familie@kochbuch.example` |
| KI-Erkennung und Link-Import | Firebase Cloud Function `recognizeRecipe` (Frankfurt) | `functions/index.js` |

Die Funktion ruft bei Links die Seite selbst ab und liest die strukturierten Rezeptdaten (schema.org) und das Vorschaubild. Blockiert eine Seite den Abruf, holt Claude sie über das Web-Fetch-Werkzeug. Der Claude-API-Schlüssel liegt als Firebase-Secret auf dem Server.

## Datenmodell
- `recipes/{id}`: title, kind (herzhaft|süß), servings, time, tags[], ingredients[{a,u,n} | {h:true,n}], steps[], note, source, thumb, hasPhoto, createdAt, updatedAt, lastCooked, cookCount
- `photos/{id}`: src (JPEG als Data-URL)

## Design
Gestaltet nach dem Design-System „Linkedin-Niklas“: Farbfelder in Ultramarin, Sonnengelb und Violett, Versal-Grotesk (PP Agrandir, Ersatz Unbounded) und Young Serif Light (SIL OFL, `fonts/OFL.txt`).

## Frühere Version
`artifact/kochbuch-artifact.html` ist die erste Fassung als Claude-Artifact (läuft nur auf claude.ai).
