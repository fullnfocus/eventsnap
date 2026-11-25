// End-to-end pipeline: image -> OCR.space (stage 1) -> Gemini extraction (stage 2) -> QR merge -> validation -> calendar link.
import crypto from 'node:crypto';
import { estimateCost } from './config.js';
import { runOcr } from './ocr.js';
import { extractFromText } from './gemini.js';
import { decodeQr } from './qr.js';
import { validateEvent } from './validate.js';
import { googleCalendarUrl } from './calendar.js';
import { applyYearRule } from './dates.js';

export const todayHK = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// Optional OCR cache (used by the evaluation so re-runs don't pay for OCR again).
const memCache = new Map();
async function ocrCached(buf, mime, cache = memCache) {
  const key = crypto.createHash('sha1').update(buf).digest('hex');
  if (cache.has(key)) return cache.get(key);
  const r = await runOcr(buf, mime);
  cache.set(key, r);
  return r;
}

// Quick pre-check: images with (almost) no readable text cannot be event posters, so Gemini is not called.
const MIN_WORDS = 3;
const wordCount = (t) => (t.match(/[A-Za-z]{2,}/g) || []).length;

export async function processPoster(buf, mime, { refDate = todayHK(), cache, thinking } = {}) {
  const ocr = await ocrCached(buf, mime, cache);
  if (wordCount(ocr.text) < MIN_WORDS) {
    return notPosterResult(ocr, refDate, 'No readable text was found in this image.', 'ocr-check');
  }
  const ex = await extractFromText(ocr.text, refDate, { thinking });
  if (ex.event.is_event_poster === false) {
    return notPosterResult(ocr, refDate, ex.event.not_poster_reason || 'The text does not describe an event.', 'llm', ex);
  }
  ex.event = applyYearRule(ex.event, refDate);
  const tq = Date.now();
  const qr = await decodeQr(buf, mime);
  const qrMs = Date.now() - tq;
  const { event, warnings, needsReview } = validateEvent(ex.event, { refDate, qrLinks: qr });

  let calendarUrl = null;
  if (event.start_date) calendarUrl = googleCalendarUrl(event);
  return {
    notPoster: false,
    thinking: ex.thinking,
    refDate,
    event,
    rawModelOutput: ex.event,
    warnings,
    needsReview,
    qr,
    ocrText: ocr.text,
    timings: { ocr_ms: ocr.ms, extract_ms: ex.ms, qr_ms: qrMs, total_ms: ocr.ms + ex.ms + qrMs },
    usage: { ocr: ocr.usage, extract: ex.usage, inTokens: (ocr.usage?.inTokens || 0) + ex.usage.inTokens, outTokens: (ocr.usage?.outTokens || 0) + ex.usage.outTokens },
    costUsd: estimateCost({ inTokens: (ocr.usage?.inTokens || 0) + ex.usage.inTokens, outTokens: (ocr.usage?.outTokens || 0) + ex.usage.outTokens }),
    calendarUrl,
  };
}

function notPosterResult(ocr, refDate, reason, decidedBy, ex = null) {
  const usage = { ocr: ocr.usage, extract: ex?.usage ?? null, inTokens: ex?.usage.inTokens ?? 0, outTokens: ex?.usage.outTokens ?? 0 };
  return {
    notPoster: true,
    notPosterReason: reason,
    decidedBy, // 'ocr-check' (no text) or 'llm' (Gemini said it is not an event)
    refDate,
    event: null,
    rawModelOutput: ex?.event ?? null,
    warnings: [],
    needsReview: false,
    qr: [],
    ocrText: ocr.text,
    timings: { ocr_ms: ocr.ms, extract_ms: ex?.ms ?? 0, qr_ms: 0, total_ms: ocr.ms + (ex?.ms ?? 0) },
    usage,
    costUsd: estimateCost({ inTokens: usage.inTokens, outTokens: usage.outTokens }),
    calendarUrl: null,
  };
}
