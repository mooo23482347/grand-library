# The Grand Library

Eine digitale Privatbibliothek im Stil einer historischen europäischen Bibliothek: eine Halle mit Türen zu thematischen Räumen, eigene Bücherregale je Raum, verschachtelte Sammlungen, ein Reader für EPUB, PDF und eigene Manuskripte und ein Wissensarchiv (das *Scriptorium*), in dem Notizen, Zusammenfassungen, Gedanken und Zitate mit Büchern, Kapiteln, Textstellen und Räumen verknüpft sind.

Läuft auf dem Windows-PC (Browser) und auf dem iPhone (als Web-App auf dem Home-Bildschirm). Laufende Kosten: **0 €**.

---

## Starten (PC, lokal)

Es wird nichts installiert. Die App besteht aus HTML, CSS und JavaScript-Modulen ohne Build-Schritt.

Im Projektordner:

```bash
jwebserver -J-Djdk.net.unixdomain.tmpdir=C:/temp -p 4173 -b 127.0.0.1 -d "%CD%"
```

Dann `http://127.0.0.1:4173` öffnen. (`jwebserver` gehört zum JDK ab Version 18; jeder andere statische Webserver geht auch.)

Ohne Sync liegt die Bibliothek nur im Browser dieses Geräts. Sicherung: *Curator's Office → Backup*.

---

## Aufbau

| Bereich | Wo | Was |
|---|---|---|
| Halle | `#/` | Alle Räume als Türen, Lesepult (zuletzt gelesen), Scriptorium, Rückgabetisch |
| Raum | `#/room/<raum>` | Verzeichnis der Sammlungen, ein Bücherschrank je Sammlung |
| Sammlung | `#/room/<raum>/<sammlung>` | Eigenes Regal plus Unter-Sammlungen |
| Katalogkarte | `?doc=<id>` an jeder Adresse | Standorte, Tags, Notizen, Kapitel, Lesezeichen, Bemerkungen |
| Reader | `#/read/<id>` | EPUB, PDF, Manuskripte; Markierungen, Notizen, Suche, Fortschritt |
| Scriptorium | `#/scriptorium` | Wissensarchiv mit Verknüpfungen und `[[Links]]` |
| Ledger | `#/catalogue` | Tabellarische Verwaltung, Mehrfachauswahl, Sortierung, Filter |
| Suche | `#/search?q=` | Gesamte Bibliothek inkl. Volltext |
| Office | `#/settings` | Sync, Speicher, Backup, Tags |

### Dokumenttypen und ihre Einbände

| Einband | Typen |
|---|---|
| Leder mit Bünden und Goldprägung | Bücher |
| Gebundene Fachzeitschrift mit Papierschild | Paper, Artikel, Zeitschriften, Studien, Reviews |
| Marmorierter Ordner mit Messing-Schild und Griffloch | Vorlesungsskripte, Lernmaterial, Aufgaben, Präsentationen, Prüfungszusammenfassungen |
| Notizbuch mit Band | Notizbücher, philosophische Gedanken, Zusammenfassungen, Zitatsammlungen |
| Pergament mit Schnur | Manuskripte, eigene Theorien |
| Leinen | Sonstiges |

---

## Datenmodell

Lokal in IndexedDB (Dexie), Schema in [js/db.js](js/db.js), Logik in [js/store.js](js/store.js).

| Tabelle | Inhalt |
|---|---|
| `departments` | Räume (Name, Motto, Emblem, Lederfarbe, Reihenfolge) |
| `collections` | Sammlungen, beliebig verschachtelt über `parentId` |
| `documents` | Jedes Dokument **genau einmal** (Metadaten, Typ, Format, Inhaltsverzeichnis, Verweis auf Datei und Cover) |
| `assignments` | Standorte: Dokument ↔ Raum/Sammlung. Ein Dokument kann viele haben |
| `tags`, `documentTags` | Schlagwörter |
| `notes` | Scriptorium: Notiz, Zusammenfassung, Gedanke, Theorie, Zitat; verknüpft mit Dokument, Kapitel, Markierung, Raum, Sammlung |
| `highlights` | Markierungen (EPUB: Zeichen-Offsets je Kapitel; PDF: Rechtecke je Seite) |
| `bookmarks`, `progress` | Lesezeichen, Lesefortschritt |
| `texts` | Text eigener Manuskripte (Markdown) |
| `files`, `covers` | Dateien, Schlüssel = SHA-256 → identische Datei wird nie doppelt gespeichert |
| `fulltext` | Volltext je Kapitel/Seite für die Suche (nur lokal, wird je Gerät erzeugt) |
| `outbox` | Änderungen, die noch zur Cloud müssen |

Regeln, die der Code garantiert:

- **Verschieben** ändert nur Standorte, nie das Dokument.
- **Sammlung löschen**: Dokumente und Unter-Sammlungen rücken eine Ebene nach oben.
- **Raum schließen**: Dokumente, die nur dort standen, warten auf dem *Rückgabetisch* (`#/unshelved`). Nichts wird gelöscht.
- **Dokument löschen**: Notizen dazu bleiben im Scriptorium (Titel der Quelle wird gemerkt).
- **Migrationen**: neue Schema-Version in `db.js` mit `.upgrade()`; Datenmigrationen in `DATA_MIGRATIONS`. Die Cloud-Tabelle ist generisch und braucht für neue Felder keine Migration.

---

## Kostenlos bleiben: Grenzen des Gratis-Tarifs

| Dienst | Gratis-Grenze | Was die App tut |
|---|---|---|
| Supabase Storage | 1 GB Dateien, 50 MB pro Datei | Warnt ab 85 %, behält zu große bzw. überzählige Dateien nur lokal und sagt das an. Kein Upgrade |
| Supabase Datenbank | 500 MB | Speichert nur Metadaten und Notizen (Volltext bleibt lokal). Füllstand im Office |
| Supabase Pausierung | Projekt pausiert nach 7 Tagen ohne Nutzung | App meldet „Sync server cannot be reached" mit Anleitung zum Wiederherstellen |
| GitHub Pages | 1 GB Website, öffentlich | Nur der App-Code liegt dort, keine Bücher und keine Notizen |

Es wird nirgends eine Kreditkarte hinterlegt.

---

## Einrichtung von Sync und iPhone

1. **Supabase-Projekt** (kostenlos): Projekt anlegen, `supabase/schema.sql` im SQL Editor ausführen, unter *Authentication → Users → Add user* einen Benutzer mit E-Mail und Passwort anlegen (*Auto Confirm* an), unter *Authentication → Sign In / Providers* „Allow new users to sign up" ausschalten.
2. **Projekt-URL und anon key** (Supabase → *Project Settings → Data API* bzw. *API Keys*) in `config.js` eintragen. Beide Werte sind öffentlich; geschützt wird über Anmeldung und Row Level Security.
3. **GitHub Pages**: Repository `grand-library` anlegen, Inhalt dieses Ordners hochladen, *Settings → Pages → Deploy from branch → main / root*.
4. **iPhone**: Adresse `https://<name>.github.io/grand-library/` in Safari öffnen → Teilen → *Zum Home-Bildschirm*. Im Office anmelden.

---

## Technik

- Keine Build-Tools. Bibliotheken mit festen Versionen von jsDelivr: Dexie 4.0.8, pdf.js 4.10.38, JSZip 3.10.1, supabase-js 2.45.4.
- Service Worker (`sw.js`) macht die App offline-fähig.
- EPUB-Kapitel werden über eine Allow-List neu aufgebaut: Skripte, Styles, Formulare und Event-Handler aus Büchern erreichen die Seite nie.
