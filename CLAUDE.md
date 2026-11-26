# CLAUDE.md

Technische Leitplanken für dieses Projekt. Die fachliche Spezifikation des laufenden Umbaus zum Adventskalender steht in [Backlog.md](Backlog.md). Sie ist die Quelle für Abläufe und Regeln.

## Grundregeln

- UI-Texte, Spezifikation und Doku auf Deutsch. Code-Bezeichner und Commit-Messages auf Englisch.
- Keine Personennamen in Backlog, Doku, Kommentare oder Commits. Rollen verwenden (Admin, Teilnehmende, Gewinner\*in).
- Personenbezogene Testdaten nur mit Fantasienamen in `dev/seed.json`.

## Stack

- Frontend: Angular 15 + Angular Material, Hash-Routing (`/#/`, `/#/tuer/:day`, `/#/admin`).
  - `ApiService`: alle API-Aufrufe, Polling des Kalenders (2 s), Name und Admin-Token im `localStorage`.
  - `CalendarComponent`, `DoorComponent`, `AdminComponent`: die drei Seiten.
  - `DieComponent`: 3D-Würfel (wiederverwenden), `SnowComponent`: Schnee als Canvas außerhalb der Change Detection.
- Backend: eine Datei `src/api.php`, Daten als JSON in `DATA_DIR` (Default `.`, im Docker-Image `/data`), Schreibzugriffe mit `flock`.
- Deployment: `Dockerfile` (php:8.3-apache), GitHub Actions (`.github/workflows/docker.yml`) pusht das Image nach ghcr.io.

## Lokale Entwicklung

```sh
npm run backend        # PHP-Backend auf :8081, src/api.php live gemountet
npm start              # ng serve auf :4200, Proxy /api.php → :8081
npm run backend:seed   # Testdaten aus dev/seed.json + dev/uploads/ laden
npm run backend:reset  # Backend stoppen und Daten-Volume löschen
```

Das Dev-Backend setzt „heute“ fest auf `2026-12-08` (`FAKE_TODAY`, überschreibbar: `FAKE_TODAY=2026-12-15 npm run backend`) und nutzt das Admin-Token `dev` (Admin-Bereich: `/#/admin`).

`dev/seed.json` deckt alle Türchen-Zustände ab (entschieden und freigegeben, nach Stechen entschieden, Gewinner*in fest aber Preis noch nicht freigegeben (Türchen 3), Gleichstand, eindeutig wartend, laufend, heute, gesperrt). Bei Änderungen am Datenmodell mitpflegen.

`ng build` baut standardmäßig für Production. Nur dieser Build kopiert `api.php` nach `dist/`.

## Zielarchitektur Adventskalender

### Datenmodell (`DATA_DIR`)

```
data.json
{
  "items": [
    { "id": "…", "title": "…", "description": "…",
      "link": "https://…", "image": "uploads/<id>.jpg", "assignedDay": 5 | null }
  ],
  "settings": { "openUntil": 5 | null },
  "days": {
    "5": {
      "itemId": "…" | null,
      "participants": ["…"],
      "rounds": [ { "players": ["…"], "rolls": { "<name>": [3, 6] } } ],
      "closed": false,
      "winner": "…" | null,
      "revealed": false,
      "nextPickedBy": "…" | null
    }
  }
}
uploads/<id>.<ext>
```

Beim Umbau den alten Datenstand (flache Liste `[{name, number}]`) nicht migrieren. Neues Format ab leerer Datei.

### API (`api.php?action=…`)

| Aktion | Wer | Zweck |
|---|---|---|
| `calendar` | alle | Tage mit Status, bis heute inkl. Preis und Ergebnis, künftige ohne Preis |
| `join` | alle | bei einem geöffneten, noch nicht ausgewürfelten Türchen eintragen |
| `roll` | eingetragene | in der aktuellen Runde würfeln (Server würfelt) |
| `pick` | Gewinner\*in | Eintrag fürs nächste Türchen zuordnen |
| `open-until` | Admin | geöffnete Türchen manuell festlegen (`value` 0–24), `null` = nach Datum |
| `close`, `winner`, `tiebreak`, `reveal`, `day-reset` | Admin | Runde schließen, Gewinner\*in setzen, Stechen starten, Preis freigeben, Türchen zurücksetzen |
| `items`, `item-save`, `item-delete`, `upload`, `assign` | Admin | Preisliste pflegen, Bild hochladen, Preis manuell zuordnen |

Schreibende Aktionen per POST.

### Regeln, die der Server erzwingt (nicht nur das Frontend)

- Geöffnet sind die Türchen bis zum Datum, oder bis zum Wert, den der Admin per `open-until` festgelegt hat.
- `join`/`roll` sind für jedes Türchen mit Datum ≤ heute offen, solange es keine Gewinner\*in hat. Datum kommt vom Server, nicht vom Client.
- Pro Runde ein Wurf pro Person. Würfeln nur für Spieler\*innen der aktuellen Runde.
- `winner` nur bei eindeutiger Höchstsumme, `tiebreak` nur bei Gleichstand. Die neue Runde enthält nur die Gleichstehenden.
- Ein Eintrag kann nur einem Türchen zugeordnet werden. `pick` nur durch die Gewinner\*in eines Türchens, einmal pro Gewinn, für das nächste Türchen ohne Preis.
- Künftige Türchen liefern keinen Preis aus. Offene Türchen liefern den Preis erst nach `reveal` aus (Admin bekommt vorher `preview`).
- `reveal` nur mit Gewinner\*in, `pick` erst nach `reveal`.
- Alle Einträge sind gleichartig (Bild, Beschreibung, Link). Keine Typunterscheidung zwischen Sachpreis und Video o. Ä.
- Admin-Aktionen erfordern ein Token aus der Umgebungsvariable `ADMIN_TOKEN` (Header). Der bisherige Mechanismus „Name = Admin“ entfällt.
- Uploads: nur Bildtypen (jpeg, png, webp, gif), Größenlimit, Dateiname serverseitig aus der ID, nie aus dem Upload.

### Frontend

- Kalenderansicht mit 24 Türchen nach `docs/design-adventskalender.png`. `DoorTileComponent` hält Farbe und Motiv je Türchen. Reihenfolge bei jedem Aufruf zufällig, stabil während die Seite offen ist.
- Farben und Schriften als CSS-Variablen in `src/styles.scss` (inkl. Material-Theme), keine Farbwerte direkt in Komponenten.
- Türchen-Detail: Eintragen, Würfeln (bestehender Flow mit `DieComponent`), Rundenübersicht inkl. Stechen, verpacktes Geschenk bis zur Freigabe, Enthüllungs-Animation nur bei live beobachteter Freigabe.
- Admin-Bereich als eigene Route `/admin` (Token-Eingabe, Speicherung im `localStorage`).
- Listen immer mit `trackBy` rendern und abgeleitete Daten nur bei neuen Server-Daten berechnen (nicht in Gettern, die neue Objekte erzeugen), sonst baut `*ngFor` DOM und Würfel ständig neu auf.
