// Image helpers (decode, downscale, re-encode) using small pure-JS packages: jpeg-js and pngjs.
// Installed by `npm install`. Used for QR decoding and to shrink images below OCR.space's 1 MB limit.

let libs;
export async function imageLibs() {
  if (libs !== undefined) return libs;
  try {
    const [jpeg, png] = await Promise.all([import('jpeg-js'), import('pngjs')]);
    libs = { jpeg: jpeg.default || jpeg, PNG: png.PNG || png.default.PNG };
  } catch {
    libs = null;
  }
  return libs;
}

// -> { width, height, data: RGBA bytes }
export function decode(buf, mime, L) {
  if (/png/.test(mime)) {
    const img = L.PNG.sync.read(buf);
    return { width: img.width, height: img.height, data: img.data };
  }
  const img = L.jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: img.data };
}

// Box-filter downscale (averages pixels, so small text stays readable for OCR).
export function downscale(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s === 1) return img;
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / s), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / s), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) / s)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Re-encode as JPEG, shrinking until the file is below maxBytes. Returns { buf, mime, width, height, resized }.
export async function fitUnder(buf, mime, maxBytes) {
  if (buf.length <= maxBytes) return { buf, mime, resized: false };
  const L = await imageLibs();
  if (!L) throw new Error(`Image is ${(buf.length / 1e6).toFixed(1)} MB but OCR.space's free plan accepts max 1 MB. Run "npm install" so the app can shrink images automatically.`);
  const full = decode(buf, mime, L);
  let side = Math.min(2400, Math.max(full.width, full.height));
  for (let i = 0; i < 8; i++) {
    for (const quality of [88, 78]) {
      const img = downscale(full, side);
      const out = Buffer.from(L.jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality).data);
      if (out.length <= maxBytes) return { buf: out, mime: 'image/jpeg', width: img.width, height: img.height, resized: true };
    }
    side = Math.round(side * 0.8);
  }
  throw new Error('Could not shrink the image below 1 MB');
}
