import { z } from "zod";
import { fail, ok } from "@/lib/http";

const reqSchema = z.object({
  ocrText: z.string().min(1),
  detectedName: z.string().optional(),
  detectedType: z.string().optional(),
  detectedExpiryDate: z.string().optional(),
});

const outSchema = z.object({
  name: z.string().nullable(),
  type: z.enum(["license", "insurance", "warranty", "membership", "subscription", "other"]),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  reasoningTags: z.array(z.string()).max(8).default([]),
});

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return raw.slice(first, last + 1);
  }
  return null;
}

function normalizeType(v?: string | null): z.infer<typeof outSchema>["type"] {
  const n = (v ?? "").toLowerCase().trim();
  if (n === "license") return "license";
  if (n === "insurance") return "insurance";
  if (n === "warranty") return "warranty";
  if (n === "membership") return "membership";
  if (n === "subscription") return "subscription";
  return "other";
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
    const d = new Date(yyyy, mm - 1, dd);
    if (d.getFullYear() == yyyy && d.getMonth() == mm - 1 && d.getDate() == dd) {
      return `${yyyy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
    }
  }

  const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yRaw = Number(dmy[3]);
    const yyyy = yRaw < 100 ? 2000 + yRaw : yRaw;
    const d = new Date(yyyy, mm - 1, dd);
    if (d.getFullYear() == yyyy && d.getMonth() == mm - 1 && d.getDate() == dd) {
      return `${yyyy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function extractDateCandidatesWithContext(ocrText: string) {
  const normalized = ocrText.toLowerCase();
  const patterns = [
    /\b(20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/g,
    /\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/g,
    /\b(\d{1,2}\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{2,4})\b/g,
    /\b((?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2},?\s+\d{2,4})\b/g,
  ];
  const out: Array<{ value: string; iso: string; context: string }> = [];
  const seen = new Set<string>();
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(normalized)) != null) {
      const raw = m[1];
      const iso = normalizeDateString(raw);
      if (!iso) continue;
      const key = `${iso}:${m.index ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const left = Math.max(0, (m.index ?? 0) - 28);
      const right = Math.min(normalized.length, (m.index ?? 0) + raw.length + 28);
      out.push({
        value: raw,
        iso,
        context: normalized.slice(left, right).replace(/\s+/g, " ").trim(),
      });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

function buildPrompt(params: {
  ocrText: string;
  detectedName: string;
  detectedType: string;
  detectedExpiryDate?: string;
  candidates: Array<{ value: string; iso: string; context: string }>;
  retryMode: boolean;
}) {
  const { ocrText, detectedName, detectedType, detectedExpiryDate, candidates, retryMode } = params;
  return [
    "Extract structured document fields from OCR text.",
    "Return ONLY valid JSON with this shape:",
    '{ "name": string|null, "type": "license"|"insurance"|"warranty"|"membership"|"subscription"|"other", "expiryDate": "YYYY-MM-DD"|null, "notes": string|null, "confidence": number, "reasoningTags": string[] }',
    "Rules:",
    "- Never hallucinate. Use null for unknown fields.",
    "- expiryDate must be strict YYYY-MM-DD.",
    "- If there are multiple dates: prefer expiry/deadline/valid-until style labels over issue/mfg/dob.",
    "- If there is one plausible date, use it as expiryDate.",
    "- If uncertain, set expiryDate=null and keep confidence <= 55.",
    '- reasoningTags must use only: ["near_exp_label","single_date","multi_date_last","issue_date_filtered","fallback_hint","low_confidence"].',
    "- Keep notes concise (max 300 chars).",
    retryMode ? "- STRICT RETRY: do not output any text outside JSON." : "",
    "",
    "Known OCR hints:",
    `detectedName=${detectedName}`,
    `detectedType=${detectedType}`,
    `detectedExpiryDate=${detectedExpiryDate ?? "null"}`,
    "",
    "Date candidates (OCR + normalization):",
    ...candidates.map((c, i) => `- [${i + 1}] raw="${c.value}" iso="${c.iso}" context="${c.context}"`),
    "",
    "OCR text:",
    ocrText.slice(0, retryMode ? 6000 : 12000),
  ]
    .filter(Boolean)
    .join("\n");
}

async function callGemini(apiKey: string, prompt: string) {
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 700,
        responseMimeType: "application/json",
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  return res;
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return fail("GOOGLE_AI_API_KEY is not configured", 500);
  }

  const body = await req.json().catch(() => null);
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const {
    ocrText,
    detectedName = "Scanned Document",
    detectedType = "other",
    detectedExpiryDate,
  } = parsed.data;
  const candidates = extractDateCandidatesWithContext(ocrText);

  try {
    let raw: Record<string, unknown> | null = null;
    let firstError: string | null = null;

    for (const retryMode of [false, true]) {
      const prompt = buildPrompt({
        ocrText,
        detectedName,
        detectedType,
        detectedExpiryDate,
        candidates,
        retryMode,
      });
      const res = await callGemini(apiKey, prompt);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (!firstError) firstError = errText || `HTTP ${res.status}`;
        continue;
      }
      const payload = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const jsonText = extractJsonObject(rawText);
      if (!jsonText) {
        if (!firstError) firstError = "Gemini did not return valid JSON";
        continue;
      }
      raw = JSON.parse(jsonText) as Record<string, unknown>;
      break;
    }

    if (!raw) {
      return fail("Gemini extraction failed", 502, firstError ?? "Invalid AI response");
    }

    const normalizedAiDate = normalizeDateString(
      typeof raw.expiryDate === "string" ? raw.expiryDate : null,
    );
    const normalizedHintDate = normalizeDateString(detectedExpiryDate);
    const allowedTags = new Set([
      "near_exp_label",
      "single_date",
      "multi_date_last",
      "issue_date_filtered",
      "fallback_hint",
      "low_confidence",
    ]);
    const reasoningTags = Array.isArray(raw.reasoningTags)
      ? raw.reasoningTags
          .filter((t): t is string => typeof t === "string" && allowedTags.has(t))
          .slice(0, 8)
      : [];

    const sanitized = {
      name: typeof raw.name === "string" ? raw.name.trim() || null : null,
      type: normalizeType(typeof raw.type === "string" ? raw.type : detectedType),
      expiryDate: normalizedAiDate ?? normalizedHintDate,
      notes: typeof raw.notes === "string" ? raw.notes.trim() || null : null,
      confidence:
        typeof raw.confidence === "number"
          ? Math.max(0, Math.min(100, Math.round(raw.confidence)))
          : 0,
      reasoningTags:
        reasoningTags.length > 0
          ? reasoningTags
          : normalizedAiDate == null && normalizedHintDate != null
            ? ["fallback_hint"]
            : [],
    };
    const valid = outSchema.safeParse(sanitized);
    if (!valid.success) {
      return fail("Gemini output validation failed", 502, valid.error.flatten());
    }
    return ok(valid.data);
  } catch (error) {
    return fail("AI extraction failed", 500, String(error));
  }
}
