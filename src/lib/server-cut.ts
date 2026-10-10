import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
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
  type SplitMode,
} from "@/lib/sheet-split";

const require = createRequire(import.meta.url);
const RENDER_SCALE = 2;
const FRAME = 14;
const TTL_MS = 60 * 60 * 1000;
const PLACES = ["oben links", "oben rechts", "unten links", "unten rechts"];

type StoredSheet = {
  index: number;
  width: number;
  height: number;
  pdfWidth: number;
  pdfHeight: number;
  detection: SheetDetection;
  jpeg: Buffer;
};

type Job = {
  id: string;
  name: string;
  bytes: Uint8Array;
  sheets: StoredSheet[];
  zip?: Uint8Array;
  created: number;
};

const jobs = new Map<string, Job>();

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.created > TTL_MS) jobs.delete(id);
  }
}

function must(id: string) {
  sweep();
  const job = jobs.get(id);
  if (!job) throw new Error("Der Bogen liegt nicht mehr auf dem Server. Bitte die PDF erneut öffnen.");
  return job;
}

export type PublicSheet = {
  index: number;
  width: number;
  height: number;
  rows: RowCut[] | null;
  panels: Panel[];
  confidence: SheetDetection["confidence"];
  sheetUrl: string;
};

export function viewJob(id: string) {
  const job = must(id);
  return {
    id: job.id,
    name: job.name,
    sheets: job.sheets.map(publicSheet),
  };
}

function publicSheet(sheet: StoredSheet): PublicSheet {
  return {
    index: sheet.index,
    width: sheet.width,
    height: sheet.height,
    rows: sheet.detection.rows,
    panels: sheet.detection.panels,
    confidence: sheet.detection.confidence,
    sheetUrl: `data:image/jpeg;base64,${sheet.jpeg.toString("base64")}`,
  };
}

export async function receivePdf(bytes: Uint8Array, name: string, mode: SplitMode) {
  sweep();
  const sheets = await renderSheets(bytes, mode, false);
  const id = randomBytes(12).toString("hex");
  const job: Job = { id, name, bytes: new Uint8Array(bytes), sheets, created: Date.now() };
  jobs.set(id, job);
  return viewJob(id);
}

export async function forceGrid(id: string) {
  const job = must(id);
  job.sheets = await renderSheets(job.bytes, "quad", true);
  job.zip = undefined;
  job.created = Date.now();
  return viewJob(id);
}

export function rememberRows(id: string, incoming: { index: number; rows: RowCut[] | null }[]) {
  const job = must(id);
  for (const item of incoming) {
    const sheet = job.sheets.find((entry) => entry.index === item.index);
    if (!sheet || !item.rows) continue;
    sheet.detection = {
      ...sheet.detection,
      rows: item.rows,
      panels: panelsFromRows(item.rows),
    };
  }
  job.zip = undefined;
  return viewJob(id);
}

export async function cutJob(id: string) {
  const job = must(id);
  const pages = await pageViews(job);
  job.zip = await buildZip(job);
  job.created = Date.now();
  return {
    pages,
    download: `/api/zip/${job.id}`,
    filename: `${stripExt(job.name)}-einzelseiten.zip`,
  };
}

export function takeZip(id: string) {
  const job = must(id);
  if (!job.zip) throw new Error("Der Schnitt ist noch nicht ausgeführt.");
  return { filename: `${stripExt(job.name)}-einzelseiten.zip`, bytes: job.zip };
}

async function renderSheets(bytes: Uint8Array, mode: SplitMode, even: boolean) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  const sheets: StoredSheet[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const natural = page.getViewport({ scale: 1 });
      const longest = Math.max(natural.width, natural.height);
      const viewport = page.getViewport({ scale: Math.min(RENDER_SCALE, 2200 / longest) });
      const { createCanvas } = await import("@napi-rs/canvas");
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = grayFromRgba(image.data, canvas.width, canvas.height);
      sheets.push({
        index: i,
        width: canvas.width,
        height: canvas.height,
        pdfWidth: natural.width,
        pdfHeight: natural.height,
        detection: detectSheet(gray, canvas.width, canvas.height, mode, even),
        jpeg: canvas.toBuffer("image/jpeg", 82),
      });
    }
  } finally {
    await doc.cleanup();
  }
  return sheets;
}

async function pageViews(job: Job) {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const pages: { sheet: number; label: string; place: string; url: string }[] = [];
  let running = 0;
  for (const sheet of job.sheets) {
    const image = await loadImage(sheet.jpeg);
    for (const panel of sheet.detection.panels) {
      running += 1;
      const place = placeOf(panel, sheet.detection);
      pages.push({
        sheet: sheet.index,
        label: String(running),
        place,
        url: cropJpeg(createCanvas, image, panel, sheet.detection.rotation),
      });
    }
  }
  return pages;
}

function cropJpeg(
  createCanvas: typeof import("@napi-rs/canvas").createCanvas,
  image: Awaited<ReturnType<typeof import("@napi-rs/canvas").loadImage>>,
  panel: Panel,
  rotation: PageRotation,
) {
  const maxW = 760;
  const wide = rotation === 90 || rotation === 270;
  const scale = Math.min(1, maxW / (wide ? panel.h : panel.w));
  const dw = Math.max(1, Math.round(panel.w * scale));
  const dh = Math.max(1, Math.round(panel.h * scale));
  const canvas = createCanvas(wide ? dh : dw, wide ? dw : dh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (rotation === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  } else if (rotation === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(image, panel.x, panel.y, panel.w, panel.h, 0, 0, dw, dh);
  ctx.restore();
  return `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 82).toString("base64")}`;
}

async function buildZip(job: Job) {
  const src = await PDFDocument.load(job.bytes.slice());
  const srcPages = src.getPages();
  const entries: Record<string, Uint8Array> = {};
  let running = 0;
  for (const sheet of job.sheets) {
    const srcPage = srcPages[sheet.index - 1];
    if (!srcPage) continue;
    for (const panel of sheet.detection.panels) {
      running += 1;
      const box = panelToPdf(sheet, panel);
      if (box.right - box.left < 4 || box.top - box.bottom < 4) continue;
      const place = placeOf(panel, sheet.detection);
      const filename = pageFileName(running, sheet.index, place);
      entries[filename] = await renderPagePdf(srcPage, box, filename, sheet.detection.rotation);
    }
  }
  return zipSync(entries, { level: 0 });
}

function panelToPdf(sheet: StoredSheet, panel: Panel) {
  const sx = sheet.pdfWidth / sheet.width;
  const sy = sheet.pdfHeight / sheet.height;
  const left = clamp(panel.x * sx, 0, sheet.pdfWidth);
  const right = clamp((panel.x + panel.w) * sx, 0, sheet.pdfWidth);
  const top = clamp(sheet.pdfHeight - panel.y * sy, 0, sheet.pdfHeight);
  const bottom = clamp(sheet.pdfHeight - (panel.y + panel.h) * sy, 0, sheet.pdfHeight);
  return { left, bottom, right, top };
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
  page.drawPage(embedded, { x: FRAME, y: FRAME, width: embedded.width, height: embedded.height });
  if (rotation) page.setRotation(degrees(rotation));
  doc.setTitle(title.replace(/\.pdf$/i, ""));
  doc.setCreator("Schnittkante");
  return doc.save();
}

function placeOf(panel: Panel, detection: SheetDetection): string {
  if (detection.panels.length === 1) return "ganze Seite";
  if (detection.rotation === 90 || detection.rotation === 270) return panel.row === 0 ? "oben" : "unten";
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

function stripExt(name: string) {
  return name.replace(/\.pdf$/i, "") || "bogen";
}

function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value));
}
