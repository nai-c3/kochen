# Einrichtung: Unser Kochbuch auf GitHub Pages

Die Seite selbst liegt auf GitHub Pages. Die Rezepte liegen in Firebase (Google), die KI-Erkennung läuft über eine kleine Firebase-Funktion mit deinem Claude-API-Schlüssel. Einmal einrichten dauert etwa 30 Minuten. Alles passiert im Browser, du musst nichts installieren.

## 1. Firebase-Projekt anlegen

1. Öffne https://console.firebase.google.com und melde dich mit deinem Google-Konto an.
2. **Projekt erstellen**, Name z. B. `unser-kochbuch`. Google Analytics brauchst du nicht.
3. Links unten auf **Upgrade** und den Tarif **Blaze** wählen. Das ist nötig, weil die KI-Funktion sonst nicht läuft. Für eine Familie bleibt die Nutzung im kostenlosen Kontingent. Lege beim Upgrade ein **Budget-Limit** fest, z. B. 5 €, damit du bei Überschreitung eine E-Mail bekommst.

## 2. Datenbank anlegen

1. Links **Build → Firestore Database → Datenbank erstellen**.
2. Standort **europe-west3 (Frankfurt)**, Modus **Produktion**.
3. Die Sicherheitsregeln spielst du in Schritt 6 automatisch ein.

## 3. Familien-Passwort anlegen

1. Links **Build → Authentication → Jetzt starten**.
2. Unter **Anmeldemethode** den Anbieter **E-Mail-Adresse/Passwort** aktivieren und speichern.
3. Unter **Nutzer → Nutzer hinzufügen**:
   - E-Mail: `familie@kochbuch.example` (genau so, sie ist nur ein interner Name, es geht nie eine Mail raus)
   - Passwort: euer Familien-Passwort (mindestens 6 Zeichen)
4. Unter **Einstellungen → Nutzeraktionen** das Häkchen bei **Erstellen (Registrierung) aktivieren** entfernen. So kann sich niemand ein eigenes Konto anlegen.
5. Unter **Einstellungen → Autorisierte Domains** die Domain `nai-c3.github.io` hinzufügen.

## 4. Web-App registrieren und Daten eintragen

1. Zahnrad oben links → **Projekteinstellungen → Allgemein → Meine Apps → Web (`</>`)**.
2. Name `Kochbuch`, Firebase Hosting **nicht** anhaken, **App registrieren**.
3. Es erscheint ein Block `const firebaseConfig = { ... }`. Übertrage die sechs Werte in die Datei [`firebase-config.js`](firebase-config.js) dieses Repos (auf GitHub die Datei öffnen, Stift-Symbol, Werte ersetzen, **Commit changes**).

Diese Werte sind nicht geheim, sie stehen bei jeder Firebase-Web-App im Browser. Geschützt sind die Daten durch das Passwort und die Sicherheitsregeln.

## 5. Claude-API-Schlüssel besorgen

1. Öffne https://console.anthropic.com und melde dich an.
2. **Billing**: etwas Guthaben aufladen, z. B. 5 $. Ein erkanntes Rezept kostet je nach Fotoanzahl etwa 2 bis 5 Cent.
3. **API Keys → Create Key**, Name `kochbuch`. Kopiere den Schlüssel (beginnt mit `sk-ant-`). Er wird nur einmal angezeigt.

## 6. KI-Funktion und Sicherheitsregeln hochladen (Google Cloud Shell)

1. Öffne https://shell.cloud.google.com und melde dich mit demselben Google-Konto an. Es öffnet sich ein Terminal im Browser.
2. Kopiere die folgenden Befehle einzeln hinein. Ersetze `DEINE-PROJEKT-ID` durch die Projekt-ID aus Schritt 4 (steht auch in `firebase-config.js` bei `projectId`).

```bash
git clone -b claude/great-maxwell-h7wbct https://github.com/nai-c3/kochen.git
cd kochen
npm --prefix functions install
npx -y firebase-tools@15 login --no-localhost
```

Der Login zeigt einen Link. Öffne ihn, bestätige mit deinem Google-Konto und kopiere den angezeigten Code zurück ins Terminal.

```bash
npx -y firebase-tools@15 functions:secrets:set ANTHROPIC_API_KEY --project DEINE-PROJEKT-ID
```

Füge den Claude-API-Schlüssel ein, wenn danach gefragt wird (er wird beim Tippen nicht angezeigt), und drücke Enter.

```bash
npx -y firebase-tools@15 deploy --only functions,firestore:rules --project DEINE-PROJEKT-ID
```

Das dauert beim ersten Mal 3 bis 5 Minuten. Fragt das Tool, ob es Google-Dienste aktivieren darf, bestätige mit `y`. Am Ende steht `Deploy complete!`.

## 7. GitHub Pages einschalten

1. Auf GitHub im Repo `nai-c3/kochen` **Settings → Pages**.
2. **Source: Deploy from a branch**, Branch `claude/great-maxwell-h7wbct`, Ordner `/ (root)`, **Save**.
3. Nach 1 bis 2 Minuten ist die Seite erreichbar unter **https://nai-c3.github.io/kochen/**.

## 8. Aufs Handy holen

1. Die Adresse auf dem Handy öffnen und das Familien-Passwort eingeben (einmal pro Gerät).
2. **iPhone (Safari):** Teilen-Symbol → **Zum Home-Bildschirm**.
   **Android (Chrome):** Menü ⋮ → **App installieren** oder **Zum Startbildschirm hinzufügen**.

Danach öffnet sich das Kochbuch wie eine App, im Vollbild mit eigenem Symbol. Gespeicherte Rezepte lassen sich auch ohne Internet ansehen.

## 9. Rezepte von der Claude-Seite übernehmen

In der App oben rechts auf **⋯ → Rezepte aus Datei importieren** und die Sicherungsdatei wählen.

## Später ändern

- **Passwort ändern:** Firebase Console → Authentication → Nutzer → `familie@kochbuch.example` → Passwort zurücksetzen. Danach müssen sich alle neu anmelden.
- **Neuer API-Schlüssel:** Befehl aus Schritt 6 (`functions:secrets:set`) erneut ausführen, danach den `deploy`-Befehl.
- **Kosten im Blick:** Claude-Nutzung unter console.anthropic.com → Usage, Firebase unter Nutzung und Abrechnung.
