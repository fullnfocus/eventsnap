// Loads settings from environment variables and an optional .env file.
// No external dependencies (no dotenv) so the project runs on plain Node 18+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv();

const num = (v) => (v === undefined || v === '' ? null : Number(v));

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  timezone: 'Asia/Hong_Kong', // UTC+8, no daylight saving
  // Stage 1 - OCR.space (dedicated OCR engine)
  ocrSpaceKey: process.env.OCR_SPACE_API_KEY || '',
  ocrSpaceEngine: Number(process.env.OCR_SPACE_ENGINE || 2),
  ocrSpaceBase: process.env.OCR_SPACE_BASE_URL || 'https://api.ocr.space',
  // Stage 2 - Gemini (text -> event fields)
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  // How much Gemini 'thinks' before answering: minimal | low | medium | high | default (model's own setting).
  // Extraction is an easy task, so a low level is much faster with little or no loss in accuracy.
  geminiThinking: (process.env.GEMINI_THINKING || 'low').toLowerCase(),
  // Base URLs can be overridden for testing against a mock server
  geminiBase: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
  // Optional prices for cost estimates (USD). Look them up on the providers' pricing pages.
  prices: {
    geminiInputPer1M: num(process.env.PRICE_GEMINI_INPUT_PER_1M),
    geminiOutputPer1M: num(process.env.PRICE_GEMINI_OUTPUT_PER_1M),
  },
};

export function estimateCost({ inTokens = 0, outTokens = 0 }) {
  const p = config.prices;
  if (p.geminiInputPer1M == null) return null;
  return (inTokens * p.geminiInputPer1M) / 1e6 + (outTokens * (p.geminiOutputPer1M || 0)) / 1e6;
}
