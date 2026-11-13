# Bücher

Eine private Bibliothek als Web-App: Regale mit Sammlungen, ein ruhiger Reader für EPUB, PDF und eigene Texte, Notizen und Markierungen, die mit Büchern und Textstellen verknüpft sind. Gestaltet wie eine Apple-App, nur etwas wärmer.

Läuft im Browser am PC und auf dem iPhone (als Web-App auf dem Home-Bildschirm), synchronisiert über Supabase. Laufende Kosten: **0 €**.

Live: `https://mooo23482347.github.io/grand-library/`

---

## Starten (PC, lokal)

Kein Build-Schritt, nichts zu installieren. Im Projektordner:

```bash
jwebserver -J-Djdk.net.unixdomain.tmpdir=C:/temp -p 4173 -b 127.0.0.1 -d "%CD%"
```

Dann `http://127.0.0.1:4173` öffnen. (`jwebserver` gehört zum JDK ab Version 18; jeder statische Webserver geht.)

Ohne Anmeldung liegt die Bibliothek nur im Browser dieses Geräts. Sicherung: *Einstellungen → Import & Sicherung*.

---

## Aufbau

| Bereich | Adresse | Was |
|---|---|---|
| Bibliothek | `#/` | Weiterlesen, Regalwand mit waagerecht wischbaren Buchreihen, Bearbeiten-Modus |
| Regal | `#/room/<regal>` | Sammlungen (inkl. *Allgemein*), Suche, Sortierung, Auswählen |
| Sammlung | `#/room/<regal>/<sammlung>` | Bücher der Sammlung, Unter-Sammlungen |
| Katalogkarte | `?doc=<id>` an jeder Adresse | Sheet (Handy) bzw. Seitenpanel (PC): Regale, Tags, Notizen, Inhalt, Details |
| Reader | `#/read/<id>` | Lesen; `?view=original` zeigt bei PDFs das Original |
| Notizen | `#/scriptorium` | Nach Buch gruppiert, Filter nach Art, `[[Links]]` zwischen Notizen |
| Alle Bücher | `#/catalogue` | Liste mit Filtern, Sortierung, Mehrfachauswahl |
| Ohne Regal | `#/unshelved` | Bücher, die in keinem Regal stehen |
| Suche | `#/search?q=` | Titel, Autoren, Tags, Notizen und Volltext; Taste `/` springt hierher |
| Einstellungen | `#/settings` | Design, Lesen, Statistik, Regale, Sicherung, Sync, Gerät |

Die Adressen sind aus Kompatibilität gleich geblieben (`scriptorium`, `room`, `catalogue`), damit alte Links und Lesezeichen weiter funktionieren.

Unter 900 px Breite gibt es eine Tab-Leiste (Bibliothek, Suche, Hinzufügen, Notizen, Mehr), darüber eine Seitenleiste.

### Dateien

| Ordner | Inhalt |
|---|---|
| `css/tokens.css` | Alle Farben, Radien, Schriften, Abstände; helles und dunkles Theme; selbst gehostete Schriften |
| `css/app.css` | Grundgerüst: Seitenleiste, Tab-Leiste, Navigationsleisten, Listen, Sheets, Segmente, Schalter |
| `css/library.css` | Cover, Regalwand, Bearbeiten-Modus, Katalogkarte, Notizen, Suche |
| `css/reader.css` | Reader: Papiere, Typografie, Verzierungen, Bedienleisten |
| `js/ui/` | Bausteine (Sheets, Dialoge, Listen, Umsortieren, Icons) |
| `js/views/` | Die Seiten |
| `js/reader/` | Reader, Seitenumbruch, PDF-Umwandlung, Original-Ansicht |
| `js/import/` | Hinzufügen, Datei-Analyse, Volltext-Index |

---

## Design-System

Alles Farbliche steht als Token in `css/tokens.css` (`--bg`, `--surface`, `--text`, `--accent`, `--board` …). Das dunkle Theme definiert dieselben Namen neu, einmal für `prefers-color-scheme: dark` und einmal für den manuellen Schalter (`html[data-theme="dark"]`). Eine Farbe ändern = beide Stellen anpassen.

- Oberfläche: Systemschrift (SF auf Apple-Geräten, Segoe UI unter Windows).
- Buchtitel, Regalnamen und Lesetext: Serifenschrift (`--font-serif`).
- Design-Wahl (Auto/Hell/Dunkel) liegt pro Gerät in `localStorage` und wird vor dem ersten Bild angewandt.
- Bewegung respektiert „Bewegung reduzieren“; Fokus ist per Tastatur sichtbar; Tippflächen mindestens 44 px; Eingabefelder 16 px (kein Zoomen am iPhone).

---

## Reader

### PDFs werden zu fließendem Text

Ein PDF wird beim ersten Öffnen in Text umgewandelt, der sich wie ein E-Book umbricht:

1. pdf.js liest Textstücke mit Position und Schriftgröße (Hauptthread).
2. Ein Web Worker (`js/reader/reflow-worker.js`) setzt daraus Zeilen und Absätze zusammen: erkennt Spalten, Kopf- und Fußzeilen, Fußnoten, Überschriften, Silbentrennung am Zeilenende und Kapitel (aus dem Inhaltsverzeichnis des PDFs oder den Überschriften).
3. Das Ergebnis liegt in der lokalen Tabelle `reflow`. Es wird **nicht** synchronisiert: es lässt sich jederzeit aus der Datei neu erzeugen und würde den Gratis-Speicher füllen. Jedes Gerät wandelt einmal selbst um (mit Fortschrittsanzeige).
4. PDFs ohne Text (Scans) öffnen automatisch im Original. Eine Texterkennung (OCR) ist bewusst nicht eingebaut.

Ändert sich der Umwandler, steigt `REFLOW_VERSION` in `js/reader/reflow.js`; alte Ergebnisse werden dann neu erzeugt.

### Positionen

Lesefortschritt, Lesezeichen und Markierungen speichern **Kapitel + Zeichen-Offset** (`{spine, offset}` bzw. `{spine, start, end}`) und zusätzlich die PDF-Seite. Damit stimmen sie unabhängig von Schriftgröße, Bildschirm und Seitenumbruch. Alte, nur seitenbasierte Positionen werden beim Öffnen über die Seite auf die neue Form übertragen.

### Was synchronisiert wird und was nicht

| Synchronisiert (alle Geräte gleich) | Pro Gerät |
|---|---|
| Papier, Schrift, Stärke, Zeilenabstand, Absätze, Ausrichtung, Verzierungen | Schriftgröße, Ränder, Lesemodus (Seiten/Scrollen), Doppelseite |

Begründung: Geschmack (Papier, Schrift) soll überall gleich sein. Größen hängen am Bildschirm: was am PC angenehm ist, ist am Handy zu groß.

### Ein Papier hinzufügen

1. In `js/reader/prefs.js` einen Eintrag in `SKINS` ergänzen (`id`, `name`, `dark`).
2. In `css/reader.css` eine Klasse `.skin-<id>` mit `--paper`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent-r`, `--desk` und optional `--tex` (Struktur als kleines SVG) anlegen.
3. In `js/reader/reader.js` die Farbe für die Statusleiste in `PAPER_COLOR` eintragen.

Effekte bitte statisch halten (Masken, Verläufe). Keine Filter, die pro Bild neu gerechnet werden: das ruckelt am iPhone.

### Eine Schrift hinzufügen

1. Datei (WOFF2, freie Lizenz) nach `assets/fonts/`, Lizenz daneben legen.
2. `@font-face` in `css/tokens.css`.
3. Eintrag in `FONTS` in `js/reader/prefs.js` (`id`, `name`, `css`).
4. Datei in die `SHELL`-Liste von `sw.js` aufnehmen.

Schriften werden nie von Google Fonts oder anderen CDNs geladen.

### Verzierungen

Abschaltbar unter *Einstellungen → Verzierungen* bzw. im Aa-Menü: Initiale am Kapitelanfang, Ornamente zwischen Kapiteln, Eselsohr auf der Seite, an der man weiterliest, Lesebändchen bei Lesezeichen, seltene Kleinigkeiten am Seitenrand (Teefleck, Blatt, Kritzelei, Stern), ein Lorbeerkranz am Buchende. Dazu die Lese-Serie (Tage in Folge) in den Einstellungen.

---

## Datenmodell

Lokal in IndexedDB (Dexie, Datenbankname `grand-library`), Schema in [js/db.js](js/db.js), Logik in [js/store.js](js/store.js).

| Tabelle | Inhalt | Sync |
|---|---|---|
| `departments` | Regale (Name, Farbe, Reihenfolge) | ja |
| `collections` | Sammlungen, verschachtelt über `parentId` | ja |
| `documents` | Jedes Buch **genau einmal** | ja |
| `assignments` | Standorte Buch ↔ Regal/Sammlung (ein Buch kann mehrere haben) | ja |
| `tags`, `documentTags` | Schlagwörter | ja |
| `notes` | Notiz, Zusammenfassung, Gedanke, Theorie, Zitat | ja |
| `highlights`, `bookmarks`, `progress` | Markierungen, Lesezeichen, Fortschritt | ja |
| `texts` | Eigene Texte (Markdown) | ja |
| `files`, `covers` | Dateien (Schlüssel = SHA-256, nie doppelt) | Speicher |
| `prefs` | Lese-Einstellungen, Lese-Serie | ja |
| `reflow` | Umgewandelter PDF-Text | nein |
| `fulltext` | Volltext für die Suche | nein |
| `outbox`, `meta`, `settings` | Sync-Warteschlange, interne Werte, Geräte-Einstellungen | nein |

Regeln, die der Code garantiert:

- **Verschieben** ändert nur Standorte, nie das Buch.
- **Sammlung löschen**: Bücher und Unter-Sammlungen rücken eine Ebene nach oben.
- **Regal löschen**: Bücher, die nur dort standen, landen in *Ohne Regal*. Nichts wird gelöscht.
- **Buch löschen**: Notizen dazu bleiben erhalten (der Titel wird gemerkt).
- **Migrationen**: neue Schema-Version in `db.js`, Datenmigrationen in `DATA_MIGRATIONS`. Die Cloud-Tabelle ist generisch und braucht für neue Felder keine Migration.

---

## Kostenlos bleiben

| Dienst | Gratis-Grenze | Was die App tut |
|---|---|---|
| Supabase Storage | 1 GB Dateien, 50 MB pro Datei | Warnt ab 85 %, behält zu große Dateien nur lokal und sagt das an |
| Supabase Datenbank | 500 MB | Speichert nur Metadaten, Notizen und Einstellungen; Volltext und PDF-Umwandlung bleiben lokal |
| Supabase Pausierung | Projekt pausiert nach 7 Tagen ohne Nutzung | App meldet, dass der Sync-Server nicht erreichbar ist |
| GitHub Pages | 1 GB, öffentlich | Nur App-Code liegt dort, keine Bücher und keine Notizen |

Es ist nirgends eine Kreditkarte hinterlegt.

---

## Einrichtung von Sync und iPhone

1. **Supabase** (kostenlos): Projekt anlegen, `supabase/schema.sql` im SQL Editor ausführen, unter *Authentication → Users → Add user* einen Benutzer anlegen (*Auto Confirm* an), unter *Authentication → Sign In / Providers* „Allow new users to sign up“ ausschalten.
2. **Projekt-URL und Publishable Key** in `config.js` eintragen. Beide sind öffentlich; geschützt wird über Anmeldung und Row Level Security.
3. **GitHub Pages**: *Settings → Pages → Deploy from branch → main / root*.
4. **iPhone**: Adresse in Safari öffnen → Teilen → *Zum Home-Bildschirm*. In den Einstellungen anmelden.

---

## Technik

- Bibliotheken mit festen Versionen von jsDelivr: Dexie 4.0.8, pdf.js 4.10.38, JSZip 3.10.1, supabase-js 2.45.4.
- Service Worker (`sw.js`): App-Dateien „Netz zuerst“, offline aus dem Zwischenspeicher. Neue Dateien in `SHELL` eintragen und `VERSION` erhöhen.
- Nach einem Deploy kann es bis zu 10 Minuten dauern, bis jedes Gerät die neue Version lädt (GitHub Pages erlaubt Browsern so lange zu cachen). Sofort: am PC Strg+Umschalt+R, am iPhone die Web-App schließen und neu öffnen.
- EPUB-Kapitel werden über eine Allow-List neu aufgebaut: Skripte, Styles, Formulare und Event-Handler aus Büchern erreichen die Seite nie.
- Kostenlose Bücher kommen aus dem Internet Archive (Suche direkt im Browser). Lädt der Archive-Server eine Datei nicht direkt herunter, öffnet die App die Seite des Buchs, von wo man die Datei speichert und hinzufügt.

### Schriften und Lizenzen

- Literata (Variable Font), SIL Open Font License 1.1, `assets/fonts/LICENSE-literata.txt`
- Atkinson Hyperlegible, SIL Open Font License 1.1, `assets/fonts/LICENSE-atkinson.txt`
- Icons: eigene Pfade im Stil von Lucide (ISC-Lizenz)
