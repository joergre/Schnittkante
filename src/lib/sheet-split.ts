/** Detect the paper edges of a 4-up (2×2) scan and return one box per page. */

export type RowCut = {
  top: number;
  bottom: number;
  left: number;
  fold: number;
  right: number;
  /** 2 = left and right of the fold. 1 = the whole row is one page. */
  columns?: 1 | 2;
};

export type Panel = {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
};

export type SplitConfidence = "edges" | "gutter" | "grid" | "single";

export type SplitMode = "quad" | "duo" | "duo90" | "single";

export type PageRotation = 0 | 90 | 180 | 270;

export type SheetDetection = {
  panels: Panel[];
  rows: RowCut[] | null;
  confidence: SplitConfidence;
  rotation: PageRotation;
};

type AxisLine = { a: number; b: number; at: number; iso: number; frac: number };

const DARK = 243;

export function grayFromRgba(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8;
  }
  return gray;
}

export function panelsFromRows(rows: RowCut[]): Panel[] {
  const panels: Panel[] = [];
  rows.forEach((row, ri) => {
    const height = Math.max(1, row.bottom - row.top);
    if ((row.columns ?? 2) === 1) {
      panels.push({
        x: row.left,
        y: row.top,
        w: Math.max(1, row.right - row.left),
        h: height,
        row: ri,
        col: 0,
      });
      return;
    }
    panels.push({
      x: row.left,
      y: row.top,
      w: Math.max(1, row.fold - row.left),
      h: height,
      row: ri,
      col: 0,
    });
    panels.push({
      x: row.fold,
      y: row.top,
      w: Math.max(1, row.right - row.fold),
      h: height,
      row: ri,
      col: 1,
    });
  });
  return panels;
}

export function detectSheet(
  gray: Uint8Array,
  width: number,
  height: number,
  mode: SplitMode = "quad",
  even = false,
): SheetDetection {
  if (mode === "single") return detectSingle(gray, width, height);
  if (mode === "duo") return detectDuo(gray, width, height, even);
  if (mode === "duo90") return detectDuo90(gray, width, height, even);

  if (!even) {
    const ruled = detectByRules(gray, width, height);
    if (ruled) return pack(ruled, "edges", 0);
    const gutter = detectByGutter(gray, width, height);
    if (gutter) return pack(gutter, "gutter", 0);
  }
  return pack(equalGrid(gray, width, height), "grid", 0);
}

function pack(rows: RowCut[], confidence: SplitConfidence, rotation: PageRotation): SheetDetection {
  return { panels: panelsFromRows(rows), rows, confidence, rotation };
}

function detectSingle(gray: Uint8Array, width: number, height: number): SheetDetection {
  const box = paddedContent(gray, width, height);
  const row: RowCut = {
    top: box.top,
    bottom: box.bottom,
    left: box.left,
    fold: box.right,
    right: box.right,
    columns: 1,
  };
  return pack([row], "single", 0);
}

function detectDuo(gray: Uint8Array, width: number, height: number, even: boolean): SheetDetection {
  const box = paddedContent(gray, width, height);
  let fold = (box.left + box.right) / 2;
  let confidence: SplitConfidence = "grid";
  if (!even) {
    const colFrac = fracAlongCols(gray, width, box.top, box.bottom, DARK);
    const central = isolatedLines(colFrac, 0.22, 0.18, 16, 3, 8).filter(
      (line) => line.at > width * 0.28 && line.at < width * 0.72,
    );
    const line = closestLine(central, fold) ?? strongest(central);
    if (line) {
      fold = line.at;
      confidence = "edges";
    } else {
      fold = valleyAt(colFrac, Math.round(width * 0.35), Math.round(width * 0.65));
      confidence = "gutter";
    }
  }
  const row: RowCut = {
    top: box.top,
    bottom: box.bottom,
    left: box.left,
    fold,
    right: box.right,
    columns: 2,
  };
  return pack([row], confidence, 0);
}

function detectDuo90(gray: Uint8Array, width: number, height: number, even: boolean): SheetDetection {
  const box = paddedContent(gray, width, height);
  let split = (box.top + box.bottom) / 2;
  let confidence: SplitConfidence = "grid";
  if (!even) {
    const rowFrac = fracAlongRows(gray, width, height, DARK);
    const central = isolatedLines(rowFrac, 0.22, 0.18, 16, 3, 8).filter(
      (line) => line.at > height * 0.28 && line.at < height * 0.72,
    );
    const line = closestLine(central, split) ?? strongest(central);
    if (line) {
      split = line.at;
      confidence = "edges";
    } else {
      split = valleyAt(rowFrac, Math.round(height * 0.35), Math.round(height * 0.65));
      confidence = "gutter";
    }
  }
  const rows: RowCut[] = [
    { top: box.top, bottom: split, left: box.left, fold: box.right, right: box.right, columns: 1 },
    { top: split, bottom: box.bottom, left: box.left, fold: box.right, right: box.right, columns: 1 },
  ];
  return pack(rows, confidence, 270);
}

function paddedContent(gray: Uint8Array, width: number, height: number) {
  const box = contentBox(gray, width, height, 0, 0, width, height) ?? {
    left: Math.round(width * 0.04),
    top: Math.round(height * 0.04),
    right: Math.round(width * 0.96),
    bottom: Math.round(height * 0.96),
  };
  const pad = Math.round(Math.min(width, height) * 0.012);
  return {
    left: Math.max(0, box.left - pad),
    top: Math.max(0, box.top - pad),
    right: Math.min(width - 1, box.right + pad),
    bottom: Math.min(height - 1, box.bottom + pad),
  };
}

function detectByRules(gray: Uint8Array, width: number, height: number): RowCut[] | null {
  const rowFrac = fracAlongRows(gray, width, height, DARK);
  const lines = isolatedLines(rowFrac, 0.4, 0.42, 18, 5, 8);
  const tagged = lines
    .map((line) => ({ ...line, kind: classifyHorizontal(rowFrac, line.at) }))
    .filter((line): line is AxisLine & { kind: "top" | "bottom" } => line.kind !== "unknown");

  const bottoms = mergeClose(
    tagged.filter((line) => line.kind === "bottom").sort((a, b) => a.at - b.at),
    height * 0.08,
  );
  if (bottoms.length < 2) return null;

  const tops = tagged.filter((line) => line.kind === "top");
  const rows: RowCut[] = [];
  let prevEnd = 0;

  for (const bottom of bottoms) {
    const zoneStart = prevEnd + 4;
    const topLine = tops
      .filter((line) => line.at > zoneStart + 8 && line.at < bottom.at - height * 0.12)
      .sort((a, b) => b.at - a.at)[0];

    const searchY0 = Math.min(bottom.a - 20, Math.max(zoneStart, (topLine?.b ?? zoneStart) + 2));
    const searchY1 = Math.max(searchY0 + 24, bottom.a - 2);
    const colFrac = fracAlongCols(gray, width, searchY0, searchY1, DARK);
    const vlines = isolatedLines(colFrac, 0.22, 0.18, 16, 3, 8);
    const rightLine = strongest(vlines.filter((line) => line.at > width * 0.68));
    const leftLine = strongest(vlines.filter((line) => line.at < width * 0.32));
    const right = rightLine ? rightLine.b : lastDark(colFrac, 0.012, width - 1);
    const central = vlines.filter((line) => {
      if (leftLine && Math.abs(line.at - leftLine.at) < 8) return false;
      if (rightLine && Math.abs(line.at - rightLine.at) < 8) return false;
      return line.at > width * 0.28 && line.at < width * 0.72;
    });
    const anchor =
      leftLine && rightLine ? (leftLine.at + rightLine.at) / 2 : leftLine ? (leftLine.at + right) / 2 : width / 2;
    const foldLine = closestLine(central, anchor) ?? strongest(central);
    const foldAt = foldLine ? foldLine.at : valleyAt(colFrac, Math.round(width * 0.35), Math.round(width * 0.65));
    const left = leftLine && leftLine.at < foldAt - 24 ? leftLine.a : Math.max(2, foldAt - (right - foldAt));

    const content = contentBox(gray, width, height, left + 6, zoneStart, right - 6, bottom.a - 6);
    let top = topLine ? Math.max(zoneStart, topLine.a - 1) : zoneStart;
    if (!topLine && content) {
      const margin = Math.max(8, bottom.a - content.bottom);
      top = content.top - Math.max(margin, Math.round(height * 0.012));
      const pageW = Math.max(foldAt - left, right - foldAt);
      const minH = Math.round(pageW * 1.22);
      if (bottom.b - top < minH) top = bottom.b - minH;
      top = Math.min(top, content.top - 8);
      top = Math.max(zoneStart, top);
    }

    const pad = 2;
    rows.push({
      top: Math.max(0, Math.round(top) - (rows.length === 0 ? pad : 0)),
      bottom: Math.min(height - 1, bottom.b + pad),
      left: Math.max(0, left - pad),
      fold: foldAt,
      right: Math.min(width - 1, right + pad),
    });
    prevEnd = bottom.b + 1;
  }

  const usable = rows.filter(
    (row) => row.right - row.left > width * 0.2 && row.bottom - row.top > height * 0.12 && row.fold > row.left + 16 && row.fold < row.right - 16,
  );
  if (usable.length < 2) return null;
  return usable.slice(0, 2);
}

function detectByGutter(gray: Uint8Array, width: number, height: number): RowCut[] | null {
  const rowFrac = fracAlongRows(gray, width, height, 230);
  const runs = whiteRuns(rowFrac, 0.005, Math.round(height * 0.018));
  const central = runs.filter((run) => run.mid > height * 0.34 && run.mid < height * 0.66);
  if (central.length === 0) return null;
  central.sort((a, b) => b.w - a.w);
  const gap = central[0];
  if (!gap || gap.w < height * 0.02) return null;

  const top = bandToRow(gray, width, height, 0, gap.a, true);
  const bottom = bandToRow(gray, width, height, gap.b, height, false);
  if (!top || !bottom) return null;
  return [top, bottom];
}

function bandToRow(
  gray: Uint8Array,
  width: number,
  height: number,
  y0: number,
  y1: number,
  isTop: boolean,
): RowCut | null {
  const box = contentBox(gray, width, height, 0, y0, width, y1);
  if (!box) return null;
  const colFrac = fracAlongCols(gray, width, box.top, box.bottom, 230);
  const vlines = isolatedLines(colFrac, 0.2, 0.12, 14, 3, 8);
  const foldLine = strongest(
    vlines.filter((line) => line.at > box.left + (box.right - box.left) * 0.3 && line.at < box.left + (box.right - box.left) * 0.7),
  );
  const runs = whiteRuns(colFrac, 0.008, 10).filter(
    (run) => run.mid > width * 0.3 && run.mid < width * 0.7,
  );
  runs.sort((a, b) => b.w - a.w);
  const fold = foldLine?.at ?? runs[0]?.mid ?? Math.round((box.left + box.right) / 2);
  const pad = Math.round(Math.min(width, height) * 0.008);
  return {
    top: Math.max(0, box.top - pad),
    bottom: Math.min(height - 1, box.bottom + pad + (isTop ? 0 : 0)),
    left: Math.max(0, box.left - pad),
    fold: Math.round(fold),
    right: Math.min(width - 1, box.right + pad),
  };
}

function equalGrid(gray: Uint8Array, width: number, height: number): RowCut[] {
  const box = contentBox(gray, width, height, 0, 0, width, height) ?? {
    left: Math.round(width * 0.06),
    top: Math.round(height * 0.06),
    right: Math.round(width * 0.94),
    bottom: Math.round(height * 0.94),
  };
  const midY = Math.round((box.top + box.bottom) / 2);
  const midX = Math.round((box.left + box.right) / 2);
  return [
    { top: box.top, bottom: midY, left: box.left, fold: midX, right: box.right },
    { top: midY, bottom: box.bottom, left: box.left, fold: midX, right: box.right },
  ];
}

function classifyHorizontal(rowFrac: Float64Array, at: number): "top" | "bottom" | "unknown" {
  const above = meanRange(rowFrac, at - 36, at - 6);
  const below = meanRange(rowFrac, at + 6, at + 36);
  if (below < 0.02 && above > 0.008) return "bottom";
  if (above < 0.02 && below > 0.008) return "top";
  return "unknown";
}

function mergeClose(lines: AxisLine[], minDist: number): AxisLine[] {
  const out: AxisLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && line.at - prev.at < minDist) {
      if (line.iso > prev.iso) out[out.length - 1] = line;
    } else {
      out.push(line);
    }
  }
  return out;
}

function strongest(lines: AxisLine[]): AxisLine | null {
  let best: AxisLine | null = null;
  for (const line of lines) if (!best || line.iso > best.iso) best = line;
  return best;
}

function closestLine(lines: AxisLine[], anchor: number): AxisLine | null {
  let best: AxisLine | null = null;
  for (const line of lines) {
    if (!best) {
      best = line;
      continue;
    }
    const dist = Math.abs(line.at - anchor);
    const bestDist = Math.abs(best.at - anchor);
    if (dist < bestDist - 8 || (Math.abs(dist - bestDist) <= 8 && line.iso > best.iso)) best = line;
  }
  return best;
}

function valleyAt(frac: Float64Array, lo: number, hi: number): number {
  const radius = 9;
  let best = lo;
  let bestVal = Number.POSITIVE_INFINITY;
  for (let i = lo; i < hi; i++) {
    let sum = 0;
    let n = 0;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j < 0 || j >= frac.length) continue;
      sum += frac[j];
      n++;
    }
    const v = sum / Math.max(1, n);
    if (v < bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}

function lastDark(frac: Float64Array, min: number, fallback: number): number {
  for (let i = frac.length - 1; i >= 0; i--) if (frac[i] > min) return i;
  return fallback;
}

function isolatedLines(
  frac: Float64Array,
  isoMin: number,
  fracMin: number,
  rad: number,
  gapInner: number,
  clusterGap: number,
): AxisLine[] {
  const n = frac.length;
  const iso = new Float64Array(n);
  const window: number[] = [];
  for (let i = rad; i < n - rad; i++) {
    window.length = 0;
    for (let j = i - rad; j <= i - gapInner; j++) window.push(frac[j]);
    for (let j = i + gapInner + 1; j <= i + rad; j++) window.push(frac[j]);
    window.sort((a, b) => a - b);
    iso[i] = frac[i] - window[window.length >> 1];
  }

  const lines: AxisLine[] = [];
  let start = -1;
  let prev = -1;
  const flush = (a: number, b: number) => {
    let at = a;
    for (let i = a + 1; i <= b; i++) if (iso[i] > iso[at]) at = i;
    lines.push({ a, b, at, iso: iso[at], frac: frac[at] });
  };

  for (let i = 0; i < n; i++) {
    if (!(iso[i] > isoMin && frac[i] > fracMin)) continue;
    if (start < 0) {
      start = prev = i;
      continue;
    }
    if (i > prev + clusterGap) {
      flush(start, prev);
      start = i;
    }
    prev = i;
  }
  if (start >= 0) flush(start, prev);
  return lines;
}

function fracAlongRows(gray: Uint8Array, width: number, height: number, thresh: number): Float64Array {
  const frac = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let dark = 0;
    for (let x = 0; x < width; x++) if (gray[row + x] < thresh) dark++;
    frac[y] = dark / width;
  }
  return frac;
}

function fracAlongCols(
  gray: Uint8Array,
  width: number,
  y0: number,
  y1: number,
  thresh: number,
): Float64Array {
  const frac = new Float64Array(width);
  const rows = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) if (gray[row + x] < thresh) frac[x]++;
  }
  for (let x = 0; x < width; x++) frac[x] /= rows;
  return frac;
}

function meanRange(frac: Float64Array, a: number, b: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(frac.length, b);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += frac[i];
  return sum / (hi - lo);
}

type Box = { left: number; top: number; right: number; bottom: number };

function contentBox(
  gray: Uint8Array,
  width: number,
  _height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Box | null {
  const leftBound = Math.max(0, x0);
  const rightBound = Math.min(width, x1);
  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = Math.max(0, y0); y < y1; y++) {
    if (!rowHasInk(gray, width, y, leftBound, rightBound)) continue;
    if (top < 0) top = y;
    bottom = y;
    const row = y * width;
    for (let x = leftBound; x < rightBound; x++) {
      if (gray[row + x] < 200) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (top < 0 || right < 0) return null;
  return { left, top, right, bottom };
}

function rowHasInk(gray: Uint8Array, width: number, y: number, x0: number, x1: number): boolean {
  let run = 0;
  const row = y * width;
  for (let x = x0; x < x1; x++) {
    if (gray[row + x] < 200) {
      run++;
      if (run >= 6) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function whiteRuns(frac: Float64Array, maxFrac: number, minLen: number): { a: number; b: number; w: number; mid: number }[] {
  const runs: { a: number; b: number; w: number; mid: number }[] = [];
  let start = -1;
  for (let i = 0; i <= frac.length; i++) {
    const white = i < frac.length && frac[i] < maxFrac;
    if (white && start < 0) start = i;
    if (!white && start >= 0) {
      const w = i - start;
      if (w >= minLen) runs.push({ a: start, b: i, w, mid: (start + i) / 2 });
      start = -1;
    }
  }
  return runs;
}
