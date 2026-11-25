// Stage 1: OCR with the OCR.space API (a dedicated OCR engine, free plan).
// Free plan limits: 1 MB per image, 500 requests/day per IP, 25,000/month -> images are shrunk automatically.
import { config } from './config.js';
import { fitUnder } from './image.js';

const MAX_BYTES = 950 * 1024; // stay safely under the 1 MB limit

export async function runOcr(buf, mime) {
  if (!config.ocrSpaceKey) throw new Error('OCR_SPACE_API_KEY is not set - add it to the .env file and restart the server');
  const t0 = Date.now();
  const img = await fitUnder(buf, mime, MAX_BYTES);
  const form = new URLSearchParams({
    base64Image: `data:${img.mime};base64,${img.buf.toString('base64')}`,
    language: 'eng',
    OCREngine: String(config.ocrSpaceEngine), // engine 2: better on posters, stylised fonts and digits
    scale: 'true', // upscales small text before recognition
    detectOrientation: 'true',
    isOverlayRequired: 'false',
  });

  let json;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${config.ocrSpaceBase}/parse/image`, {
      method: 'POST',
      headers: { apikey: config.ocrSpaceKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`OCR.space error ${res.status}: ${body.slice(0, 300)}`);
    }
    break;
  }
  if (json.IsErroredOnProcessing || !json.ParsedResults?.length) {
    const msg = [].concat(json.ErrorMessage || json.ErrorDetails || 'unknown error').join(' ');
    throw new Error(`OCR.space: ${msg}`);
  }
  const text = json.ParsedResults.map((r) => r.ParsedText || '').join('\n').replace(/\r\n/g, '\n').trim();
  return { text, ms: Date.now() - t0, pages: 1, resized: img.resized, usage: { inTokens: 0, outTokens: 0 } };
}
