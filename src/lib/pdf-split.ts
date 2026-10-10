import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, degrees, type PDFPage } from "pdf-lib";
import { zipSync } from "fflate";
import {
  detectSheet,
  grayFromRgba,
  panelsFromRows,
  type PageRotation,
  type Panel,
  type RowCut,
  type SheetDetection,
  type SplitConfidence,
  type SplitMode,
} from "@/lib/sheet-split";

GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = 2;
const FRAME = 14;

export type SheetView = {
  index: number;
  width: number;
  height: number;
  rows: RowCut[] | null;
  panels: Panel[];
  confidence: SplitConfidence;
  sheetUrl: string;
};

export type PageView = {
  sheet: number;
  label: string;
  place: string;
  url: string;
};

export type SplitResult = {
  name: string;
  sheets: SheetView[];
  pages: PageView[];
  pdfUrl: string;
  blob: Blob;
  byteSize: number;
};

type SheetCache = {
  index: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  sheetUrl: string;
  pdfWidth: number;
  pdfHeight: number;
  detection: SheetDetection;
};

export type SplitSession = {
  name: string;
  bytes: Uint8Array;
  sheets: SheetCache[];
};

const PLACES = ["oben links", "oben rechts", "unten links", "unten rechts"];

export async function openPdf(bytes: Uint8Array, name: string, mode: SplitMode = "quad"): Promise<SplitSession> {
  const stored = new Uint8Array(bytes);
  const doc = await getDocument({ data: stored.slice(), useSystemFonts: true }).promise;
  const sheets: SheetCache[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const natural = page.getViewport({ scale: 1 });
      const longest = Math.max(natural.width, natural.height);
      const viewport = page.getViewport({ scale: Math.min(RENDER_SCALE, 2200 / longest) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas nicht verfügbar");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = grayFromRgba(image.data, canvas.width, canvas.height);
      sheets.push({
        index: i,
        width: canvas.width,
        height: canvas.height,
        canvas,
        sheetUrl: canvas.toDataURL("image/jpeg", 0.82),
        pdfWidth: natural.width,
        pdfHeight: natural.height,
        detection: detectSheet(gray, canvas.width, canvas.height, mode),
      });
    }
  } finally {
    await doc.cleanup();
  }
  return { name, bytes: stored, sheets };
}

export function applyRows(session: SplitSession, sheetIndex: number, rows: RowCut[]) {
  const sheet = session.sheets.find((item) => item.index === sheetIndex);
  if (!sheet) return;
  sheet.detection = {
    ...sheet.detection,
    rows,
    panels: panelsFromRows(rows),
  };
}

export function applyMode(session: SplitSession, mode: SplitMode, even = false) {
  for (const sheet of session.sheets) {
    const ctx = sheet.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) continue;
    const image = ctx.getImageData(0, 0, sheet.width, sheet.height);
    const gray = grayFromRgba(image.data, sheet.width, sheet.height);
    sheet.detection = detectSheet(gray, sheet.width, sheet.height, mode, even);
  }
}

export function stageSession(session: SplitSession): SplitResult {
  return {
    name: session.name,
    byteSize: 0,
    blob: new Blob(),
    pdfUrl: "",
    pages: [],
    sheets: sheetViews(session),
  };
}

export async function materialize(session: SplitSession): Promise<SplitResult> {
  const src = await PDFDocument.load(session.bytes.slice());
  const srcPages = src.getPages();
  const pages: PageView[] = [];
  const entries: Record<string, Uint8Array> = {};
  let running = 0;

  for (const sheet of session.sheets) {
    const srcPage = srcPages[sheet.index - 1];
    if (!srcPage) continue;
    for (const panel of sheet.detection.panels) {
      running += 1;
      const box = panelToPdf(sheet, panel);
      if (box.right - box.left < 4 || box.top - box.bottom < 4) continue;
      const place = placeOf(panel, sheet.detection);
      const filename = pageFileName(running, sheet.index, place);
      entries[filename] = await renderPagePdf(srcPage, box, filename, sheet.detection.rotation);
      pages.push({
        sheet: sheet.index,
        label: String(running),
        place,
        url: cropUrl(sheet.canvas, panel, sheet.detection.rotation),
      });
    }
  }

  const zipped = zipSync(entries, { level: 0 });
  const blob = new Blob([Uint8Array.from(zipped)], { type: "application/zip" });

  return {
    name: session.name,
    byteSize: zipped.byteLength,
    blob,
    pdfUrl: URL.createObjectURL(blob),
    pages,
    sheets: sheetViews(session),
  };
}

function sheetViews(session: SplitSession): SheetView[] {
  return session.sheets.map((sheet) => ({
    index: sheet.index,
    width: sheet.width,
    height: sheet.height,
    rows: sheet.detection.rows,
    panels: sheet.detection.panels,
    confidence: sheet.detection.confidence,
    sheetUrl: sheet.sheetUrl,
  }));
}

async function renderPagePdf(
  srcPage: PDFPage,
  box: { left: number; bottom: number; right: number; top: number },
  title: string,
  rotation: PageRotation,
) {
  const doc = await PDFDocument.create();
  const embedded = await doc.embedPage(srcPage, box);
  const page = doc.addPage([embedded.width + FRAME * 2, embedded.height + FRAME * 2]);
  page.drawPage(embedded, {
    x: FRAME,
    y: FRAME,
    width: embedded.width,
    height: embedded.height,
  });
  if (rotation) page.setRotation(degrees(rotation));
  doc.setTitle(title.replace(/\.pdf$/i, ""));
  doc.setCreator("Schnittkante");
  return doc.save();
}

function placeOf(panel: Panel, detection: SheetDetection): string {
  if (detection.panels.length === 1) return "ganze Seite";
  if (detection.rotation === 90 || detection.rotation === 270) {
    return panel.row === 0 ? "oben" : "unten";
  }
  const paired = detection.panels.some((item) => item.col === 1);
  if (!paired) return panel.row === 0 ? "oben" : "unten";
  if (detection.panels.length === 2) return panel.col === 0 ? "links" : "rechts";
  return PLACES[panel.row * 2 + panel.col] ?? "Ausschnitt";
}

function pageFileName(index: number, sheet: number, place: string) {
  const n = String(index).padStart(2, "0");
  return `${n}-bogen${sheet}-${slug(place)}.pdf`;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function panelToPdf(
  sheet: SheetCache,
  panel: Panel,
): { left: number; bottom: number; right: number; top: number } {
  const sx = sheet.pdfWidth / sheet.width;
  const sy = sheet.pdfHeight / sheet.height;
  const left = clamp(panel.x * sx, 0, sheet.pdfWidth);
  const right = clamp((panel.x + panel.w) * sx, 0, sheet.pdfWidth);
  const top = clamp(sheet.pdfHeight - panel.y * sy, 0, sheet.pdfHeight);
  const bottom = clamp(sheet.pdfHeight - (panel.y + panel.h) * sy, 0, sheet.pdfHeight);
  return { left, bottom, right, top };
}

function cropUrl(canvas: HTMLCanvasElement, panel: Panel, rotation: PageRotation = 0): string {
  const maxW = 760;
  const wide = rotation === 90 || rotation === 270;
  const scale = Math.min(1, maxW / (wide ? panel.h : panel.w));
  const dw = Math.max(1, Math.round(panel.w * scale));
  const dh = Math.max(1, Math.round(panel.h * scale));
  const out = document.createElement("canvas");
  out.width = wide ? dh : dw;
  out.height = wide ? dw : dh;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/jpeg", 0.8);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.save();
  if (rotation === 270) {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  } else if (rotation === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(canvas, panel.x, panel.y, panel.w, panel.h, 0, 0, dw, dh);
  ctx.restore();
  return out.toDataURL("image/jpeg", 0.86);
}

function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value));
}

export function stripExt(name: string) {
  return name.replace(/\.pdf$/i, "") || "bogen";
}

export function downloadName(name: string) {
  return `${stripExt(name)}-einzelseiten.zip`;
}

