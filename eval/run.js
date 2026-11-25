// Runs every labelled poster through EventSnap (OCR.space + Gemini extraction) and saves raw predictions.
// Usage: node eval/run.js [--labels data/labels.csv] [--posters data/posters] [--limit 5]
// Safe to re-run: posters already done are skipped (delete results/predictions.jsonl to start over).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { processPoster, todayHK } from '../lib/pipeline.js';
import { readCsv } from './csv.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const R = (p) => path.resolve(config.root, p);
const labelsFile = R(args.labels || 'data/labels.csv');
const posterDir = R(args.posters || 'data/posters');
const outDir = R(args.out || 'results');
const method = 'llm'; // single approach: OCR + LLM
const limit = args.limit ? Number(args.limit) : Infinity;

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
fs.mkdirSync(path.join(outDir, 'cache'), { recursive: true });
const predFile = path.join(outDir, 'predictions.jsonl');
const cacheFile = path.join(outDir, 'cache', `ocr-ocrspace-engine${config.ocrSpaceEngine}.json`);

// Persistent OCR cache: re-runs (e.g. after changing the prompt) don't pay for OCR again.
const ocrCache = new Map(fs.existsSync(cacheFile) ? Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))) : []);
const origSet = ocrCache.set.bind(ocrCache);
ocrCache.set = (k, v) => {
  origSet(k, v);
  fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(ocrCache)));
  return ocrCache;
};

const done = new Set(
  fs.existsSync(predFile)
    ? fs.readFileSync(predFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => `${r.file}|${r.method}`)
    : [],
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = /\b(429|500|502|503|504)\b|fetch failed|ECONNRESET/.test(e.message);
      if (!retryable || i >= tries - 1) throw e;
      const wait = 2000 * 2 ** i;
      console.log(`   retry in ${wait / 1000}s (${e.message.slice(0, 80)})`);
      await sleep(wait);
    }
  }
}

const labels = readCsv(labelsFile).slice(0, limit);
console.log(`Evaluating ${labels.length} posters  (OCR: OCR.space engine ${config.ocrSpaceEngine}, extraction: ${config.geminiModel}, thinking: ${config.geminiThinking})`);
let n = 0;
for (const row of labels) {
  const file = path.join(posterDir, row.file);
  if (!fs.existsSync(file)) {
    console.log(`! missing image ${row.file} - skipped`);
    continue;
  }
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) {
    console.log(`! ${row.file}: unsupported format (use JPG or PNG)`);
    continue;
  }
  const buf = fs.readFileSync(file);
  {
    if (done.has(`${row.file}|${method}`)) continue;
    const refDate = row.collected_on || todayHK();
    let rec;
    try {
      const r = await withRetry(() => processPoster(buf, mime, { refDate, cache: ocrCache }));
      rec = { file: row.file, method, thinking: config.geminiThinking, refDate, notPoster: r.notPoster, notPosterReason: r.notPosterReason ?? null, decidedBy: r.decidedBy ?? null, event: r.event, raw: r.rawModelOutput, warnings: r.warnings, needsReview: r.needsReview, qr: r.qr, timings: r.timings, usage: r.usage, costUsd: r.costUsd, ocrChars: r.ocrText?.length ?? null };
      console.log(`✓ ${row.file.padEnd(28)} ${String(r.timings.total_ms).padStart(6)} ms  ${r.notPoster ? `[not a poster] ${r.notPosterReason}` : r.event.title ?? '-'}`);
    } catch (e) {
      rec = { file: row.file, method, thinking: config.geminiThinking, refDate, error: e.message };
      console.log(`✗ ${row.file.padEnd(28)} ${e.message.slice(0, 120)}`);
    }
    fs.appendFileSync(predFile, JSON.stringify(rec) + '\n');
    n++;
  }
}
console.log(`\nDone: ${n} new predictions written to ${path.relative(config.root, predFile)}. Next: npm run score`);
