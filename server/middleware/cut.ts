import { handleCut } from "../../src/lib/cut-http";

interface CutEvent {
  url: URL;
  req: Request;
}

export default async function cutMiddleware(event: CutEvent, next: () => unknown | Promise<unknown>) {
  const path = event.url.pathname;
  if (path !== "/api/bogen" && path !== "/api/raster" && path !== "/api/schneiden" && !path.startsWith("/api/zip/")) {
    return next();
  }
  const request =
    typeof event.req?.formData === "function"
      ? event.req
      : new Request(event.url, { method: "GET" });
  return handleCut(request);
}
