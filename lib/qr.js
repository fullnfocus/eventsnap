// QR-code decoding (shared by all approaches). Uses three small pure-JavaScript packages
// (jsqr, jpeg-js, pngjs). If they are not installed, QR decoding is skipped gracefully.

import { imageLibs, decode, downscale } from './image.js';

let jsQR;
async function load() {
  if (jsQR !== undefined) return jsQR;
  try {
    jsQR = (await import('jsqr')).default;
  } catch {
    jsQR = null;
  }
  return jsQR;
}

export async function qrAvailable() {
  return Boolean((await load()) && (await imageLibs()));
}

export async function decodeQr(buf, mime) {
  const [Q, L] = [await load(), await imageLibs()];
  if (!Q || !L || !/png|jpe?g/.test(mime)) return [];
  try {
    const full = decode(buf, mime, L);
    for (const side of [1600, 1000, 2400]) {
      const img = downscale(full, side);
      const r = Q(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (r?.data) return [r.data];
    }
  } catch {
    /* unreadable image: treat as no QR */
  }
  return [];
}
