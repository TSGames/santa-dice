# Backlog: Umbau zum Adventskalender

Fachliche Spezifikation (Soll-Stand). Technische Leitplanken stehen in [CLAUDE.md](CLAUDE.md).

## Ziel

Das bestehende Würfeltool wird zu einem Adventskalender umgebaut. Hinter jedem Türchen wird ausgewürfelt, wer den Preis dahinter gewinnt. Die gewinnende Person wählt anschließend aus, was ins nächste Türchen kommt.

## Rollen

| Rolle | Darf |
|---|---|
| Teilnehmende | sich bei geöffneten, noch nicht ausgewürfelten Türchen eintragen, würfeln, Ergebnisse und geöffnete Türchen ansehen |
| Gewinner\*in eines Türchens | zusätzlich den Preis für das nächste Türchen aus der Preisliste auswählen |
| Admin | Runden abschließen, Gewinner\*in markieren, Stechen starten, Preis freigeben, Preisliste pflegen, im Notfall den nächsten Preis selbst zuordnen |

## Kalender

- 24 Türchen (1.–24. Dezember).
- Türchen mit einem Datum bis einschließlich heute lassen sich öffnen. Künftige Türchen sind gesperrt.
- Solange ein geöffnetes Türchen noch nicht ausgewürfelt ist, kann dort weiter eingetragen und gewürfelt werden, auch nach seinem Kalendertag.
- Die Anordnung der Türchen ist bei jedem Aufruf zufällig. Farbe und Motiv gehören fest zur Türchen-Nummer.
- Design: nach der Design-Vorlage `docs/design-adventskalender.png` (Farben, Motive je Türchen, Titel, Untertitel, Fußzeile).
- Ein ausgewürfeltes Türchen zeigt das Ergebnis: Gewinner\*in und Würfe, nach der Freigabe auch den Preis.

## Ablauf pro Türchen

1. **Eintragen:** Wer mitmachen möchte, trägt sich bei einem geöffneten, noch nicht ausgewürfelten Türchen ein.
2. **Würfeln:** Eingetragene Personen würfeln einmal mit zwei Würfeln. Gewertet wird die Augensumme.
3. **Auswerten:** Sobald alle gewürfelt haben oder der Admin die Runde schließt:
   - Höchste Summe eindeutig → Admin markiert die Person als Gewinner\*in.
   - Mehrere Personen mit der höchsten Summe → Admin startet ein **Stechen**.
4. **Stechen:** Nur die Personen mit der höchsten Summe der vorherigen Runde würfeln erneut. Bei erneutem Gleichstand startet der Admin ein weiteres Stechen, bis jemand allein vorne liegt. Alle Runden bleiben sichtbar.
5. **Preis freigeben:** Bis dahin bleibt der Preis verborgen (verpacktes Geschenk). Erst wenn der Admin ihn nach Würfeln und Festlegen der Gewinner\*in freigibt, wird er animiert enthüllt und groß angezeigt, mit Bild, Beschreibung und Link.
6. **Nächstes Türchen befüllen:** Nach der Freigabe wählt die Gewinner\*in aus den verfügbaren Einträgen der Preisliste den Preis für das nächste Türchen.

## Preisliste (Befüll-Backend)

- Zentrale Liste, gepflegt vom Admin.
- Jeder Eintrag ist ein **Preis** mit Bild, Beschreibung und Link. Ob der Link zu einem Shop oder zu einem lustigen Video führt, spielt für das Tool keine Rolle: Alle Einträge werden gleich behandelt und angezeigt.
- Bilder werden direkt im Admin hochgeladen (kein externes Hosting nötig).
- Richtwert für die Befüllung: mindestens die Hälfte der Einträge sollen kleine Sachpreise sein. Darauf achtet der Admin; das Tool prüft es nicht.
- Jeder Eintrag kann nur einmal vergeben werden. Sobald er einem Türchen zugeordnet ist, verschwindet er aus der Auswahl.
- Budget: Richtwert ca. 10 € pro Preis. Über Ausnahmen und das Gesamtbudget entscheidet der Admin beim Erfassen. Das Tool prüft hier nichts.

## Entscheidungen

- **Ende der Teilnahme:** Der Admin schließt eine Runde manuell. Wer bis dahin nicht gewürfelt hat, scheidet für dieses Türchen aus.
- **Keine Auswahl durch Gewinner\*in:** Hat die Gewinner\*in keinen Preis für das nächste Türchen gewählt, ordnet der Admin selbst zu.
- **Erstes Türchen:** Der Admin ordnet den Preis für Türchen 1 direkt zu.
- **Spät ausgewürfelte Türchen:** Wird ein Türchen erst nach seinem Kalendertag ausgewürfelt (z. B. Türchen 5 am 8.), wählt die Gewinner\*in den Preis für das nächste Türchen, das noch keinen Preis hat.
- **Mehrfachgewinne:** erlaubt, keine Einschränkung.
- **Art der Preise:** Alle Einträge werden gleich behandelt (Bild, Beschreibung, Link), egal ob Sachpreis oder Video-Link.
- **Offene Türchen:** Ein Türchen mit Datum bis heute bleibt zum Eintragen und Würfeln offen, bis es eine Gewinner\*in hat.

## Nicht im Umfang

- Login und Benutzerkonten für Teilnehmende (Name per Eingabe wie bisher).
- Mehrere Kalender parallel.
- Bezahlung, Versand oder Budgetverwaltung im Tool.
