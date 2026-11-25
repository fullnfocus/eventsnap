// Scores predictions against hand labels and writes report-ready outputs:
//   results/summary.json      all metrics
//   results/per_poster.csv    one row per poster x method (for the appendix / error analysis)
//   results/tables.tex        LaTeX tables to paste into Overleaf
//   results/failures.md       every wrong field (gold vs predicted) for the Discussion section
// Usage: node eval/score.js [--labels data/labels.csv] [--out results]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { normaliseLink } from '../lib/validate.js';
import { readCsv, toCsv } from './csv.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const R = (p) => path.resolve(config.root, p);
const outDir = R(args.out || 'results');
const labels = readCsv(R(args.labels || 'data/labels.csv'));
const isPoster = (l) => String(l.is_poster ?? '1').trim() !== '0'; // missing column = poster
const posters = labels.filter(isPoster);
const nonPosters = labels.filter((l) => !isPoster(l));

// keep the last successful record per poster x method
const preds = new Map();
for (const line of fs.readFileSync(path.join(outDir, 'predictions.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  const k = `${r.file}|${r.method}`;
  if (!r.error || !preds.has(k) || preds.get(k).error) preds.set(k, r);
}

// ---------- field matchers ----------
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);
function tokenF1(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length && !B.length) return 1;
  if (!A.length || !B.length) return 0;
  const pool = [...B];
  let hit = 0;
  for (const t of A) {
    const i = pool.indexOf(t);
    if (i >= 0) { hit++; pool.splice(i, 1); }
  }
  if (!hit) return 0;
  const p = hit / A.length, r = hit / B.length;
  return (2 * p * r) / (p + r);
}
const empty = (v) => v == null || String(v).trim() === '';
const linkKey = (u) => { const n = normaliseLink(u); return n ? n.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').toLowerCase() : null; };
const timeKey = (t) => { const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };

export const FIELDS = {
  title: (g, p) => !empty(p) && tokenF1(g, p) >= 0.7,
  start_date: (g, p) => String(g) === String(p ?? ''),
  start_time: (g, p) => (empty(g) ? empty(p) : timeKey(g) === timeKey(p)),
  end_time: (g, p) => (empty(g) ? empty(p) : timeKey(g) === timeKey(p)),
  location: (g, p) => {
    if (empty(g)) return empty(p);
    if (empty(p)) return false;
    const G = new Set(tokens(g)), P = new Set(tokens(p));
    const contains = [...G].every((t) => P.has(t)) || [...P].every((t) => G.has(t));
    return tokenF1(g, p) >= 0.6 || contains;
  },
  registration_link: (g, p) => (empty(g) ? empty(p) : linkKey(g) === linkKey(p)),
};
const CRITICAL = ['title', 'start_date', 'start_time', 'location'];
const LABEL = { title: 'Title', start_date: 'Date', start_time: 'Start time', end_time: 'End time', location: 'Location', registration_link: 'Reg. link' };
const METHOD_NAME = { llm: 'EventSnap (OCR + LLM)' };

// Wilson 95% interval for a proportion
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------- scoring ----------
const methods = ['llm'];
const perPoster = [];
const failures = [];
const summary = { n_labelled: labels.length, n_posters: posters.length, n_non_posters: nonPosters.length, methods: {} };

for (const m of methods) {
  const rows = posters.map((g) => ({ g, p: preds.get(`${g.file}|${m}`) })).filter((x) => x.p);
  const ok = rows.filter((x) => !x.p.error);
  const fieldHits = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, 0]));
  const halluc = { n: 0, k: 0 };
  let critical = 0, full = 0, flaggedWhenWrong = 0, wrongCount = 0, flaggedWhenRight = 0, rightCount = 0;
  const bySource = {};
  for (const { g, p } of rows) {
    const e = p.event || {};
    const res = {};
    for (const [f, match] of Object.entries(FIELDS)) {
      res[f] = !p.error && match(g[f], e[f]);
      if (res[f]) fieldHits[f]++;
      else if (!p.error) failures.push({ method: m, file: g.file, source: g.source, field: f, gold: g[f] || '∅', pred: e[f] ?? '∅' });
      if (['start_time', 'end_time', 'location', 'registration_link'].includes(f) && empty(g[f]) && !p.error) {
        halluc.n++;
        if (!empty(e[f])) halluc.k++;
      }
    }
    const crit = CRITICAL.every((f) => res[f]);
    const all = Object.values(res).every(Boolean);
    critical += crit;
    full += all;
    if (!p.error) {
      const flagged = Boolean(p.needsReview || p.notPoster); // a rejected poster is also visible to the user
      if (!crit) { wrongCount++; flaggedWhenWrong += flagged; }
      else { rightCount++; flaggedWhenRight += flagged; }
    }
    const s = (bySource[g.source || 'unknown'] ??= { n: 0, critical: 0 });
    s.n++;
    s.critical += crit;
    perPoster.push({ file: g.file, source: g.source, method: m, error: p.error || '', ...Object.fromEntries(Object.keys(FIELDS).map((f) => [f, res[f] ? 1 : 0])), critical_ok: crit ? 1 : 0, all_ok: all ? 1 : 0, needs_review: p.needsReview ? 1 : 0, total_ms: p.timings?.total_ms ?? '', in_tokens: p.usage?.inTokens ?? '', out_tokens: p.usage?.outTokens ?? '' });
  }
  const n = rows.length;
  const lat = ok.map((x) => x.p.timings.total_ms);
  const costs = ok.map((x) => x.p.costUsd).filter((c) => c != null);
  summary.methods[m] = {
    n,
    errors: n - ok.length,
    field_accuracy: Object.fromEntries(Object.entries(fieldHits).map(([f, k]) => [f, n ? k / n : 0])),
    critical_accuracy: n ? critical / n : 0,
    critical_ci95: wilson(critical, n),
    calendar_ready: n ? full / n : 0,
    hallucination_rate: halluc.n ? halluc.k / halluc.n : 0,
    review_flag_recall: wrongCount ? flaggedWhenWrong / wrongCount : null, // wrong events that the app flagged
    review_flag_false_alarm: rightCount ? flaggedWhenRight / rightCount : null, // correct events flagged anyway
    latency_ms: { mean: mean(lat), median: median(lat), p90: lat.length ? [...lat].sort((a, b) => a - b)[Math.floor(lat.length * 0.9)] : null },
    tokens: { in_mean: mean(ok.map((x) => x.p.usage?.inTokens || 0)), out_mean: mean(ok.map((x) => x.p.usage?.outTokens || 0)) },
    cost_usd_per_poster: costs.length ? mean(costs) : null,
    posters_wrongly_rejected: rows.filter((x) => x.p.notPoster).length,
    non_poster_detection: (() => {
      const nr = nonPosters.map((g) => preds.get(`${g.file}|${m}`)).filter((p) => p && !p.error);
      const rejected = nr.filter((p) => p.notPoster);
      return { n: nr.length, correctly_rejected: rejected.length, rate: nr.length ? rejected.length / nr.length : null, by_ocr_check: rejected.filter((p) => p.decidedBy === 'ocr-check').length, by_llm: rejected.filter((p) => p.decidedBy === 'llm').length };
    })(),
    by_source: Object.fromEntries(Object.entries(bySource).map(([s, v]) => [s, { n: v.n, critical_accuracy: v.critical / v.n }])),
  };
}

// ---------- outputs ----------
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'per_poster.csv'), toCsv(perPoster));

const pct = (x) => (x == null ? '--' : `${(100 * x).toFixed(1)}`);
const best = (f) => Math.max(...methods.map((m) => f(summary.methods[m])));
const cell = (v) => pct(v);
let tex = `% Generated by eval/score.js on ${new Date().toISOString().slice(0, 10)} -- ${posters.length} posters + ${nonPosters.length} non-poster images\n`;
tex += `\\begin{table}[t]\n  \\centering\n  \\caption{Field-level accuracy (\\%) on ${posters.length} real campus posters.}\n  \\label{tab:field-acc}\n  \\small\n  \\begin{tabular}{l${'c'.repeat(Object.keys(FIELDS).length)}c}\n    \\toprule\n`;
tex += `    Method & ${Object.keys(FIELDS).map((f) => LABEL[f]).join(' & ')} & Event$^\\dagger$ \\\\\n    \\midrule\n`;
for (const m of methods) {
  const s = summary.methods[m];
  tex += `    ${METHOD_NAME[m]} & ${Object.keys(FIELDS).map((f) => cell(s.field_accuracy[f], best((x) => x.field_accuracy[f]))).join(' & ')} & ${cell(s.critical_accuracy, best((x) => x.critical_accuracy))} \\\\\n`;
}
tex += `    \\bottomrule\n  \\end{tabular}\n\n  \\vspace{2pt}{\\footnotesize $^\\dagger$Title, date, start time and location all correct.}\n\\end{table}\n\n`;
tex += `\\begin{table}[t]\n  \\centering\n  \\caption{End-to-end quality, reliability and efficiency per poster.}\n  \\label{tab:efficiency}\n  \\small\n  \\setlength{\\tabcolsep}{4pt}\n  \\begin{tabular}{lcccccc}\n    \\toprule\n`;
tex += `    Method & Event (95\\% CI) & Ready$^\\ddagger$ & Halluc. & Flag rec. & Latency (s) & US\\$/poster\\\\\n    \\midrule\n`;
for (const m of methods) {
  const s = summary.methods[m];
  tex += `    ${METHOD_NAME[m]} & ${pct(s.critical_accuracy)} (${pct(s.critical_ci95[0])}--${pct(s.critical_ci95[1])}) & ${pct(s.calendar_ready)} & ${pct(s.hallucination_rate)} & ${pct(s.review_flag_recall)} & ${s.latency_ms.median != null ? (s.latency_ms.median / 1000).toFixed(1) : '--'} & ${s.cost_usd_per_poster != null ? s.cost_usd_per_poster.toFixed(4) : '--'} \\\\\n`;
}
tex += `    \\bottomrule\n  \\end{tabular}\n\n  \\vspace{2pt}{\\footnotesize $^\\ddagger$All six fields correct. Halluc.: field filled in although absent from the poster. Flag rec.: share of wrong events that the review screen flagged. Latency: median.}\n\\end{table}\n`;
if (nonPosters.length) {
  tex += `\n\\begin{table}[t]\n  \\centering\n  \\caption{Telling posters apart from other images.}\n  \\label{tab:detection}\n  \\small\n  \\begin{tabular}{lcc}\n    \\toprule\n    & Correctly handled & Rate (\\%) \\\\\n    \\midrule\n`;
  for (const m of methods) {
    const s = summary.methods[m], d = s.non_poster_detection;
    tex += `    Non-poster images rejected & ${d.correctly_rejected}/${d.n} & ${pct(d.rate)} \\\\\n`;
    tex += `    \\quad of which: no text found (OCR check) & ${d.by_ocr_check} & -- \\\\\n    \\quad of which: rejected by Gemini & ${d.by_llm} & -- \\\\\n`;
    tex += `    Real posters wrongly rejected & ${s.posters_wrongly_rejected}/${s.n} & ${pct(s.n ? s.posters_wrongly_rejected / s.n : 0)} \\\\\n`;
  }
  tex += `    \\bottomrule\n  \\end{tabular}\n\\end{table}\n`;
}
fs.writeFileSync(path.join(outDir, 'tables.tex'), tex);

let md = `# Wrong fields (gold vs predicted)\n\nUse this list to find failure patterns for the Discussion section.\n`;
for (const m of methods) {
  const fs_ = failures.filter((f) => f.method === m);
  md += `\n## ${METHOD_NAME[m]} — ${fs_.length} wrong fields\n\n| Poster | Source | Field | Gold | Predicted |\n|---|---|---|---|---|\n`;
  for (const f of fs_) md += `| ${f.file} | ${f.source || ''} | ${f.field} | ${String(f.gold).replace(/\|/g, '/')} | ${String(f.pred).replace(/\|/g, '/')} |\n`;
}
fs.writeFileSync(path.join(outDir, 'failures.md'), md);

// console summary
console.log(`\n${posters.length} posters, ${nonPosters.length} non-poster images\n`);
console.log('Method          ' + Object.keys(FIELDS).map((f) => LABEL[f].padStart(11)).join('') + '      Event  Ready  Halluc  Latency');
for (const m of methods) {
  const s = summary.methods[m];
  console.log(METHOD_NAME[m].padEnd(16) + Object.keys(FIELDS).map((f) => pct(s.field_accuracy[f]).padStart(11)).join('') + pct(s.critical_accuracy).padStart(11) + pct(s.calendar_ready).padStart(7) + pct(s.hallucination_rate).padStart(8) + `${s.latency_ms.median != null ? (s.latency_ms.median / 1000).toFixed(1) + 's' : '--'}`.padStart(9) + (s.errors ? `   (${s.errors} errors)` : ''));
}
for (const m of methods) {
  const d = summary.methods[m].non_poster_detection;
  if (d.n) console.log(`Non-posters rejected: ${d.correctly_rejected}/${d.n}   Posters wrongly rejected: ${summary.methods[m].posters_wrongly_rejected}/${summary.methods[m].n}`);
}
console.log(`\nWrote results/summary.json, per_poster.csv, tables.tex, failures.md`);
