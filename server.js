// EventSnap web server: plain Node.js (18+), no framework.
//   GET  /              -> React front end (public/index.html)
//   GET  /api/health    -> which API keys / features are configured
//   POST /api/extract   -> { image: dataURL, refDate? } -> extraction result
//   POST /api/ics       -> { event } -> .ics file download
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './lib/config.js';
import { processPoster, todayHK } from './lib/pipeline.js';
import { toICS, googleCalendarUrl } from './lib/calendar.js';
import { qrAvailable } from './lib/qr.js';

const PUBLIC = path.join(config.root, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_BODY = 25 * 1024 * 1024;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Image too large (max 25 MB)'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Expected an image data URL');
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, {
        gemini: Boolean(config.geminiKey),
        geminiModel: config.geminiModel,
        geminiThinking: config.geminiThinking,
        ocrSpace: Boolean(config.ocrSpaceKey),
        ocrEngine: config.ocrSpaceEngine,
        qr: await qrAvailable(),
        today: todayHK(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/extract') {
      const body = await readJson(req);
      const { buf, mime } = parseDataUrl(body.image);
      const result = await processPoster(buf, mime, { refDate: body.refDate || todayHK(), thinking: body.thinking });
      console.log(result.notPoster ? `[extract] ${result.timings.total_ms} ms  NOT A POSTER (${result.decidedBy}): ${result.notPosterReason}` : `[extract] ${result.timings.total_ms} ms  "${result.event.title ?? '-'}"  warnings=${result.warnings.length}`);
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/ics') {
      const { event } = await readJson(req);
      const ics = toICS(event);
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${(event.title || 'event').replace(/[^\w-]+/g, '_').slice(0, 40)}.ics"`,
      });
      return res.end(ics);
    }
    if (req.method === 'POST' && url.pathname === '/api/gcal') {
      const { event } = await readJson(req);
      return send(res, 200, { url: googleCalendarUrl(event) });
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(PUBLIC, path.normalize(rel));
      if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[error]', err.message);
    send(res, 400, { error: err.message });
  }
});

server.listen(config.port, () => {
  console.log(`EventSnap running at http://localhost:${config.port}`);
  if (!config.ocrSpaceKey) console.log('  ! OCR_SPACE_API_KEY missing - add it to .env and restart');
  if (!config.geminiKey) console.log('  ! GEMINI_API_KEY missing - add it to .env and restart');
  qrAvailable().then((ok) => ok || console.log('  ! QR decoding off - run "npm install" to enable it'));
});
