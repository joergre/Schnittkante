# Schnittkante

Schnittkante zerlegt gescannte Bögen an den roten Linien in einzelne PDF-Seiten.
Es wird kein Text erkannt.

In der Webfassung wird die PDF auf den eigenen Server geladen, dort geschnitten,
und das ZIP von dort heruntergeladen. Die Programme für Windows und Linux
schneiden auf dem eigenen Rechner.

Frei verfügbare Software unter der [MIT-Lizenz](LICENSE).
Copyright (c) 2026 Jörg Reuter.

---

## Deutsch

### Dateien

Die fertigen Dateien liegen bei den [Releases](https://github.com/joergre/Schnittkante/releases).

| Datei | Wofür |
|---|---|
| `Schnittkante-Setup.exe` | Windows, mit Eintrag im Startmenü |
| `Schnittkante.exe` | Windows, ohne Installation |
| `schnittkante.deb` | Ubuntu, Linux Mint, Debian |
| `Schnittkante.AppImage` | Linux, eine Datei |
| `Schnittkante-Anleitung.pdf` | Anleitung |
| `Schnittkante-Guide.pdf` | Dieselbe Anleitung auf Englisch |

Windows meldet einen unbekannten Herausgeber, weil die Datei nicht signiert ist.
**Weitere Informationen**, dann **Trotzdem ausführen**.

Die AppImage einmal als Programm ausführen erlauben, oder `chmod +x Schnittkante.AppImage`.

### Bedienung

Zuerst oben die Aufteilung wählen: **4→1**, **2→1**, **2 (90°)→1** oder **1→1**.
Danach erst die PDF öffnen. Ein Umschalten, wenn der Bogen schon da ist, ändert den Schnitt nicht.
War die Wahl falsch, die richtige Art wählen und dieselbe PDF erneut öffnen.

**Beispiel** lädt den passenden Bogen. **Beispiel 4→1** öffnet `Beispiel-4.pdf`: drei Bögen, auf jedem vier Seiten. **Beispiel 2→1** öffnet `Beispiel-2.pdf`: sechs Bögen, auf jedem zwei Seiten nebeneinander. Für 2 (90°)→1 und 1→1 liegt kein eigener Beispielbogen bei.

Die roten Linien prüfen und bei Bedarf ziehen. Das schneidet noch nicht.
**Schnitt ausführen** startet den Schnitt. Danach das ZIP speichern.
Der Dateiname endet auf `-einzelseiten.zip`, darin liegt eine PDF je Seite.

**Immer 2×2 schneiden** gibt es nur bei 4→1, vor dem Schnitt. Es teilt den Inhalt in vier gleiche Felder, wenn der Scan zu blass für eine Kante ist.

### Eigener Server

Die Webfassung braucht einen Rechner, der im Netz bleibt. Node.js 22.
Sie braucht kein Konto und ruft keinen fremden Dienst auf.

```bash
git clone https://github.com/joergre/Schnittkante.git /opt/schnittkante
cd /opt/schnittkante
npm install
NITRO_PRESET=node-server npm run build
PORT=3000 node .output/server/index.mjs
```

nginx leitet die Adresse auf Port 3000 weiter. Große Scans brauchen `client_max_body_size`, zum Beispiel `64m`.
Die Schritte stehen in der Anleitung.

```nginx
server {
    listen 80;
    server_name schnittkante.intern;
    client_max_body_size 64m;
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

---

## English

Schnittkante splits scanned sheets into single PDF pages along the red lines.
It does not read text.

In the web version the PDF is uploaded to your own server, cut there, and the ZIP is downloaded from there.
The Windows and Linux programs cut on your own computer.

Free software under the [MIT License](LICENSE).
Copyright (c) 2026 Jörg Reuter.

### Files

The built files are in the [releases](https://github.com/joergre/Schnittkante/releases).

| File | Use |
|---|---|
| `Schnittkante-Setup.exe` | Windows, with a Start menu entry |
| `Schnittkante.exe` | Windows, no installation |
| `schnittkante.deb` | Ubuntu, Linux Mint, Debian |
| `Schnittkante.AppImage` | Linux, one file |
| `Schnittkante-Anleitung.pdf` | Guide, German |
| `Schnittkante-Guide.pdf` | The same guide in English |

Windows reports an unknown publisher because the file is not signed.
**More info**, then **Run anyway**.

For the AppImage, allow it to run as a program once, or run `chmod +x Schnittkante.AppImage`.

### Use

First choose the layout at the top: **4→1**, **2→1**, **2 (90°)→1**, or **1→1**.
Only then open the PDF. Switching after the sheet is already on screen does not change the cut.
If the choice was wrong, select the right one and open the same PDF again.

**Beispiel** loads the matching sheet. **Beispiel 4→1** opens `Beispiel-4.pdf`: three sheets, four pages on each. **Beispiel 2→1** opens `Beispiel-2.pdf`: six sheets, two pages side by side on each. There is no separate sample for 2 (90°)→1 or 1→1.

Check the red lines and drag them if needed. That does not cut yet.
**Schnitt ausführen** runs the cut. Then save the ZIP.
The file name ends in `-einzelseiten.zip`, with one PDF per page.

**Immer 2×2 schneiden** exists only for 4→1, before the cut. It divides the content into four equal fields when the scan is too faint for an edge.

The buttons in the program are in German. The English guide uses those labels as they appear on screen.

### Your own server

The web version needs a computer that stays on the network. Node.js 22.
It needs no account and does not call an outside service.

```bash
git clone https://github.com/joergre/Schnittkante.git /opt/schnittkante
cd /opt/schnittkante
npm install
NITRO_PRESET=node-server npm run build
PORT=3000 node .output/server/index.mjs
```

nginx forwards the address to port 3000. Large scans need `client_max_body_size`, for example `64m`.
The steps are in the guide.

```nginx
server {
    listen 80;
    server_name schnittkante.intern;
    client_max_body_size 64m;
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```
