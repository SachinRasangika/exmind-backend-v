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

function parseExpiryDate(text: string): Date | null {
  const normalized = text.toLowerCase();

  const ymd = normalized.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const dmy = normalized.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const named = normalized.match(
    /\b(\d{1,2})\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(20\d{2})\b/,
  );
  if (named) {
    const month = monthMap[named[2]];
    const d = new Date(Number(named[3]), month, Number(named[1]));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
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

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("Missing uploaded file", 400);
  }

  try {
    const bytes = await file.arrayBuffer();
    const result = await recognize(Buffer.from(bytes), "eng", {
      workerPath: tesseractWorkerPath,
    });

    const text = result.data.text ?? "";
    const expiryDate = parseExpiryDate(text);
    const confidence = Math.round(result.data.confidence ?? 0);

    return ok({
      detectedText: text,
      detectedName: inferName(text),
      detectedType: inferType(text),
      detectedExpiryDate: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
      confidence,
    });
  } catch (error) {
    return fail("OCR processing failed", 500, String(error));
  }
}
