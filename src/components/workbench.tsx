import { useEffect, useRef, useState } from "react";
import { Crop, Download, FileUp, RotateCcw } from "lucide-react";
import { panelsFromRows, type RowCut, type SplitMode } from "@/lib/sheet-split";
import type { SplitResult, SplitSession } from "@/lib/pdf-split";

const SAMPLES: Partial<Record<SplitMode, { path: string; name: string }>> = {
  quad: { path: "probe/beispiel-4.pdf", name: "Beispiel-4.pdf" },
  duo: { path: "probe/beispiel-2.pdf", name: "Beispiel-2.pdf" },
};

function sampleFor(mode: SplitMode) {
  return SAMPLES[mode] ?? null;
}

type ServerJob = {
  id: string;
  name: string;
  sheets: SplitResult["sheets"];
};

function usesServer() {
  return typeof window !== "undefined" && window.location.protocol !== "file:";
}

const CONFIDENCE: Record<SplitResult["sheets"][number]["confidence"], string> = {
  edges: "Seitenkanten erkannt",
  gutter: "Schnitt am weißen Bund",
  grid: "Gleichmäßiger Schnitt",
  single: "Eine Seite",
};

const MODES: { id: SplitMode; label: string; hint: string }[] = [
  { id: "quad", label: "4→1", hint: "Vier Seiten, zwei Zeilen. Beispiel-4.pdf: drei Bögen" },
  { id: "duo", label: "2→1", hint: "Zwei Seiten nebeneinander. Beispiel-2.pdf: sechs Bögen" },
  { id: "duo90", label: "2 (90°)→1", hint: "Zwei Seiten übereinander, um eine Vierteldrehung aufgestellt" },
  { id: "single", label: "1→1", hint: "Der Bogen bleibt eine Seite" },
];

export function Workbench() {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [note, setNote] = useState("Beispiel-4 wird vermessen");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SplitResult | null>(null);
  const [forced, setForced] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [mode, setMode] = useState<SplitMode>("quad");
  const [cut, setCut] = useState<"open" | "done">("open");
  const sessionRef = useRef<SplitSession | null>(null);
  const serverIdRef = useRef<string | null>(null);
  const modeRef = useRef<SplitMode>("quad");
  const jobRef = useRef(0);
  const pdfBlobRef = useRef<Blob | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sampleRef = useRef(true);

  useEffect(() => {
    void loadSample();
    // The sample is the document this desk opens with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSample(forMode: SplitMode = modeRef.current) {
    const sample = sampleFor(forMode);
    if (!sample) {
      setSavedNote("Für 2 (90°)→1 und 1→1 liegt kein eigener Beispielbogen bei. Beispiel-4.pdf gehört zu 4→1, Beispiel-2.pdf zu 2→1.");
      return;
    }
    setError("");
    setSavedNote("");
    try {
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error("Beispielbogen nicht gefunden");
      const bytes = new Uint8Array(await response.arrayBuffer());
      sampleRef.current = true;
      await run(bytes, sample.name);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Der Bogen konnte nicht gelesen werden");
    }
  }

  async function run(bytes: Uint8Array, name: string) {
    const job = ++jobRef.current;
    sessionRef.current = null;
    serverIdRef.current = null;
    setPhase("loading");
    setNote(name);
    setError("");
    setForced(false);
    setSavedNote("");
    setResult(null);
    try {
      if (usesServer()) {
        const form = new FormData();
        form.set("file", new File([bytes], name, { type: "application/pdf" }));
        form.set("mode", modeRef.current);
        const response = await fetch("/api/bogen", { method: "POST", body: form });
        const data = (await response.json()) as ServerJob & { error?: string };
        if (!response.ok || !data.id) throw new Error(data.error || "Der Server hat die PDF nicht angenommen");
        if (job !== jobRef.current) return;
        serverIdRef.current = data.id;
        setResult({ name: data.name, sheets: data.sheets, pages: [], pdfUrl: "", blob: new Blob(), byteSize: 0 });
        setCut("open");
        setPhase("ready");
        return;
      }
      const api = await import("@/lib/pdf-split");
      const session = await api.openPdf(bytes, name, modeRef.current);
      if (job !== jobRef.current) return;
      api.applyMode(session, modeRef.current);
      if (job !== jobRef.current) return;
      sessionRef.current = session;
      present(session);
    } catch (err) {
      if (job !== jobRef.current) return;
      setPhase("error");
      setError(err instanceof Error ? err.message : "Die Datei ließ sich nicht schneiden");
    }
  }

  function present(session: SplitSession) {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = null;
    pdfBlobRef.current = null;
    void import("@/lib/pdf-split").then((api) => {
      if (sessionRef.current !== session) return;
      setResult(api.stageSession(session));
      setCut("open");
      setPhase("ready");
      setSavedNote("");
    });
  }

  async function publish(session: SplitSession, job = jobRef.current) {
    const api = await import("@/lib/pdf-split");
    const next = await api.materialize(session);
    if (job !== jobRef.current) {
      URL.revokeObjectURL(next.pdfUrl);
      return;
    }
    pdfBlobRef.current = next.blob;
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = next.pdfUrl;
    setResult(next);
    setCut("done");
    setPhase("ready");
    setSavedNote("");
  }

  async function onFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setPhase("error");
      setError("Bitte eine PDF-Datei ablegen.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    sampleRef.current = false;
    await run(bytes, file.name);
  }

  function updateRows(sheetIndex: number, rows: RowCut[]) {
    if (serverIdRef.current) {
      setResult((current) => {
        if (!current) return current;
        return {
          ...current,
          pages: [],
          pdfUrl: "",
          sheets: current.sheets.map((item) =>
            item.index === sheetIndex ? { ...item, rows: rows.map((row) => ({ ...row })) } : item,
          ),
        };
      });
      setCut("open");
      return;
    }
    const session = sessionRef.current;
    if (!session || !result) return;
    const sheet = session.sheets.find((item) => item.index === sheetIndex);
    if (!sheet) return;
    sheet.detection = {
      ...sheet.detection,
      rows,
      panels: panelsFromRows(rows),
    };
    setResult((current) => {
      if (!current) return current;
      return {
        ...current,
        pages: [],
        sheets: current.sheets.map((item) =>
          item.index === sheetIndex ? { ...item, rows: rows.map((row) => ({ ...row })) } : item,
        ),
      };
    });
    setCut("open");
  }

  async function confirmCut() {
    if (serverIdRef.current && result) {
      const job = ++jobRef.current;
      setPhase("loading");
      setNote("Schnitt wird auf dem Server ausgeführt");
      try {
        const response = await fetch("/api/schneiden", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: serverIdRef.current,
            sheets: result.sheets.map((sheet) => ({ index: sheet.index, rows: sheet.rows })),
          }),
        });
        const data = (await response.json()) as {
          error?: string;
          download?: string;
          pages?: SplitResult["pages"];
        };
        if (!response.ok || !data.download || !data.pages) throw new Error(data.error || "Der Server hat nicht geschnitten");
        if (job !== jobRef.current) return;
        setResult((current) =>
          current ? { ...current, pages: data.pages ?? [], pdfUrl: data.download ?? "" } : current,
        );
        setCut("done");
        setPhase("ready");
      } catch (err) {
        if (job !== jobRef.current) return;
        setPhase("error");
        setError(err instanceof Error ? err.message : "Der Schnitt ist fehlgeschlagen");
      }
      return;
    }
    const session = sessionRef.current;
    if (!session) return;
    setPhase("loading");
    setNote("Schnitt wird ausgeführt");
    await publish(session);
  }

  async function onForce() {
    if (serverIdRef.current) {
      setNote("Bögen werden in vier Felder gelegt");
      const response = await fetch("/api/raster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: serverIdRef.current }),
      });
      const data = (await response.json()) as ServerJob & { error?: string };
      if (!response.ok || !data.sheets) {
        setError(data.error || "Der Server konnte nicht neu einteilen");
        return;
      }
      setForced(true);
      setResult((current) => (current ? { ...current, sheets: data.sheets, pages: [], pdfUrl: "" } : current));
      setCut("open");
      return;
    }
    const session = sessionRef.current;
    if (!session) return;
    setNote("Bögen werden in vier Felder gelegt");
    const api = await import("@/lib/pdf-split");
    api.applyMode(session, "quad", true);
    setForced(true);
    present(session);
  }

  async function onMode(next: SplitMode) {
    modeRef.current = next;
    setMode(next);
    setForced(false);
    if (sampleRef.current) {
      if (sampleFor(next)) {
        await loadSample(next);
        return;
      }
      setSavedNote("Für 2 (90°)→1 und 1→1 liegt kein eigener Beispielbogen bei. Beispiel-4.pdf gehört zu 4→1, Beispiel-2.pdf zu 2→1.");
      return;
    }
    if (serverIdRef.current) {
      setSavedNote("Die Aufteilung gilt, wenn die PDF erneut geöffnet wird.");
      return;
    }
    const session = sessionRef.current;
    if (!session) return;
    setNote("Schnitt wird umgelegt");
    const api = await import("@/lib/pdf-split");
    api.applyMode(session, next);
    present(session);
  }

  async function downloadGuide(file: string) {
    const response = await fetch(file);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const framed = window.parent !== window;
    if (!framed) {
      clickDownload(document, url, file);
    } else {
      const popup = window.open("about:blank", "_blank");
      if (popup) {
        popup.document.open();
        popup.document.write(
          '<!doctype html><title>Schnittkante</title><body style="font-family:sans-serif;padding:24px"><p>The file is being saved. You can close this tab afterwards.</p></body>',
        );
        popup.document.close();
        clickDownload(popup.document, url, file);
      } else {
        clickDownload(document, url, file);
      }
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }

  function onDownload() {
    if (!result) return;
    const filename = (result.name.replace(/\.pdf$/i, "") || "bogen") + "-einzelseiten.zip";
    if (result.pdfUrl.startsWith("/api/")) {
      const href = new URL(result.pdfUrl, window.location.href).href;
      saveHref(href, filename);
      setSavedNote("Das ZIP wird vom Server geladen.");
      return;
    }
    const blob = pdfBlobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    saveHref(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }

  function saveHref(href: string, filename: string) {
    const framed = window.parent !== window;
    if (!framed) {
      clickDownload(document, href, filename);
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.document.open();
      popup.document.write(
        '<!doctype html><title>Schnittkante</title><body style="font-family:sans-serif;padding:24px"><p>Die Datei wird gespeichert. Diesen Tab kannst du danach schließen.</p></body>',
      );
      popup.document.close();
      clickDownload(popup.document, href, filename);
    } else {
      clickDownload(document, href, filename);
    }
  }

  const pageCount = result?.pages.length ?? 0;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="mt-1 grid size-11 place-items-center rounded-card bg-ink text-sheet" aria-hidden="true">
              <Crop className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="font-serif text-3xl leading-none tracking-tight">Schnittkante</p>
              <p className="mt-2 max-w-md text-sm text-muted">
                Schneidet gescannte Bögen in Einzelseiten. Oben die Aufteilung wählen.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-sheet px-4 text-sm font-medium">
              <FileUp className="size-4" aria-hidden="true" />
              Andere PDF
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onFile(file);
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void loadSample(modeRef.current)}
              className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {mode === "duo" ? "Beispiel 2→1" : "Beispiel 4→1"}
            </button>
            <button
              type="button"
              onClick={() => void downloadGuide("Schnittkante-Anleitung.pdf")}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-sheet px-4 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden="true" />
              Anleitung
            </button>
            <button
              type="button"
              onClick={() => void downloadGuide("Schnittkante-Guide.pdf")}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-sheet px-4 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden="true" />
              Guide
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
          <span className="text-sm text-muted" id="split-mode-label">
            Aufteilung
          </span>
          <div role="radiogroup" aria-labelledby="split-mode-label" className="flex flex-wrap gap-1">
            {MODES.map((item) => {
              const selected = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={item.hint}
                  onClick={() => void onMode(item.id)}
                  className={
                    selected
                      ? "inline-flex h-11 items-center rounded-full bg-ink px-3 text-sm font-medium text-sheet"
                      : "inline-flex h-11 items-center rounded-full border border-line bg-sheet px-3 text-sm font-medium"
                  }
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="basis-full text-sm text-muted">
            Beispiel-4.pdf zeigt 4→1: drei Bögen mit je vier Seiten. Beispiel-2.pdf zeigt 2→1: sechs Bögen mit je zwei Seiten.
          </p>
        </div>
      </header>

      <main
        className="mx-auto max-w-6xl px-4 py-6 sm:px-6"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) void onFile(file);
        }}
      >
        {phase === "error" && (
          <p className="mb-4 rounded-card border border-crop bg-crop-soft px-4 py-3 text-sm" role="alert">
            {error}
          </p>
        )}

        {phase === "loading" && !result && (
          <section className="rounded-card border border-line bg-sheet px-5 py-8 shadow-sheet">
            <p className="font-serif text-2xl">{note}</p>
            <p className="mt-2 max-w-lg text-sm text-muted">
              Die Datei wird gelesen und unter Bögen gezeigt. Eine PDF lässt sich auch hier ablegen.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-card bg-paper sm:h-48" />
              ))}
            </div>
          </section>
        )}

        {result && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <section>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-xl">Bögen</h2>
                <p className="min-w-0 truncate text-sm text-muted">
                  {result.name}
                  {" · "}
                  {result.sheets.length} {result.sheets.length === 1 ? "Bogen" : "Bögen"}
                  {phase === "loading" ? ` · ${note}` : ""}
                </p>
              </div>
              <div className="space-y-4">
                {result.sheets.map((sheet) => (
                  <article key={`${result.name}-${sheet.index}`} className="rounded-card border border-line bg-sheet p-3 shadow-sheet">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <h3 className="text-sm font-medium">Bogen {sheet.index}</h3>
                      <p className="text-xs text-muted">{CONFIDENCE[sheet.confidence]}</p>
                    </div>
                    <GuideStage
                      sheetUrl={sheet.sheetUrl}
                      width={sheet.width}
                      height={sheet.height}
                      rows={sheet.rows}
                      onChange={(rows) => updateRows(sheet.index, rows)}
                      onCommit={() => setCut("open")}
                    />
                  </article>
                ))}
              </div>
              <details className="mt-4 rounded-card border border-line bg-sheet px-4 py-3 text-sm">
                <summary className="font-medium">Wie die Ränder gefunden werden</summary>
                <ol className="mt-3 list-decimal space-y-2 pl-4 text-muted">
                  <li>Der Bogen wird in Graustufen gelegt. Text bleibt dunkel, das Papier hell.</li>
                  <li>
                    Gesucht werden lange, dünne Kanten — die Papierränder —, nicht die Textzeilen. Eine Kante ist
                    isoliert: darunter oder darüber liegt Weiß.
                  </li>
                  <li>Zwei untere Kanten trennen die Zeilen. Der Bund ist die senkrechte Kante in der Mitte jeder Zeile.</li>
                  <li>Fehlt die linke Außenkante, wird die Breite der rechten Seite gespiegelt.</li>
                  <li>Der weiße Steg zwischen den Seiten bleibt draußen. Die Linien lassen sich ziehen; der Schnitt folgt erst der Bestätigung.</li>
                </ol>
              </details>
            </section>

            <section>
              {cut === "done" && result.pages.length > 0 ? (
                <>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h2 className="font-serif text-xl">Einzelseiten</h2>
                    <p className="text-sm text-muted">{pageCount} PDF-Seiten</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {result.pages.map((page) => (
                      <figure key={`${page.sheet}-${page.label}-${page.place}`} className="min-w-0">
                        <div className="overflow-hidden rounded-card border border-line bg-sheet shadow-sheet">
                          <img
                            src={page.url}
                            alt={`Seite ${page.label}, Bogen ${page.sheet}, ${page.place}`}
                            className="block h-auto w-full bg-sheet"
                          />
                        </div>
                        <figcaption className="mt-1.5 flex items-baseline justify-between gap-2 px-0.5 text-xs text-muted">
                          <span className="font-medium text-ink">{page.label}</span>
                          <span className="truncate">
                            Bogen {page.sheet} · {page.place}
                          </span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  <div className="mt-4 rounded-card border border-line bg-sheet p-4">
                    <p className="text-sm text-muted">
                      Geschnitten ist nach den roten Linien. Ziehst du eine Linie neu, musst du den Schnitt erneut bestätigen.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onDownload}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-crop px-4 text-sm font-medium text-sheet"
                      >
                        <Download className="size-4" aria-hidden="true" />
                        {pageCount} PDFs als ZIP
                      </button>
                      {result.pdfUrl && (
                        <a
                          href={result.pdfUrl}
                          download={(result.name.replace(/\.pdf$/i, "") || "bogen") + "-einzelseiten.zip"}
                          className="inline-flex h-11 items-center text-sm font-medium text-crop underline decoration-crop underline-offset-4"
                        >
                          ZIP-Datei herunterladen
                        </a>
                      )}
                    </div>
                    {savedNote && <p className="mt-3 text-sm text-muted">{savedNote}</p>}
                  </div>
                </>
              ) : (
                <div className="rounded-card border border-line bg-sheet p-4 shadow-sheet">
                  <h2 className="font-serif text-xl">Schnitt bestätigen</h2>
                  <p className="mt-2 text-sm text-muted">
                    Die roten Linien sind erst nur die Anzeige. Zieh die Ränder und den Bund an die richtige Stelle.
                    Der Schnitt der Seiten beginnt mit der Bestätigung.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmCut()}
                      disabled={phase === "loading"}
                      className="inline-flex h-11 items-center rounded-full bg-crop px-4 text-sm font-medium text-sheet disabled:opacity-60"
                    >
                      {phase === "loading" ? "Schneidet …" : "Schnitt ausführen"}
                    </button>
                    {!forced && mode === "quad" && (
                      <button
                        type="button"
                        onClick={() => void onForce()}
                        className="inline-flex h-11 items-center rounded-full border border-line px-4 text-sm font-medium"
                      >
                        Immer 2×2 schneiden
                      </button>
                    )}
                  </div>
                  {savedNote && <p className="mt-3 text-sm text-muted">{savedNote}</p>}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function clickDownload(doc: Document, href: string, filename: string) {
  const anchor = doc.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function GuideStage({
  sheetUrl,
  width,
  height,
  rows,
  onChange,
  onCommit,
}: {
  sheetUrl: string;
  width: number;
  height: number;
  rows: RowCut[] | null;
  onChange: (rows: RowCut[]) => void;
  onCommit: () => void;
}) {
  if (!rows) {
    return <img src={sheetUrl} alt="Bogen ohne erkannten Viererschnitt" className="block h-auto w-full" />;
  }

  function move(rowIndex: number, key: "top" | "bottom" | "left" | "fold" | "right", value: number) {
    const source = rows ?? [];
    const next = source.map((current, index) => {
      if (index !== rowIndex) return { ...current };
      const copy = { ...current };
      const limit = key === "top" || key === "bottom" ? height : width;
      copy[key] = Math.round(Math.min(limit - 8, Math.max(8, value)));
      if ((copy.columns ?? 2) === 2) {
        if (copy.fold < copy.left + 20) copy.fold = copy.left + 20;
        if (copy.right < copy.fold + 20) copy.right = copy.fold + 20;
      } else if (copy.right < copy.left + 24) {
        copy.right = copy.left + 24;
      }
      if (copy.bottom < copy.top + 24) copy.bottom = copy.top + 24;
      return copy;
    });
    const above = next[rowIndex - 1];
    const here = next[rowIndex];
    const below = next[rowIndex + 1];
    if (here && above && here.top < above.bottom + 4) here.top = above.bottom + 4;
    if (here && below && here.bottom > below.top - 4) here.bottom = below.top - 4;
    onChange(next);
  }

  return (
    <div className="relative" data-board>
      <img src={sheetUrl} alt="" className="block h-auto w-full select-none" draggable={false} />
      {rows.map((row, index) => {
        const paired = (row.columns ?? 2) === 2;
        return (
        <div key={index}>
          {paired ? (
            <>
              <Box left={row.left} top={row.top} right={row.fold} bottom={row.bottom} width={width} height={height} />
              <Box left={row.fold} top={row.top} right={row.right} bottom={row.bottom} width={width} height={height} />
            </>
          ) : (
            <Box left={row.left} top={row.top} right={row.right} bottom={row.bottom} width={width} height={height} />
          )}
          <Handle
            label={`Linke Kante, Zeile ${index + 1}`}
            axis="x"
            span={width}
            style={{ left: pct(row.left, width), top: pct(row.top, height), height: pct(row.bottom - row.top, height) }}
            onValue={(value) => move(index, "left", value)}
            onCommit={onCommit}
          />
          {paired && (
            <Handle
              label={`Bund, Zeile ${index + 1}`}
              axis="x"
              span={width}
              style={{ left: pct(row.fold, width), top: pct(row.top, height), height: pct(row.bottom - row.top, height) }}
              onValue={(value) => move(index, "fold", value)}
              onCommit={onCommit}
            />
          )}
          <Handle
            label={`Rechte Kante, Zeile ${index + 1}`}
            axis="x"
            span={width}
            style={{ left: pct(row.right, width), top: pct(row.top, height), height: pct(row.bottom - row.top, height) }}
            onValue={(value) => move(index, "right", value)}
            onCommit={onCommit}
          />
          <Handle
            label={`Oberkante, Zeile ${index + 1}`}
            axis="y"
            span={height}
            style={{ top: pct(row.top, height), left: pct(row.left, width), width: pct(row.right - row.left, width) }}
            onValue={(value) => move(index, "top", value)}
            onCommit={onCommit}
          />
          <Handle
            label={`Unterkante, Zeile ${index + 1}`}
            axis="y"
            span={height}
            style={{ top: pct(row.bottom, height), left: pct(row.left, width), width: pct(row.right - row.left, width) }}
            onValue={(value) => move(index, "bottom", value)}
            onCommit={onCommit}
          />
        </div>
        );
      })}
    </div>
  );
}

function Box({
  left,
  top,
  right,
  bottom,
  width,
  height,
}: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}) {
  return (
    <div
      className="pointer-events-none absolute border border-crop"
      style={{
        left: pct(left, width),
        top: pct(top, height),
        width: pct(right - left, width),
        height: pct(bottom - top, height),
      }}
    />
  );
}

function Handle({
  label,
  axis,
  span,
  style,
  onValue,
  onCommit,
}: {
  label: string;
  axis: "x" | "y";
  span: number;
  style: { left?: string; top?: string; width?: string; height?: string };
  onValue: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      style={style}
      className={
        axis === "x"
          ? "absolute z-10 w-11 -translate-x-1/2 touch-none"
          : "absolute z-10 h-11 -translate-y-1/2 touch-none"
      }
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const board = event.currentTarget.closest("[data-board]");
        if (!(board instanceof HTMLElement)) return;
        const box = board.getBoundingClientRect();
        const ratio =
          axis === "x"
            ? (event.clientX - box.left) / Math.max(1, box.width)
            : (event.clientY - box.top) / Math.max(1, box.height);
        onValue(ratio * span);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onCommit();
      }}
    >
      <span
        className={
          axis === "x"
            ? "pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-crop"
            : "pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-crop"
        }
      />
    </button>
  );
}

function pct(value: number, total: number) {
  return `${(value / total) * 100}%`;
}
