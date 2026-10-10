import { cutJob, forceGrid, receivePdf, rememberRows, takeZip } from "@/lib/server-cut";
import type { RowCut, SplitMode } from "@/lib/sheet-split";

const MODES = new Set<SplitMode>(["quad", "duo", "duo90", "single"]);

export async function handleCut(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/bogen" && request.method === "POST") return await upload(request);
    if (url.pathname === "/api/raster" && request.method === "POST") return await raster(request);
    if (url.pathname === "/api/schneiden" && request.method === "POST") return await cut(request);
    if (url.pathname.startsWith("/api/zip/") && request.method === "GET") return download(url.pathname.slice("/api/zip/".length));
    return json({ error: "Nicht gefunden" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Der Schnitt ist fehlgeschlagen";
    return json({ error: message }, 400);
  }
}

async function upload(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode");
  if (!(file instanceof File)) return json({ error: "Keine PDF empfangen" }, 400);
  if (typeof mode !== "string" || !MODES.has(mode as SplitMode)) return json({ error: "Aufteilung fehlt" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const job = await receivePdf(bytes, file.name || "bogen.pdf", mode as SplitMode);
  return json(job);
}

async function raster(request: Request) {
  const body = (await request.json()) as { id?: string };
  if (!body.id) return json({ error: "Bogen fehlt" }, 400);
  return json(await forceGrid(body.id));
}

async function cut(request: Request) {
  const body = (await request.json()) as { id?: string; sheets?: { index: number; rows: RowCut[] | null }[] };
  if (!body.id) return json({ error: "Bogen fehlt" }, 400);
  if (body.sheets) rememberRows(body.id, body.sheets);
  return json(await cutJob(body.id));
}

function download(id: string) {
  const { filename, bytes } = takeZip(id);
  return new Response(bytes, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
