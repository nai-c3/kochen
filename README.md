# Unser Kochbuch

Rezeptsammlung für die Familie, fürs Handy gebaut.

**Live:** https://claude.ai/artifact/2Y8NmixVbWCLp7tWfsxDRw

## Funktionen
- Rezepte nach Zutat filtern („Alles mit Hähnchen“), nach Name oder Kategorie suchen
- Herzhaft / Süß und Kategorien (#nudeln, #schnell …)
- Zufallsgericht-Würfel; er beachtet die aktiven Filter und lässt kürzlich Gekochtes aus
- Portionen umrechnen, Zutaten und Schritte beim Kochen abhaken, Bildschirm bleibt an
- Neue Rezepte per KI aus Foto, Screenshot oder Text, oder von Hand eintragen

## Technik
`index.html` ist der Quelltext der Claude-Artifact-Seite. Er läuft nur auf claude.ai, denn
Speicher (`db`), Nutzerrechte (`user`) und die KI-Erkennung (`sample`) stellt dort die
Artifact-Laufzeit bereit. Die Datei hier ist die Sicherungskopie des Quelltexts.
Die Rezepte selbst liegen in der Datenbank des Artifacts, nicht in diesem Repo.
