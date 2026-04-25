import { fail, ok } from "@/lib/http";
import { recognize } from "tesseract.js";

export const runtime = "nodejs";
const tesseractWorkerPath =
  process.cwd() + "/node_modules/tesseract.js/src/worker-script/node/index.js";

const monthMap: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function asIsoDate(year: number, monthZero: number, day: number): Date | null {
  const d = new Date(year, monthZero, day);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() != year || d.getMonth() != monthZero || d.getDate() != day) {
    return null;
  }
  return d;
}

function clampFutureBias(date: Date): number {
  const now = new Date();
  const deltaDays = Math.floor((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  // Expiry dates are usually close-ish to now; prefer near-future over far-past.
  if (deltaDays >= 0 && deltaDays <= 3650) return 3;
  if (deltaDays >= -365 && deltaDays < 0) return 2;
  if (deltaDays > 3650) return 1;
  return 0;
}

type DateCandidate = { date: Date; score: number; index: number };
type FusedCandidate = {
  date: string;
  score: number;
  reasons: string[];
  sources: string[];
};

type OcrWordBox = {
  text?: string;
  bbox?: {
    x0?: number;
    y0?: number;
    x1?: number;
    y1?: number;
  };
};

type OcrRect = { left: number; top: number; width: number; height: number };
type OcrPass = { label: string; rect?: OcrRect; text: string };

function collectDateCandidates(text: string, baseScore = 0): DateCandidate[] {
  const normalized = text.toLowerCase();
  const candidates: DateCandidate[] = [];
  const pushCandidate = (date: Date | null, score: number, index: number) => {
    if (!date) return;
    candidates.push({
      date,
      score: score + baseScore + clampFutureBias(date),
      index,
    });
  };
  // YYYY-MM-DD / YYYY/MM/DD
  for (const m of normalized.matchAll(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/g)) {
    pushCandidate(
      asIsoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
      8,
      m.index ?? 0,
    );
  }

  // DD-MM-YYYY (and YY fallback with 20xx bias)
  for (const m of normalized.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const yRaw = Number(m[3]);
    const year = yRaw < 100 ? 2000 + yRaw : yRaw;
    pushCandidate(asIsoDate(year, month, day), 7, m.index ?? 0);
  }

  // DD Mon YYYY
  for (const m of normalized.matchAll(
    /\b(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{2,4})\b/g,
  )) {
    const yearRaw = Number(m[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    pushCandidate(asIsoDate(year, monthMap[m[2]], Number(m[1])), 8, m.index ?? 0);
  }

  // Mon DD YYYY
  for (const m of normalized.matchAll(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2}),?\s+(\d{2,4})\b/g,
  )) {
    const yearRaw = Number(m[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    pushCandidate(asIsoDate(year, monthMap[m[1]], Number(m[2])), 8, m.index ?? 0);
  }

  return candidates;
}

function parseExpiryDate(text: string): Date | null {
  const normalized = text.toLowerCase();
  const candidates: DateCandidate[] = [];

  const positiveContext = [
    "exp",
    "expiry",
    "expires",
    "valid until",
    "best before",
    "use by",
    "due",
    "deadline",
    "renew",
    "e.d",
    "ed:",
  ];
  const negativeContext = [
    "issued",
    "issue date",
    "dob",
    "birth",
    "manufactured",
    "mfg",
    "invoice",
    "bill date",
    "created",
    "updated",
    "start date",
    "from",
  ];

  const contextScore = (index: number) => {
    const left = Math.max(0, index - 30);
    const right = Math.min(normalized.length, index + 45);
    const window = normalized.slice(left, right);
    let delta = 0;
    for (const k of positiveContext) {
      if (window.includes(k)) delta += 3;
    }
    for (const k of negativeContext) {
      if (window.includes(k)) delta -= 4;
    }
    return delta;
  };

  const yearScore = (d: Date) => {
    // Expiry/deadlines are rarely before 2000 or absurdly far future.
    if (d.getFullYear() < 2000) return -8;
    if (d.getFullYear() > 2100) return -6;
    return 0;
  };

  // Prioritize dates appearing near expiry-style keywords.
  const keywordPatterns = [
    /(?:\b(?:e\.?d|exp(?:iry)?\.?|expires?|expiry|valid\s*until|validity|renew(?:al)?(?:\s*date)?|due)\b)\s*[:\-]?\s*([^\n]{0,60})/gi,
  ];
  for (const pattern of keywordPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(normalized)) != null) {
      candidates.push(...collectDateCandidates(m[1], 10));
    }
  }

  candidates.push(...collectDateCandidates(normalized, 0));
  if (candidates.length == 0) return null;
  const rescored = candidates.map((c) => ({
    ...c,
    score: c.score + contextScore(c.index) + yearScore(c.date),
  }));

  // Deduplicate same date values and keep strongest score for each.
  const byDate = new Map<string, DateCandidate>();
  for (const c of rescored) {
    const key = c.date.toISOString().slice(0, 10);
    const prev = byDate.get(key);
    if (!prev || c.score > prev.score) {
      byDate.set(key, c);
    }
  }
  const unique = [...byDate.values()];

  // If only one date exists, it is likely the expiry/deadline date.
  if (unique.length == 1) return unique[0].date;

  // If there are multiple dates, prefer the last one in text unless a much
  // stronger keyword-scored candidate exists.
  const byScore = [...unique].sort((a, b) => b.score - a.score);
  const best = byScore[0];
  const lastByPosition = [...unique].sort((a, b) => b.index - a.index)[0];
  if (lastByPosition.score + 2 >= best.score) {
    return lastByPosition.date;
  }
  return best.date;
}

function normalizeDateString(v?: string | null): string | null {
  const raw = (v ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ymd = raw.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (ymd) {
    const yyyy = Number(ymd[1]);
    const mm = Number(ymd[2]);
    const dd = Number(ymd[3]);
    const d = asIsoDate(yyyy, mm - 1, dd);
    if (d) return d.toISOString().slice(0, 10);
  }

  const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yRaw = Number(dmy[3]);
    const yyyy = yRaw < 100 ? 2000 + yRaw : yRaw;
    const d = asIsoDate(yyyy, mm - 1, dd);
    if (d) return d.toISOString().slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function estimateOcrExpiryConfidence(text: string, detected: string | null): number {
  if (!detected) return 0;
  const normalized = text.toLowerCase();
  let score = 55;
  const dateCount = [
    ...normalized.matchAll(/\b(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/g),
  ].length;
  if (dateCount == 1) score += 12;
  if (dateCount >= 3) score -= 12;
  if (/\b(exp|expiry|expires|valid until|due|deadline|renew)\b/i.test(normalized)) score += 15;
  if (/\b(issue|issued|mfg|manufactured|dob|birth)\b/i.test(normalized)) score -= 8;
  return Math.max(0, Math.min(100, score));
}

type VisionDateResult = {
  expiryDate: string | null;
  confidence: number;
};

async function extractExpiryDateFromVision(params: {
  apiKey: string;
  bytes: ArrayBuffer;
  mimeType: string;
  ocrText: string;
  passDetails?: OcrPass[];
}): Promise<VisionDateResult | null> {
  const { apiKey, bytes, mimeType, ocrText, passDetails } = params;
  const passBlock =
    passDetails == null || passDetails.length == 0
      ? ""
      : passDetails
          .map((p, i) => {
            const r = p.rect;
            const where =
              r == null
                ? "full frame"
                : `rect(left=${r.left}, top=${r.top}, width=${r.width}, height=${r.height})`;
            return `- [${i + 1}] ${p.label} @ ${where}\n${p.text.slice(0, 1800)}`;
          })
          .join("\n\n");
  const prompt = [
    "Read this document image and extract the expiry/deadline date.",
    'Return ONLY JSON: {"expiryDate":"YYYY-MM-DD"|null,"confidence":0..100}',
    "Rules:",
    "- Prefer labels: ED, EXP, Expiry, Expires, Valid Until, Due, Deadline.",
    "- Ignore issue date, DOB, manufactured date unless no expiry-like date exists.",
    "- If uncertain, return expiryDate as null and confidence <= 50.",
    "- Use OCR snippets from different scan regions to infer document structure and date position.",
    "- If multiple candidate dates conflict, prioritize expiry-like labels near the most plausible region.",
    "",
    "OCR context (may contain errors):",
    ocrText.slice(0, 5000),
    passBlock.isEmpty ? "" : "",
    passBlock.isEmpty ? "" : "Multi-pass OCR snippets with region positions:",
    passBlock,
  ].join("\n");

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const encoded = Buffer.from(bytes).toString("base64");
  const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mimeType || "image/jpeg", data: encoded } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const parsed = JSON.parse(raw.slice(first, last + 1)) as Record<string, unknown>;
  const date = normalizeDateString(typeof parsed.expiryDate === "string" ? parsed.expiryDate : null);
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
      : 0;
  return { expiryDate: date, confidence };
}

function chooseHybridExpiryDate(params: {
  ocrDate: string | null;
  ocrConfidence: number;
  visionDate: string | null;
  visionConfidence: number;
}) {
  const { ocrDate, ocrConfidence, visionDate, visionConfidence } = params;
  if (!ocrDate && !visionDate) return null;
  if (ocrDate && !visionDate) return ocrDate;
  if (!ocrDate && visionDate) return visionDate;
  if (ocrDate == visionDate) return ocrDate;

  if (visionConfidence >= ocrConfidence + 15) return visionDate;
  if (ocrConfidence >= visionConfidence + 15) return ocrDate;

  // Tie-breaker: expiry is commonly the later operational date.
  const o = new Date(ocrDate!);
  const v = new Date(visionDate!);
  return v.getTime() >= o.getTime() ? visionDate : ocrDate;
}

function extractLineScopedCandidates(text: string): Array<{ date: string; score: number; reason: string }> {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out: Array<{ date: string; score: number; reason: string }> = [];
  const labelRegex = /\b(exp|expiry|expires|valid until|due|deadline|renew|e\.?d)\b/i;
  const dateRegexes = [
    /\b(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/g,
    /\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/g,
    /\b(\d{1,2}\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{2,4})\b/gi,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasLabel = labelRegex.test(line);
    const window = `${line} ${lines[i + 1] ?? ""}`;
    for (const rx of dateRegexes) {
      let m: RegExpExecArray | null;
      while ((m = rx.exec(window)) != null) {
        const iso = normalizeDateString(m[1]);
        if (!iso) continue;
        out.push({
          date: iso,
          score: hasLabel ? 82 : 68,
          reason: hasLabel ? "line_with_expiry_label" : "line_date_candidate",
        });
      }
    }
  }
  return out;
}

function fuseExpiryCandidates(params: {
  ocrDate: string | null;
  ocrConfidence: number;
  visionDate: string | null;
  visionConfidence: number;
  text: string;
}): { finalDate: string | null; top: FusedCandidate[]; pickedSource: string } {
  const { ocrDate, ocrConfidence, visionDate, visionConfidence, text } = params;
  const bucket = new Map<string, FusedCandidate>();
  const add = (date: string | null, score: number, source: string, reason: string) => {
    if (!date) return;
    const prev = bucket.get(date) ?? { date, score: 0, reasons: [], sources: [] };
    prev.score += score;
    if (!prev.reasons.includes(reason)) prev.reasons.push(reason);
    if (!prev.sources.includes(source)) prev.sources.push(source);
    bucket.set(date, prev);
  };

  add(ocrDate, ocrConfidence, "ocr", "ocr_primary");
  add(visionDate, visionConfidence, "vision", "vision_primary");
  for (const c of extractLineScopedCandidates(text)) {
    add(c.date, c.score, "line_context", c.reason);
  }

  const list = [...bucket.values()];
  if (list.length == 0) return { finalDate: null, top: [], pickedSource: "none" };

  // Agreement bonus: same date seen by multiple methods.
  for (const c of list) {
    if (c.sources.length >= 2) c.score += 20;
    if (c.sources.length >= 3) c.score += 15;
  }

  list.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  const best = list[0];
  const pickedSource = best.sources.join("+");
  return { finalDate: best.date, top: list.slice(0, 3), pickedSource };
}

function inferType(text: string) {
  const t = text.toLowerCase();
  if (t.includes("insurance")) return "insurance";
  if (t.includes("warranty")) return "warranty";
  if (t.includes("membership")) return "membership";
  if (t.includes("subscription")) return "subscription";
  if (t.includes("license") || t.includes("licence")) return "license";
  return "other";
}

function inferName(text: string) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3);
  if (!lines.length) return "Scanned Document";
  return lines[0].slice(0, 80);
}

function dateVariants(iso: string): Set<string> {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  if (!y || !m || !d) return new Set([iso]);
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y).slice(-2);
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const mon = months[m - 1] ?? "";
  const out = new Set<string>([
    `${y}-${mm}-${dd}`,
    `${y}/${mm}/${dd}`,
    `${dd}-${mm}-${y}`,
    `${dd}/${mm}/${y}`,
    `${dd}-${mm}-${yy}`,
    `${dd}/${mm}/${yy}`,
    `${mon} ${d} ${y}`,
    `${d} ${mon} ${y}`,
  ]);
  return out;
}

function normalizeLoose(v: string): string {
  return v
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeDateToken(t: string): boolean {
  const n = normalizeLoose(t);
  return /\d/.test(n) || monthMap[n] !== undefined;
}

function expiryBoundingBoxFromWords(
  finalDateIso: string | null,
  words: OcrWordBox[] | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (!finalDateIso || !words || words.length === 0) return null;
  const variants = [...dateVariants(finalDateIso)].map(normalizeLoose);
  const cleanWords = words
    .map((w) => ({
      text: normalizeLoose(w.text ?? ""),
      x0: w.bbox?.x0 ?? 0,
      y0: w.bbox?.y0 ?? 0,
      x1: w.bbox?.x1 ?? 0,
      y1: w.bbox?.y1 ?? 0,
    }))
    .filter((w) => w.text.length > 0);

  const positiveCtx = [
    "exp",
    "expiry",
    "expires",
    "valid",
    "until",
    "best",
    "before",
    "use",
    "by",
    "due",
  ];

  let best:
    | {
        score: number;
        x0: number;
        y0: number;
        x1: number;
        y1: number;
        area: number;
      }
    | undefined;

  for (let i = 0; i < cleanWords.length; i++) {
    // Keep spans tight so highlight focuses on date only.
    const maxSpan = Math.min(cleanWords.length, i + 4);
    for (let j = i; j < maxSpan; j++) {
      const segment = cleanWords.slice(i, j + 1);
      const joined = normalizeLoose(segment.map((s) => s.text).join(" "));
      const dateishCount = segment.filter((s) => looksLikeDateToken(s.text)).length;
      let score = 0;
      const exact = variants.includes(joined);
      const contains = variants.some((v) => joined.includes(v));
      const approx = variants.some((v) => v.includes(joined));
      if (exact) score += 120;
      else if (contains) score += 75;
      else if (approx) score += 25;
      if (dateishCount >= 2) score += 10;

      // Context boost from words just before the matched span.
      const ctxStart = Math.max(0, i - 4);
      const ctx = cleanWords
        .slice(ctxStart, i)
        .map((w) => w.text)
        .join(" ");
      if (positiveCtx.some((k) => ctx.includes(k))) score += 18;

      // Penalize long spans so we highlight only date token(s).
      score -= (segment.length - 1) * 9;
      if (score <= 0) continue;
      const x0 = segment.map((s) => s.x0).reduce((a, b) => a < b ? a : b);
      const y0 = segment.map((s) => s.y0).reduce((a, b) => a < b ? a : b);
      const x1 = segment.map((s) => s.x1).reduce((a, b) => a > b ? a : b);
      const y1 = segment.map((s) => s.y1).reduce((a, b) => a > b ? a : b);
      if (x1 <= x0 || y1 <= y0) continue;
      const area = (x1 - x0) * (y1 - y0);
      if (
        best == null ||
        score > best.score ||
        (score == best.score && area < best.area)
      ) {
        best = { score, x0, y0, x1, y1, area };
      }
    }
  }

  if (best == null) return null;
  // Tight padding around detected date area (few pixels only).
  const pad = 2;
  const x = Math.max(0, best.x0 - pad);
  const y = Math.max(0, best.y0 - pad);
  const width = Math.max(1, best.x1 - best.x0 + pad * 2);
  const height = Math.max(1, best.y1 - best.y0 + pad * 2);
  return {
    x,
    y,
    width,
    height,
  };
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("Missing uploaded file", 400);
  }

  try {
    const bytes = await file.arrayBuffer();
    const imageBuf = Buffer.from(bytes);
    const full = await recognize(imageBuf, "eng", {
      workerPath: tesseractWorkerPath,
    });

    const width = full.data.imageSize?.width ?? 0;
    const height = full.data.imageSize?.height ?? 0;
    const hasSize = width > 0 && height > 0;
    const passRects: Array<{ label: string; rect: OcrRect }> = hasSize
      ? [
          // top half
          {
            label: "top_half",
            rect: { left: 0, top: 0, width, height: Math.floor(height / 2) },
          },
          // bottom half
          {
            label: "bottom_half",
            rect: {
              left: 0,
              top: Math.floor(height / 2),
              width,
              height: height - Math.floor(height / 2),
            },
          },
          // left (portrait) half
          {
            label: "left_half",
            rect: { left: 0, top: 0, width: Math.floor(width / 2), height },
          },
          // right (portrait) half
          {
            label: "right_half",
            rect: {
              left: Math.floor(width / 2),
              top: 0,
              width: width - Math.floor(width / 2),
              height,
            },
          },
        ]
      : [];

    const passResults: OcrPass[] = [
      { label: "full_frame", text: full.data.text ?? "" },
    ];
    for (const pRect of passRects) {
      try {
        const p = await recognize(imageBuf, "eng", {
          workerPath: tesseractWorkerPath,
          rectangle: pRect.rect,
        });
        const t = p.data.text?.trim() ?? "";
        if (t.length > 0) {
          passResults.push({
            label: pRect.label,
            rect: pRect.rect,
            text: t,
          });
        }
      } catch {
        // Keep pipeline resilient if a regional pass fails.
      }
    }
    const passTexts = passResults.map((p) => p.text);
    const text = passTexts.join("\n");

    let bestOcrDate: string | null = null;
    let bestOcrDateConfidence = 0;
    for (const t of passTexts) {
      const d = parseExpiryDate(t);
      const iso = d ? d.toISOString().slice(0, 10) : null;
      const c = estimateOcrExpiryConfidence(t, iso);
      if (c > bestOcrDateConfidence) {
        bestOcrDate = iso;
        bestOcrDateConfidence = c;
      }
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    let visionDate: string | null = null;
    let visionDateConfidence = 0;
    if (apiKey) {
      try {
        const vision = await extractExpiryDateFromVision({
          apiKey,
          bytes,
          mimeType: file.type || "image/jpeg",
          ocrText: passTexts.join("\n"),
          passDetails: passResults,
        });
        visionDate = vision?.expiryDate ?? null;
        visionDateConfidence = vision?.confidence ?? 0;
      } catch {
        // Keep OCR result if vision extraction fails.
      }
    }
    const hybridDate = chooseHybridExpiryDate({
      ocrDate: bestOcrDate,
      ocrConfidence: bestOcrDateConfidence,
      visionDate,
      visionConfidence: visionDateConfidence,
    });
    const fused = fuseExpiryCandidates({
      ocrDate: hybridDate ?? bestOcrDate,
      ocrConfidence: Math.max(bestOcrDateConfidence, 60),
      visionDate,
      visionConfidence: visionDateConfidence,
      text,
    });
    const confidence = Math.round(full.data.confidence ?? 0);
    const expiryBoundingBox = expiryBoundingBoxFromWords(
      fused.finalDate,
      full.data.words as OcrWordBox[] | undefined,
    );

    return ok({
      detectedText: text,
      detectedName: inferName(text),
      detectedType: inferType(text),
      detectedExpiryDate: fused.finalDate,
      confidence,
      expiryCandidates: fused.top,
      expiryPickedSource: fused.pickedSource,
      expiryBoundingBox,
    });
  } catch (error) {
    return fail("OCR processing failed", 500, String(error));
  }
}
