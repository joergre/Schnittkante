# Schnittkante

Frei verfügbare Software. Sie darf benutzt, verändert und weitergegeben werden.
Lizenz: MIT, Text in [`LICENSE`](LICENSE).

Gescannte Bögen werden an den roten Linien in einzelne PDF-Seiten zerlegt.
Die PDF bleibt auf dem Rechner. Nichts wird hochgeladen.

## Programme

Die fertigen Dateien liegen bei den [Releases](https://github.com/joergre/Schnittkante/releases).

| Datei | System |
|---|---|
| `Schnittkante-Setup.exe` | Windows, mit Installation |
| `Schnittkante.exe` | Windows, ohne Installation |
| `schnittkante.deb` | Ubuntu, Mint, Debian |
| `Schnittkante.AppImage` | Linux, eine Datei |
| `Schnittkante-Anleitung.pdf` | Anleitung |

Windows meldet einen unbekannten Herausgeber. **Weitere Informationen**, dann **Trotzdem ausführen**.

## Bedienung

Zuerst oben die Aufteilung wählen: 4→1, 2→1, 2 (90°)→1 oder 1→1.
Danach erst die PDF öffnen. Ein Umschalten, wenn der Bogen schon da ist, ändert den Schnitt nicht. War die Wahl falsch: die richtige Art wählen und die PDF erneut öffnen.

Dann die roten Linien prüfen, **Schnitt ausführen**, und das ZIP speichern.

## Weboberfläche auf dem eigenen Server

Die Seite wird aus diesem Quelltext gebaut. Der Server liefert nur die Oberfläche. Der Schnitt passiert im Browser des Kollegen.

```bash
git clone https://github.com/joergre/Schnittkante.git /opt/schnittkante
cd /opt/schnittkante
npm install
npx vite build --config desktop/vite.config.ts
```

Das Ergebnis liegt in `desktop/dist`. Diesen Ordner als Stammverzeichnis eines Webservers ausliefern, zum Beispiel mit nginx. Die genaue Anleitung steht in der PDF.
