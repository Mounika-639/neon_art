/* ============================================================================
   Divine Darshan — Neon Sketch Reveal
   script.js — vanilla JavaScript, no framework, no modules, no build step.

   Browser port of the OpenCV "Neon Sketch Reveal" script. The processing
   pipeline follows the same order as the Python original:

     load_and_fit -> make_neon_edge_layer -> block_mosaic -> dot reveal
     -> refine -> hold -> crossfade -> final photo

   See the "What was ported" section of index.html for an honest account of
   which parts are exact, which are approximations, and which desktop-only
   features have no browser equivalent.
   ========================================================================== */
(function () {
'use strict';

/* ============================================================ 0. HELPERS == */

var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkCanvas(w, h) {
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* Canvas2D `filter` support (Safari below 17 lacks it) */
var HAS_FILTER = (function () {
  try {
    var x = mkCanvas(2, 2).getContext('2d');
    if (!('filter' in x)) return false;
    x.filter = 'blur(2px)';
    return x.filter === 'blur(2px)';
  } catch (e) { return false; }
})();

/* ============================================================= 1. DATA ==== */
/* Relative paths only — everything resolves correctly on GitHub Pages.
   rect = upper-body box  [x0,y0,x1,y1]   face = focal point [x,y]  (normalised) */
var DEITIES = [
  { id: 'venkateswara', name: 'Sri Venkateswara', sub: 'Tirumala',
    src: 'images/swamy_photo.jpeg', rect: [0.04, 0.19, 0.96, 0.72], face: [0.50, 0.415] },
  { id: 'ganesha',      name: 'Sri Ganesha',      sub: 'Vighnaharta',
    src: 'images/ganesha.jpg',      rect: [0.04, 0.06, 0.96, 0.68], face: [0.50, 0.255] },
  { id: 'shiva',        name: 'Sri Shiva',        sub: 'Mahadeva',
    src: 'images/shiva.jpg',        rect: [0.04, 0.10, 0.96, 0.66], face: [0.47, 0.305] },
  { id: 'lakshmi',      name: 'Sri Lakshmi',      sub: 'Dhanadayini',
    src: 'images/lakshmi.jpg',      rect: [0.05, 0.08, 0.95, 0.60], face: [0.50, 0.245] },
  { id: 'krishna',      name: 'Sri Krishna',      sub: 'Murali Mohan',
    src: 'images/krishna.jpg',      rect: [0.05, 0.08, 0.95, 0.62], face: [0.51, 0.270] },
  { id: 'hanuman',      name: 'Sri Hanuman',      sub: 'Bajrangbali',
    src: 'images/hanuman.jpg',      rect: [0.05, 0.10, 0.95, 0.64], face: [0.50, 0.290] }
];

/* -------- timings (seconds) — the Python constants live in `classic` ------ */
var SPEEDS = {
  quick:   { dot: 0.70, refine: 0.60, hold: 0.40, fade: 0.70, final: 1.60 },
  fast:    { dot: 1.10, refine: 0.90, hold: 0.60, fade: 0.90, final: 2.20 },
  classic: { dot: 3.50, refine: 3.00, hold: 3.00, fade: 1.50, final: 3.00 }
};

var GLOWS = {
  original: null,
  gold:     [255, 205, 90],
  cyan:     [80, 235, 255],
  magenta:  [255, 90, 190],
  emerald:  [95, 255, 165]
};

/* -------- pipeline constants (Python originals noted in comments) -------- */
var CFG = {
  MOSAIC_BLOCK_SIZE: 10,
  DARK_PIXEL_SKIP: 18,
  RANDOM_SEED: 42,
  EDGE_LOW: 70,             // Canny hysteresis (original 60 / 150 — raised a
  EDGE_HIGH: 170,           // little so dense jewellery does not turn to mush)
  LINE_THICKNESS: 2,
  GLOW_STRENGTH: 1.15,      // original 1.6 blew every edge out to flat white
  CORE_W: 0.90,             // original 1.4
  INNER_W: 0.80,            // original 1.1
  OUTER_W: 0.55,            // original 0.7
  INNER_SIGMA: 4,
  OUTER_SIGMA: 14,
  MOSAIC_GAMMA: 0.42,       // 0 = Python's pure brightest-pixel block
  S_GAIN: 1.50,             // original 1.7
  V_GAIN: 1.25,             // original 1.5
  V_LIFT: 18,               // original +60
  REFLECTION_HEIGHT_RATIO: 0.28,
  DISPLAY_BRIGHTNESS: 1.12,
  AUTO_CONTRAST: true,
  REF_HEIGHT: 1920,         // resolution the Python constants were tuned for
  MAX_PIXELS: 2.6e6,        // cap on the player canvas backing store
  SKETCH_PIXELS: 1.5e6,     // cap on the still "Neon sketch" canvas
  MAX_DPR: 2,
  FOCUS_BIAS_Y: 0.52        // where the face lands inside a cropped window
};

/* =================================================== 2. load_and_fit() ==== */

/* Fit: the whole picture stays visible (letterboxed) — never cropped,
   never distorted. This is the default and matches object-fit: contain. */
function containDraw(ctx, img, W, H) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  var s = Math.min(W / iw, H / ih);
  var dw = iw * s, dh = ih * s;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, iw, ih, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/* Same geometry as containDraw but on a transparent background, so an
   ambient backdrop can show through the bars. */
function containDrawClear(ctx, img, W, H) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  var s = Math.min(W / iw, H / ih);
  var dw = iw * s, dh = ih * s;
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, iw, ih, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/* Fill: cover-crop so the frame is filled edge to edge on any aspect ratio.
   This is the Python `load_and_fit` behaviour, plus a focal point so the
   deity's face stays in frame instead of being blindly centre-cropped. */
function coverDraw(ctx, img, W, H, rect, face, biasY) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  var r  = rect || [0, 0, 1, 1];
  var f  = face || [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  var by = (biasY == null) ? CFG.FOCUS_BIAS_Y : biasY;

  var fx = r[0] * iw, fy = r[1] * ih;
  var fw = Math.max(1, (r[2] - r[0]) * iw);
  var fh = Math.max(1, (r[3] - r[1]) * ih);

  var scale = Math.max(W / fw, H / fh);
  var sw = Math.min(iw, W / scale);
  var sh = Math.min(ih, H / scale);

  var sx = f[0] * iw - sw * 0.5;
  var sy = f[1] * ih - sh * by;
  sx = clamp(sx, fx, fx + fw - sw);
  sy = clamp(sy, fy, fy + fh - sh);
  sx = clamp(sx, 0, iw - sw);
  sy = clamp(sy, 0, ih - sh);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
}

/* How much of the frame the letterbox bars take up in contain mode. */
function barFraction(img, W, H) {
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  var s = Math.min(W / iw, H / ih);
  return 1 - (iw * s * ih * s) / (W * H);
}

/* Ambient backdrop for the letterbox. The deity itself is still drawn whole
   and uncropped on top; this only replaces dead black with a soft spill of
   the picture's own colour, the way a lamp lights the wall behind a frame.
   Built by upscaling a 64px thumbnail, so it costs almost nothing and needs
   no blur filter. It is NOT part of the edge-detection input. */
function makeAmbient(img, W, H) {
  var small = mkCanvas(64, Math.max(8, Math.round(64 * H / W)));
  coverDraw(small.getContext('2d'), img, small.width, small.height, [0, 0, 1, 1], null, 0.5);
  var bg = mkCanvas(W, H);
  var c = bg.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.globalAlpha = 0.30;
  c.drawImage(small, 0, 0, small.width, small.height, 0, 0, W, H);
  c.globalAlpha = 1;
  var g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.72)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  return bg;
}

function layoutImage(ctx, img, W, H, opts) {
  if (opts.fit === 'fill') {                       // canvas already matches aspect
    ctx.drawImage(img, 0, 0, W, H);
  } else if (opts.fit === 'upper') {
    coverDraw(ctx, img, W, H, opts.rect, opts.face, opts.biasY);
  } else if (opts.fit === 'cover') {
    coverDraw(ctx, img, W, H, [0, 0, 1, 1], opts.face, 0.42);
  } else {
    containDraw(ctx, img, W, H);
  }
}

/* ============================================ 3. make_neon_edge_layer() === */

function toGray(data, w, h) {
  var g = new Float32Array(w * h);
  for (var i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

/* Separable Gaussian on a Float32 plane.
   NOTE: this stands in for cv2.bilateralFilter(gray, 7, 50, 50). A true
   edge-preserving bilateral filter is far too slow in JS at screen size. */
function blurGray(src, w, h, sigma) {
  var rad = Math.max(1, Math.ceil(sigma * 2.5));
  var k = new Float32Array(2 * rad + 1);
  var sum = 0, i, x, y;
  for (i = -rad; i <= rad; i++) {
    var v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + rad] = v; sum += v;
  }
  for (i = 0; i < k.length; i++) k[i] /= sum;

  var tmp = new Float32Array(w * h);
  var out = new Float32Array(w * h);
  for (y = 0; y < h; y++) {
    var row = y * w;
    for (x = 0; x < w; x++) {
      var acc = 0;
      for (i = -rad; i <= rad; i++) acc += src[row + clamp(x + i, 0, w - 1)] * k[i + rad];
      tmp[row + x] = acc;
    }
  }
  for (x = 0; x < w; x++) {
    for (y = 0; y < h; y++) {
      var acc2 = 0;
      for (i = -rad; i <= rad; i++) acc2 += tmp[clamp(y + i, 0, h - 1) * w + x] * k[i + rad];
      out[y * w + x] = acc2;
    }
  }
  return out;
}

/* cv2.Canny — Sobel, non-maximum suppression, double threshold, hysteresis */
function canny(gray, w, h, lo, hi) {
  var g = blurGray(gray, w, h, 1.4);
  var mag = new Float32Array(w * h);
  var dir = new Uint8Array(w * h);
  var x, y, i;

  for (y = 1; y < h - 1; y++) {
    for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
      var d = g[i - 1],                   f = g[i + 1];
      var p = g[i + w - 1], q = g[i + w], r = g[i + w + 1];
      var gx = (c + 2 * f + r) - (a + 2 * d + p);
      var gy = (p + 2 * q + r) - (a + 2 * b + c);
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      var ang = Math.atan2(gy, gx) * 57.29577951308232;
      if (ang < 0) ang += 180;
      dir[i] = ang < 22.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : ang < 157.5 ? 3 : 0;
    }
  }

  var nms = new Float32Array(w * h);
  for (y = 1; y < h - 1; y++) {
    for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var m = mag[i], n1, n2;
      switch (dir[i]) {
        case 0:  n1 = mag[i - 1];     n2 = mag[i + 1];     break;
        case 1:  n1 = mag[i - w + 1]; n2 = mag[i + w - 1]; break;
        case 2:  n1 = mag[i - w];     n2 = mag[i + w];     break;
        default: n1 = mag[i - w - 1]; n2 = mag[i + w + 1];
      }
      nms[i] = (m >= n1 && m >= n2) ? m : 0;
    }
  }

  var out = new Uint8Array(w * h);
  var stack = new Int32Array(w * h);
  var sp = 0;
  for (i = 0; i < out.length; i++) if (nms[i] >= hi) { out[i] = 255; stack[sp++] = i; }
  while (sp > 0) {
    i = stack[--sp];
    var yy = (i / w) | 0, xx = i - yy * w, dy, dx;
    for (dy = -1; dy <= 1; dy++) {
      var ny = yy + dy; if (ny < 0 || ny >= h) continue;
      for (dx = -1; dx <= 1; dx++) {
        var nx = xx + dx; if (nx < 0 || nx >= w) continue;
        var j = ny * w + nx;
        if (out[j] === 0 && nms[j] >= lo) { out[j] = 255; stack[sp++] = j; }
      }
    }
  }
  return out;
}

/* cv2.dilate with a 3x3 kernel, `iters` iterations (separable max filter) */
function dilate(mask, w, h, iters) {
  var cur = mask;
  for (var it = 0; it < iters; it++) {
    var tmp = new Uint8Array(w * h);
    var out = new Uint8Array(w * h);
    var x, y, row, m;
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        m = cur[row + x];
        if (x > 0 && cur[row + x - 1] > m) m = cur[row + x - 1];
        if (x < w - 1 && cur[row + x + 1] > m) m = cur[row + x + 1];
        tmp[row + x] = m;
      }
    }
    for (y = 0; y < h; y++) {
      row = y * w;
      for (x = 0; x < w; x++) {
        m = tmp[row + x];
        if (y > 0 && tmp[row - w + x] > m) m = tmp[row - w + x];
        if (y < h - 1 && tmp[row + w + x] > m) m = tmp[row + w + x];
        out[row + x] = m;
      }
    }
    cur = out;
  }
  return cur;
}

/* Colour the edges: HSV saturation and value boost, exactly as in Python */
function colorLayer(base, mask, w, h, tint) {
  var S_GAIN = CFG.S_GAIN, V_GAIN = CFG.V_GAIN, V_LIFT = CFG.V_LIFT;
  var src = base.data;
  var img = new ImageData(w, h);
  var d = img.data;
  var i, p;

  if (!tint) {
    for (i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (!mask[i]) continue;
      var r = src[p], gg = src[p + 1], b = src[p + 2];
      var mx = r > gg ? (r > b ? r : b) : (gg > b ? gg : b);
      var mn = r < gg ? (r < b ? r : b) : (gg < b ? gg : b);
      var df = mx - mn;
      var hue = 0;
      if (df !== 0) {
        if (mx === r)       hue = ((gg - b) / df) % 6;
        else if (mx === gg) hue = (b - r) / df + 2;
        else                hue = (r - gg) / df + 4;
        hue *= 60; if (hue < 0) hue += 360;
      }
      var s = mx ? df / mx : 0;
      var v = mx;
      s = Math.min(1, s * S_GAIN);
      v = Math.min(255, v * V_GAIN + V_LIFT);

      var cc = v * s, hp = hue / 60, xv = cc * (1 - Math.abs((hp % 2) - 1));
      var r2 = 0, g2 = 0, b2 = 0;
      if (hp < 1)      { r2 = cc; g2 = xv; }
      else if (hp < 2) { r2 = xv; g2 = cc; }
      else if (hp < 3) { g2 = cc; b2 = xv; }
      else if (hp < 4) { g2 = xv; b2 = cc; }
      else if (hp < 5) { r2 = xv; b2 = cc; }
      else             { r2 = cc; b2 = xv; }
      var m2 = v - cc;
      d[p] = r2 + m2; d[p + 1] = g2 + m2; d[p + 2] = b2 + m2; d[p + 3] = 255;
    }
  } else {
    var tr = tint[0], tg = tint[1], tb = tint[2];
    for (i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (!mask[i]) continue;
      d[p] = tr; d[p + 1] = tg; d[p + 2] = tb; d[p + 3] = 255;
    }
  }
  var c = mkCanvas(w, h);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

/* ---- Gaussian blur of a canvas: GPU filter, or a 3-pass box-blur fallback */
function boxesForGauss(sigma, n) {
  var wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  var wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  var wu = wl + 2;
  var mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  var m = Math.round(mIdeal);
  var sizes = [];
  for (var i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
function boxBlurRGBA(d, w, h, radius) {
  var tmp = new Uint8ClampedArray(d.length);
  var iarr = 1 / (radius + radius + 1);
  for (var ch = 0; ch < 4; ch++) {
    var x, y, j, ti, li, ri, fv, lv, val;
    for (y = 0; y < h; y++) {
      ti = y * w; li = ti; ri = ti + radius;
      fv = d[ti * 4 + ch]; lv = d[(ti + w - 1) * 4 + ch];
      val = (radius + 1) * fv;
      for (j = 0; j < radius; j++) val += d[(ti + j) * 4 + ch];
      for (j = 0; j <= radius; j++) { val += d[ri++ * 4 + ch] - fv; tmp[ti++ * 4 + ch] = Math.round(val * iarr); }
      for (j = radius + 1; j < w - radius; j++) { val += d[ri++ * 4 + ch] - d[li++ * 4 + ch]; tmp[ti++ * 4 + ch] = Math.round(val * iarr); }
      for (j = w - radius; j < w; j++) { val += lv - d[li++ * 4 + ch]; tmp[ti++ * 4 + ch] = Math.round(val * iarr); }
    }
    for (x = 0; x < w; x++) {
      ti = x; li = ti; ri = ti + radius * w;
      fv = tmp[x * 4 + ch]; lv = tmp[(x + w * (h - 1)) * 4 + ch];
      val = (radius + 1) * fv;
      for (j = 0; j < radius; j++) val += tmp[(ti + j * w) * 4 + ch];
      for (j = 0; j <= radius; j++) { val += tmp[ri * 4 + ch] - fv; d[ti * 4 + ch] = Math.round(val * iarr); ri += w; ti += w; }
      for (j = radius + 1; j < h - radius; j++) { val += tmp[ri * 4 + ch] - tmp[li * 4 + ch]; d[ti * 4 + ch] = Math.round(val * iarr); li += w; ri += w; ti += w; }
      for (j = h - radius; j < h; j++) { val += lv - tmp[li * 4 + ch]; d[ti * 4 + ch] = Math.round(val * iarr); li += w; ti += w; }
    }
  }
}
function blurCanvas(src, sigma) {
  var w = src.width, h = src.height;
  var out = mkCanvas(w, h);
  var ctx = out.getContext('2d');
  if (HAS_FILTER) {
    ctx.filter = 'blur(' + sigma.toFixed(2) + 'px)';
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
    return out;
  }
  ctx.drawImage(src, 0, 0);
  var id = ctx.getImageData(0, 0, w, h);
  var boxes = boxesForGauss(sigma, 3);
  for (var i = 0; i < 3; i++) {
    var r = (boxes[i] - 1) >> 1;
    if (r > 0) boxBlurRGBA(id.data, w, h, r);
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

function addWeighted(ctx, src, weight) {
  var wgt = weight;
  while (wgt > 0.004) {
    var a = Math.min(1, wgt);
    ctx.globalAlpha = a;
    ctx.drawImage(src, 0, 0);
    wgt -= a;
  }
  ctx.globalAlpha = 1;
}

function composeNeon(cl, w, h, glowStrength, scale, autoContrast) {
  var neon = mkCanvas(w, h);
  var ctx = neon.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  var G = glowStrength;
  addWeighted(ctx, cl, CFG.CORE_W * G);
  addWeighted(ctx, blurCanvas(cl, CFG.INNER_SIGMA * scale), CFG.INNER_W * G);
  addWeighted(ctx, blurCanvas(cl, CFG.OUTER_SIGMA * scale), CFG.OUTER_W * G);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  if (autoContrast) {
    var id = ctx.getImageData(0, 0, w, h);
    var d = id.data;
    var hist = new Uint32Array(256);
    var total = 0, p, c, v;
    for (p = 0; p < d.length; p += 16) {              // sample every 4th pixel
      for (c = 0; c < 3; c++) { v = d[p + c]; if (v > 5) { hist[v]++; total++; } }
    }
    if (total > 0) {
      var target = total * 0.99, acc = 0, ref = 255;
      for (v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { ref = v; break; } }
      if (ref > 1 && ref < 250) {
        var gain = 255 / ref;
        var boosted = mkCanvas(w, h);
        var bctx = boosted.getContext('2d');
        bctx.fillStyle = '#000'; bctx.fillRect(0, 0, w, h);
        if (HAS_FILTER) {
          bctx.filter = 'brightness(' + gain.toFixed(3) + ')';
          bctx.drawImage(neon, 0, 0);
          bctx.filter = 'none';
        } else {
          bctx.globalCompositeOperation = 'lighter';
          addWeighted(bctx, neon, gain);
          bctx.globalCompositeOperation = 'source-over';
        }
        neon = boosted;
      }
    }
  }
  return neon;
}

/* ===================================================== 4. block_mosaic() == */
/* The Python version takes the brightest pixel of each block, so a block goes
   fully bright even if one pixel in it is lit — at 10 px that turns the sparse
   edge map into a solid slab. Here each block keeps the brightest pixel's hue
   but is scaled by how much of the block is actually lit, so the dot field
   reads as the sketch and converges exactly on the neon layer at block size 1. */

function baseGrid(src, w, h, f) {
  var gw = Math.ceil(w / f), gh = Math.ceil(h / f);
  var col = new Uint8Array(gw * gh * 3);
  var mx  = new Float32Array(gw * gh);
  var sm  = new Float32Array(gw * gh);
  var ct  = new Uint32Array(gw * gh);
  for (var gy = 0; gy < gh; gy++) {
    var y0 = gy * f, y1 = Math.min(h, y0 + f);
    for (var gx = 0; gx < gw; gx++) {
      var x0 = gx * f, x1 = Math.min(w, x0 + f);
      var best = -1, br = 0, bg = 0, bb = 0, sum = 0, n = 0;
      for (var y = y0; y < y1; y++) {
        var p = (y * w + x0) * 4;
        for (var x = x0; x < x1; x++, p += 4) {
          var t = src[p] + src[p + 1] + src[p + 2];
          sum += t; n++;
          if (t > best) { best = t; br = src[p]; bg = src[p + 1]; bb = src[p + 2]; }
        }
      }
      var i = gy * gw + gx, c = i * 3;
      col[c] = br; col[c + 1] = bg; col[c + 2] = bb;
      mx[i] = best < 0 ? 0 : best; sm[i] = sum; ct[i] = n || 1;
    }
  }
  return { gw: gw, gh: gh, col: col, mx: mx, sm: sm, ct: ct };
}

function deriveGrid(g, f) {
  var gw = Math.ceil(g.gw / f), gh = Math.ceil(g.gh / f);
  var col = new Uint8Array(gw * gh * 3);
  var mx  = new Float32Array(gw * gh);
  var sm  = new Float32Array(gw * gh);
  var ct  = new Uint32Array(gw * gh);
  for (var gy = 0; gy < gh; gy++) {
    var y0 = gy * f, y1 = Math.min(g.gh, y0 + f);
    for (var gx = 0; gx < gw; gx++) {
      var x0 = gx * f, x1 = Math.min(g.gw, x0 + f);
      var best = -1, br = 0, bg = 0, bb = 0, sum = 0, n = 0;
      for (var y = y0; y < y1; y++) {
        for (var x = x0; x < x1; x++) {
          var pi = y * g.gw + x, pc = pi * 3;
          if (g.mx[pi] > best) { best = g.mx[pi]; br = g.col[pc]; bg = g.col[pc + 1]; bb = g.col[pc + 2]; }
          sum += g.sm[pi]; n += g.ct[pi];
        }
      }
      var i = gy * gw + gx, c = i * 3;
      col[c] = br; col[c + 1] = bg; col[c + 2] = bb;
      mx[i] = best < 0 ? 0 : best; sm[i] = sum; ct[i] = n || 1;
    }
  }
  return { gw: gw, gh: gh, col: col, mx: mx, sm: sm, ct: ct };
}

function gridToCanvas(g, bs, gamma) {
  var img = new ImageData(g.gw, g.gh);
  var d = img.data;
  for (var i = 0, q = 0, c = 0; i < g.gw * g.gh; i++, q += 4, c += 3) {
    var peak = g.mx[i], k = 1;
    if (peak > 0) k = Math.pow(Math.min(1, (g.sm[i] / g.ct[i]) / peak), gamma);
    d[q] = g.col[c] * k; d[q + 1] = g.col[c + 1] * k; d[q + 2] = g.col[c + 2] * k; d[q + 3] = 255;
  }
  var cv = mkCanvas(g.gw, g.gh);
  cv.getContext('2d').putImageData(img, 0, 0);
  return { canvas: cv, gw: g.gw, gh: g.gh, bs: bs, data: img };
}

function drawMosaic(ctx, m) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(m.canvas, 0, 0, m.gw, m.gh, 0, 0, m.gw * m.bs, m.gh * m.bs);
  ctx.imageSmoothingEnabled = true;
}

/* =================================================== 5. add_reflection() == */
function makeReflector(w, h, ratio) {
  var rh = Math.max(1, Math.round(h * ratio));
  var tmp = mkCanvas(w, rh);
  var tctx = tmp.getContext('2d');
  var grad = tctx.createLinearGradient(0, 0, 0, rh);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  return function (ctx, src) {
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, w, rh);
    tctx.save();
    tctx.translate(0, rh);
    tctx.scale(1, -1);
    tctx.drawImage(src, 0, h - rh, w, rh, 0, 0, w, rh);
    tctx.restore();
    tctx.globalCompositeOperation = 'destination-in';
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, w, rh);
    tctx.globalCompositeOperation = 'source-over';

    var go = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.42;
    ctx.drawImage(tmp, 0, h - rh);
    ctx.globalCompositeOperation = go;
    ctx.globalAlpha = ga;
  };
}

/* ========================================================== 6. PREPARE ==== */
function prepare(img, W, H, opts, onProgress) {
  var prog = onProgress || function () {};
  var scale = H / CFG.REF_HEIGHT;
  var thickness = clamp(Math.round(CFG.LINE_THICKNESS * Math.max(0.6, scale)), 1, 3);
  var base, bdata, mask, cl, neon, nd, mos = {}, blocks = [];
  var ambient = null, plate = null;

  return Promise.resolve()
    .then(function () {
      base = mkCanvas(W, H);
      var bctx = base.getContext('2d');
      bctx.fillStyle = '#000'; bctx.fillRect(0, 0, W, H);
      layoutImage(bctx, img, W, H, opts);
      bdata = bctx.getImageData(0, 0, W, H);

      // Letterboxed by more than ~6% of the frame? Light up the bars.
      if (opts.fit === 'contain' && opts.ambient !== false && barFraction(img, W, H) > 0.06) {
        ambient = makeAmbient(img, W, H);
        plate = mkCanvas(W, H);                 // same photo, transparent bars
        containDrawClear(plate.getContext('2d'), img, W, H);
      }
      prog(0.08); return nextFrame();
    })
    .then(function () {
      var gray = toGray(bdata.data, W, H);
      prog(0.14);
      return nextFrame().then(function () { return gray; });
    })
    .then(function (gray) {
      mask = canny(gray, W, H, CFG.EDGE_LOW, CFG.EDGE_HIGH);
      prog(0.40); return nextFrame();
    })
    .then(function () {
      mask = dilate(mask, W, H, thickness);
      prog(0.50); return nextFrame();
    })
    .then(function () {
      cl = colorLayer(bdata, mask, W, H, opts.tint);
      prog(0.58); return nextFrame();
    })
    .then(function () {
      neon = composeNeon(cl, W, H, opts.glowStrength, Math.max(0.5, scale), CFG.AUTO_CONTRAST);
      prog(0.72); return nextFrame();
    })
    .then(function () {
      nd = neon.getContext('2d').getImageData(0, 0, W, H);
      var GA = CFG.MOSAIC_GAMMA;
      var g2 = baseGrid(nd.data, W, H, 2); mos[2] = gridToCanvas(g2, 2, GA);
      prog(0.78);
      return nextFrame().then(function () {
        var g3 = baseGrid(nd.data, W, H, 3); mos[3] = gridToCanvas(g3, 3, GA);
        prog(0.84);
        return nextFrame().then(function () {
          var g5 = baseGrid(nd.data, W, H, 5); mos[5] = gridToCanvas(g5, 5, GA);
          prog(0.90);
          return nextFrame().then(function () {
            var g7 = baseGrid(nd.data, W, H, 7); mos[7] = gridToCanvas(g7, 7, GA);
            var g4  = deriveGrid(g2, 2); mos[4]  = gridToCanvas(g4,  4,  GA);
            var g6  = deriveGrid(g3, 2); mos[6]  = gridToCanvas(g6,  6,  GA);
            var g8  = deriveGrid(g4, 2); mos[8]  = gridToCanvas(g8,  8,  GA);
            var g9  = deriveGrid(g3, 3); mos[9]  = gridToCanvas(g9,  9,  GA);
            var g10 = deriveGrid(g5, 2); mos[10] = gridToCanvas(g10, 10, GA);
            prog(0.96); return nextFrame();
          });
        });
      });
    })
    .then(function () {
      var BS = CFG.MOSAIC_BLOCK_SIZE;
      var top = mos[BS], td = top.data.data;
      for (var gy = 0; gy < top.gh; gy++) {
        for (var gx = 0; gx < top.gw; gx++) {
          var q = (gy * top.gw + gx) * 4;
          var r = td[q], g = td[q + 1], b = td[q + 2];
          var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
          if (mx <= CFG.DARK_PIXEL_SKIP) continue;
          var bx = gx * BS, by = gy * BS;
          var bw = Math.min(BS, W - bx), bh = Math.min(BS, H - by);
          if (bw <= 0 || bh <= 0) continue;
          blocks.push({
            cx: bx + bw / 2, cy: by + bh / 2,
            r: Math.max(1, Math.min(bw, bh) / 2),
            c: 'rgb(' + r + ',' + g + ',' + b + ')'
          });
        }
      }
      var rnd = mulberry32(CFG.RANDOM_SEED);
      for (var i = blocks.length - 1; i > 0; i--) {
        var j = Math.floor(rnd() * (i + 1));
        var t = blocks[i]; blocks[i] = blocks[j]; blocks[j] = t;
      }
      prog(1);
      return nextFrame();
    })
    .then(function () {
      return { W: W, H: H, base: base, neon: neon, mos: mos, blocks: blocks,
               ambient: ambient, plate: plate };
    });
}

/* =========================================================== 7. PLAYER ==== */
function createPlayer(canvas) {
  var ctx = canvas.getContext('2d', { alpha: false });
  var raf = 0, asset = null, reflect = null, dotLayer = null, dctx = null;
  var timeline = [], total = 0, t0 = 0, paused = false, pausedAt = 0;
  var revealed = 0, cbUpdate = null, cbDone = null, useReflection = true, bright = 1;

  function present(drawFn, withReflection) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, asset.W, asset.H);
    if (HAS_FILTER && bright !== 1) ctx.filter = 'brightness(' + bright.toFixed(3) + ')';
    drawFn(ctx);
    ctx.filter = 'none';
    if (withReflection && useReflection) reflect(ctx, canvas);
  }

  /* The photograph. When the picture is letterboxed we paint the ambient
     backdrop first and then the untouched, uncropped photo on top of it. */
  function drawPhoto(c, alpha) {
    c.globalAlpha = alpha;
    if (asset.ambient) { c.drawImage(asset.ambient, 0, 0); c.drawImage(asset.plate, 0, 0); }
    else c.drawImage(asset.base, 0, 0);
    c.globalAlpha = 1;
  }

  function phaseAt(t) {
    var acc = 0;
    for (var i = 0; i < timeline.length; i++) {
      acc += timeline[i].d;
      if (t < acc) return timeline[i].k;
    }
    return 'photo';
  }

  function frame(now) {
    if (!asset) return;
    raf = requestAnimationFrame(frame);
    if (paused) return;

    var t = (now - t0) / 1000;
    if (cbUpdate) cbUpdate(clamp(t / total, 0, 1), phaseAt(t));

    var acc = 0, ph = null, local = 0;
    for (var i = 0; i < timeline.length; i++) {
      if (t < acc + timeline[i].d || i === timeline.length - 1) {
        ph = timeline[i]; local = clamp((t - acc) / timeline[i].d, 0, 1); break;
      }
      acc += timeline[i].d;
    }
    if (!ph) return;

    if (ph.k === 'dots') {
      var target = Math.floor(asset.blocks.length * local);
      for (var b = revealed; b < target; b++) {
        var bl = asset.blocks[b];
        dctx.fillStyle = bl.c;
        dctx.beginPath();
        dctx.arc(bl.cx, bl.cy, bl.r, 0, 6.283185307179586);
        dctx.fill();
      }
      revealed = target;
      present(function (c) { c.drawImage(dotLayer, 0, 0); }, true);

    } else if (ph.k === 'refine') {
      var bs = Math.max(1, Math.floor(CFG.MOSAIC_BLOCK_SIZE * Math.pow(1 - local, 2)));
      present(function (c) {
        if (bs <= 1) c.drawImage(asset.neon, 0, 0);
        else drawMosaic(c, asset.mos[bs]);
      }, true);

    } else if (ph.k === 'hold') {
      present(function (c) { c.drawImage(asset.neon, 0, 0); }, true);

    } else if (ph.k === 'fade') {
      present(function (c) {
        c.drawImage(asset.neon, 0, 0);
        drawPhoto(c, local);
      }, false);

    } else {
      present(function (c) { drawPhoto(c, 1); }, false);
    }

    if (t >= total) {
      cancelAnimationFrame(raf); raf = 0;
      if (cbDone) cbDone();
    }
  }

  return {
    load: function (a) {
      asset = a;
      canvas.width = a.W; canvas.height = a.H;
      dotLayer = mkCanvas(a.W, a.H);
      dctx = dotLayer.getContext('2d');
      reflect = makeReflector(a.W, a.H, CFG.REFLECTION_HEIGHT_RATIO);
    },
    play: function (speed, opts) {
      cancelAnimationFrame(raf);
      var s = SPEEDS[speed] || SPEEDS.fast;
      timeline = [
        { k: 'dots',   d: s.dot },
        { k: 'refine', d: s.refine },
        { k: 'hold',   d: s.hold },
        { k: 'fade',   d: s.fade },
        { k: 'photo',  d: s.final }
      ];
      total = 0;
      for (var i = 0; i < timeline.length; i++) total += timeline[i].d;
      useReflection = opts.reflection !== false;
      bright = opts.brightness || 1;
      cbUpdate = opts.onUpdate || null;
      cbDone = opts.onDone || null;
      revealed = 0;
      paused = false;
      dctx.clearRect(0, 0, asset.W, asset.H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, asset.W, asset.H);
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    },
    togglePause: function () {
      if (!raf) return paused;
      if (paused) { t0 += performance.now() - pausedAt; paused = false; }
      else { pausedAt = performance.now(); paused = true; }
      return paused;
    },
    stop: function () { cancelAnimationFrame(raf); raf = 0; }
  };
}

/* =================================================== 8. IMAGE LOADING ===== */
var imgCache = {};
function loadImage(src) {
  if (imgCache[src]) return imgCache[src];
  var p = new Promise(function (res, rej) {
    var im = new Image();
    im.onload = function () { res(im); };
    im.onerror = function () { rej(new Error('Could not load ' + src)); };
    im.decoding = 'async';
    im.src = src;
  });
  imgCache[src] = p;
  return p;
}

/* Chrome treats file:// as an opaque origin, so getImageData on an image from
   images/ throws there. Detect it once and degrade honestly. */
function pixelsReadable(img) {
  try {
    var c = mkCanvas(2, 2);
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.getImageData(0, 0, 1, 1);
    return true;
  } catch (e) { return false; }
}

/* ============================================================ 9. STATE ==== */
var state = {
  current: DEITIES[0].id,
  seq: [DEITIES[0].id],
  mode: 'original',            // original | sketch
  speed: 'quick',
  framing: 'contain',          // contain | upper | cover
  glow: 'original',
  reflection: true,
  brightness: CFG.DISPLAY_BRIGHTNESS,
  playing: false,
  queue: [],
  idx: 0
};
var BUNDLED_READABLE = true;

function byId(id) {
  for (var i = 0; i < DEITIES.length; i++) if (DEITIES[i].id === id) return DEITIES[i];
  return null;
}
function isReadable(d) { return d.uploaded ? true : BUNDLED_READABLE; }

/* ======================================================== 10. ELEMENTS ==== */
var elGrid = $('#deityGrid'), elCount = $('#countPill'), elGo = $('#goBtn'), elMeta = $('#launchMeta');
var mainImage = $('#mainImage'), mainBlur = $('#mainBlur'), mainSketch = $('#mainSketch'), mainName = $('#mainName'), mainSub = $('#mainSub');
var tabOriginal = $('#tabOriginal'), tabSketch = $('#tabSketch'), shotSpin = $('#shotSpin');
var addSeqBtn = $('#addSeqBtn'), resetBtn = $('#resetBtn'), dlBtn = $('#dlBtn');
var lightbox = $('#lightbox'), lbImage = $('#lbImage'), lbCap = $('#lbCap');
var stage = $('#stage'), view = $('#view'), veil = $('#veil'), ringFg = $('#ringFg'), veilName = $('#veilName');
var hud = $('#hud'), nowName = $('#nowName'), nowPhase = $('#nowPhase'), barFill = $('#barFill');
var dotsNav = $('#dotsNav'), endcard = $('#endcard'), toastEl = $('#toast');
var player = createPlayer(view);

var RING_LEN = 2 * Math.PI * 34;
ringFg.style.strokeDasharray = RING_LEN;

var PHASE_LABEL = {
  dots: 'Dot formation', refine: 'Refining', hold: 'Neon darshan',
  fade: 'Crossfade', photo: 'Full darshan'
};

/* ==================================================== 11. DEITY CARDS ===== */
function renderGrid() {
  elGrid.innerHTML = '';
  DEITIES.forEach(function (d) {
    var b = document.createElement('button');
    b.className = 'card';
    b.type = 'button';
    b.dataset.id = d.id;
    b.innerHTML =
      '<span class="shot">' +
        '<img src="' + d.src + '" alt="' + d.name + '" loading="lazy">' +
        '<span class="shade"></span>' +
        '<span class="ord"></span>' +
        '<span class="name">' + d.name + '<small>' + d.sub + '</small></span>' +
      '</span>' +
      '<span class="tick" role="checkbox" tabindex="0" aria-label="Add ' + d.name + ' to the sequence">' +
        '<i><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></i>' +
      '</span>';

    b.addEventListener('click', function (e) {
      if (e.target.closest('.tick')) return;
      selectDeity(d.id);
    });
    var tick = b.querySelector('.tick');
    tick.addEventListener('click', function (e) { e.stopPropagation(); toggleSeq(d.id); });
    tick.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSeq(d.id); }
    });
    elGrid.appendChild(b);
  });

  var up = document.createElement('button');
  up.className = 'card upload';
  up.type = 'button';
  up.innerHTML =
    '<span class="shot"><span class="inner">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v13"/>' +
      '</svg>' +
      '<span class="t1">Your own photo</span><span class="t2">JPG / PNG</span>' +
    '</span></span>';
  up.addEventListener('click', function () { $('#fileInput').click(); });
  elGrid.appendChild(up);

  syncUI();
}

function selectDeity(id) {
  if (state.current === id) return;
  var d = byId(id);
  if (!d) return;
  state.current = id;

  mainImage.classList.add('swapping');
  if (mainBlur) mainBlur.style.opacity = '0';
  window.setTimeout(function () {
    mainImage.src = d.src;
    mainImage.alt = d.name;
    if (mainBlur) { mainBlur.src = d.src; mainBlur.style.opacity = ''; }
    mainName.textContent = d.name;
    mainSub.textContent = d.sub;
    mainImage.classList.remove('swapping');
  }, 200);

  if (state.mode === 'sketch') buildSketch();
  syncUI();
}

function toggleSeq(id) {
  var i = state.seq.indexOf(id);
  if (i >= 0) state.seq.splice(i, 1);
  else state.seq.push(id);
  syncUI();
}

function syncUI() {
  $$('.card[data-id]', elGrid).forEach(function (b) {
    var n = state.seq.indexOf(b.dataset.id);
    b.dataset.seq = n >= 0 ? 'true' : 'false';
    b.dataset.active = b.dataset.id === state.current ? 'true' : 'false';
    var t = b.querySelector('.tick');
    if (t) t.setAttribute('aria-checked', n >= 0 ? 'true' : 'false');
    var o = b.querySelector('.ord');
    if (o) o.textContent = n >= 0 ? String(n + 1) : '';
  });

  var n = state.seq.length;
  elCount.innerHTML = '<b>' + n + '</b> in sequence';

  var inSeq = state.seq.indexOf(state.current) >= 0;
  addSeqBtn.textContent = inSeq ? '✓ In sequence' : '＋ Add to sequence';
  addSeqBtn.setAttribute('aria-pressed', inSeq ? 'true' : 'false');

  var s = SPEEDS[state.speed];
  var per = s.dot + s.refine + s.hold + s.fade + s.final;
  var sketchTime = s.dot + s.refine;

  var playable = state.seq.filter(function (id) { var d = byId(id); return d && isReadable(d); });
  elGo.disabled = playable.length === 0;

  if (n === 0) {
    elMeta.textContent = 'Pick at least one deity to begin.';
  } else if (playable.length === 0) {
    elMeta.textContent = 'Pixel access is blocked on file:// — upload your own photo, or open this page over http.';
  } else {
    elMeta.innerHTML = '<b>' + playable.length + '</b> darshan' + (playable.length > 1 ? 's' : '') +
      ' &middot; dots &rarr; full sketch in <b>' + sketchTime.toFixed(1) + 's</b>' +
      ' &middot; total <b>' + (per * playable.length).toFixed(0) + 's</b>';
  }

  // per-stage durations shown in the timeline
  var durs = [s.dot, s.refine, s.hold, s.fade, s.final];
  $$('#timeline [data-dur]').forEach(function (el, i) { el.textContent = durs[i].toFixed(1) + 's'; });

  // sketch tab availability
  var cur = byId(state.current);
  var canSketch = cur && isReadable(cur);
  tabSketch.disabled = !canSketch;
  dlBtn.disabled = !canSketch || state.mode !== 'sketch';
  tabSketch.title = canSketch ? '' : 'Needs pixel access — open this page over http, or upload your own photo';
}

/* ============================================= 12. MAIN "NEON SKETCH" ===== */
var sketchToken = 0;

function buildSketch() {
  var d = byId(state.current);
  if (!d || !isReadable(d)) return;
  var token = ++sketchToken;

  shotSpin.classList.remove('hide');
  dlBtn.disabled = true;

  loadImage(d.src).then(function (img) {
    if (token !== sketchToken) return null;
    // canvas keeps the image's own aspect ratio, so CSS object-fit: contain
    // displays it exactly like the <img> — nothing is cropped or stretched.
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var k = Math.sqrt(CFG.SKETCH_PIXELS / (iw * ih));
    if (k > 1) k = 1;
    var W = Math.max(64, Math.round(iw * k));
    var H = Math.max(64, Math.round(ih * k));
    return prepare(img, W, H, {
      fit: 'fill',
      tint: GLOWS[state.glow],
      glowStrength: CFG.GLOW_STRENGTH
    }, function () {});
  }).then(function (a) {
    if (!a || token !== sketchToken) return;
    mainSketch.width = a.W;
    mainSketch.height = a.H;
    var c = mainSketch.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, a.W, a.H);
    if (HAS_FILTER && state.brightness !== 1) c.filter = 'brightness(' + state.brightness.toFixed(3) + ')';
    c.drawImage(a.neon, 0, 0);
    c.filter = 'none';
    shotSpin.classList.add('hide');
    dlBtn.disabled = false;
  }).catch(function () {
    if (token !== sketchToken) return;
    shotSpin.classList.add('hide');
    toast('Could not trace this image.');
    setMode('original');
  });
}

function setMode(mode) {
  state.mode = mode;
  var sketch = mode === 'sketch';
  tabOriginal.setAttribute('aria-selected', sketch ? 'false' : 'true');
  tabSketch.setAttribute('aria-selected', sketch ? 'true' : 'false');
  mainImage.classList.toggle('hide', sketch);
  mainSketch.classList.toggle('hide', !sketch);
  if (sketch) buildSketch();
  else { shotSpin.classList.add('hide'); sketchToken++; }
  syncUI();
}

tabOriginal.addEventListener('click', function () { setMode('original'); });
tabSketch.addEventListener('click', function () { setMode('sketch'); });

resetBtn.addEventListener('click', function () {
  setMode('original');
  state.glow = 'original';
  $$('#swatches .sw').forEach(function (x) {
    x.setAttribute('aria-pressed', x.dataset.v === 'original' ? 'true' : 'false');
  });
  toast('Back to the original photo');
});

dlBtn.addEventListener('click', function () {
  if (state.mode !== 'sketch') { toast('Switch to the Neon sketch tab first'); return; }
  try {
    mainSketch.toBlob(function (blob) {
      if (!blob) { toast('Could not export the image'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.current + '_neon_sketch.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  } catch (e) {
    toast('Export blocked by the browser');
  }
});

addSeqBtn.addEventListener('click', function () { toggleSeq(state.current); });

/* ========================================================= 13. LIGHTBOX === */
function openLightbox() {
  var d = byId(state.current);
  if (state.mode === 'sketch' && !mainSketch.classList.contains('hide')) {
    try { lbImage.src = mainSketch.toDataURL('image/png'); }
    catch (e) { lbImage.src = d.src; }
    lbCap.textContent = d.name + ' — neon sketch';
  } else {
    lbImage.src = d.src;
    lbCap.textContent = d.name + ' — ' + d.sub;
  }
  lbImage.alt = d.name;
  lightbox.classList.remove('hide');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  lightbox.classList.add('hide');
  if (!state.playing) document.body.style.overflow = '';
}
$('#expandBtn').addEventListener('click', openLightbox);
$('#lbClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });

/* ======================================================== 14. TIMELINE ==== */
$$('#timeline .tl-head').forEach(function (head) {
  head.addEventListener('click', function () {
    var item = head.parentNode;
    var open = item.classList.contains('open');
    $$('#timeline .tl-item').forEach(function (it) {
      it.classList.remove('open');
      it.querySelector('.tl-head').setAttribute('aria-expanded', 'false');
    });
    if (!open) { item.classList.add('open'); head.setAttribute('aria-expanded', 'true'); }
  });
});
$('#timeline .tl-item').classList.add('open');

function highlightPhase(phase) {
  $$('#timeline .tl-item').forEach(function (it) {
    it.classList.toggle('active', it.dataset.phase === phase);
  });
}
function clearPhase() { $$('#timeline .tl-item').forEach(function (it) { it.classList.remove('active'); }); }

/* ================================================== 15. SMOOTH SCROLLING == */
$$('a[data-scroll]').forEach(function (a) {
  a.addEventListener('click', function (e) {
    var t = document.querySelector(a.getAttribute('href'));
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ========================================================= 16. UPLOAD ===== */
$('#fileInput').addEventListener('change', function (e) {
  var f = e.target.files && e.target.files[0];
  if (!f) return;
  var fr = new FileReader();
  fr.onload = function () {
    var id = 'custom-' + Date.now();
    DEITIES.push({
      id: id,
      name: (f.name.replace(/\.[^.]+$/, '') || 'My photo').slice(0, 22),
      sub: 'Your upload',
      src: fr.result,
      rect: [0.02, 0.00, 0.98, 0.64],
      face: [0.5, 0.28],
      uploaded: true
    });
    renderGrid();
    if (state.seq.indexOf(id) < 0) state.seq.push(id);
    selectDeity(id);
    syncUI();
    $('#gallery').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  fr.readAsDataURL(f);
  e.target.value = '';
});

/* ========================================================== 17. PLAYER ==== */
var assetCache = {}, hudTimer = 0, building = false, prefetching = false, lastVp = null, resizeTimer = 0;

function viewport() {
  var cssW = Math.max(1, stage.clientWidth || window.innerWidth);
  var cssH = Math.max(1, stage.clientHeight || window.innerHeight);
  var dpr = Math.min(window.devicePixelRatio || 1, CFG.MAX_DPR);
  var W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  var px = W * H;
  if (px > CFG.MAX_PIXELS) {
    var k = Math.sqrt(CFG.MAX_PIXELS / px);
    W = Math.round(W * k); H = Math.round(H * k);
  }
  return { W: W, H: H };
}

function assetKey(d, W, H) { return [d.id, W, H, state.framing, state.glow].join('|'); }

function buildAsset(d, W, H, onProg) {
  var key = assetKey(d, W, H);
  if (assetCache[key]) return Promise.resolve(assetCache[key]);
  return loadImage(d.src).then(function (img) {
    return prepare(img, W, H, {
      fit: state.framing,
      rect: d.rect,
      face: d.face,
      tint: GLOWS[state.glow],
      glowStrength: CFG.GLOW_STRENGTH
    }, onProg);
  }).then(function (a) {
    var keys = Object.keys(assetCache);
    while (keys.length >= 3) { delete assetCache[keys[0]]; keys.shift(); }
    assetCache[key] = a;
    return a;
  });
}

var veilTimer = 0;
function showVeil(name) {
  clearTimeout(veilTimer);
  veilName.textContent = name;
  veil.classList.remove('out', 'hide');
  setRing(0);
}
function setRing(p) { ringFg.style.strokeDashoffset = RING_LEN * (1 - p); }
function hideVeil() {
  clearTimeout(veilTimer);
  veil.classList.add('out');
  veilTimer = setTimeout(function () { veil.classList.add('hide'); }, 420);
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
}

function renderDotsNav() {
  dotsNav.innerHTML = '';
  state.queue.forEach(function (d, i) {
    var b = document.createElement('b');
    if (i === state.idx) b.className = 'on';
    b.title = d.name;
    b.addEventListener('click', function (e) { e.stopPropagation(); jumpTo(i); });
    dotsNav.appendChild(b);
  });
}

function armHud() {
  hud.classList.remove('dim');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(function () { hud.classList.add('dim'); }, 2600);
}

function enterStage() {
  var playable = state.seq.map(byId).filter(function (d) { return d && isReadable(d); });
  if (!playable.length) return;
  stopPreviewLoop();
  clearPhase();

  state.queue = playable;
  state.idx = 0;
  state.playing = true;
  stage.classList.remove('hide');
  document.body.style.overflow = 'hidden';
  endcard.classList.add('hide');
  renderDotsNav();
  armHud();

  try {
    var rq = stage.requestFullscreen || stage.webkitRequestFullscreen || stage.msRequestFullscreen;
    var allowed = document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
    if (rq && allowed) { var pr = rq.call(stage); if (pr && pr.catch) pr.catch(function () {}); }
  } catch (e) { /* iPhone Safari: the overlay already fills the viewport */ }

  nextFrame().then(runCurrent);
}

function runCurrent() {
  var d = state.queue[state.idx];
  if (!d) return;
  var vp = viewport();
  lastVp = vp;
  var key = assetKey(d, vp.W, vp.H);

  nowName.textContent = d.name;
  nowPhase.textContent = 'Preparing';
  renderDotsNav();

  var step = assetCache[key]
    ? Promise.resolve(assetCache[key])
    : (showVeil(d.name), building = true, buildAsset(d, vp.W, vp.H, setRing));

  step.then(function (a) {
    building = false;
    hideVeil();
    player.load(a);
    player.play(state.speed, {
      reflection: state.reflection,
      brightness: state.brightness,
      onUpdate: function (p, phase) {
        barFill.style.width = (p * 100).toFixed(1) + '%';
        nowPhase.textContent = PHASE_LABEL[phase] || '';
        if (phase === 'hold' || phase === 'fade') prefetchNext(vp);
      },
      onDone: function () {
        if (state.idx < state.queue.length - 1) { state.idx++; runCurrent(); }
        else finish();
      }
    });
    armHud();
  }).catch(function () {
    building = false;
    hideVeil();
    toast('Could not prepare that image.');
    exitStage();
  });
}

function prefetchNext(vp) {
  if (prefetching || building) return;
  var nx = state.queue[state.idx + 1];
  if (!nx) return;
  var key = assetKey(nx, vp.W, vp.H);
  if (assetCache[key]) return;
  prefetching = true;
  buildAsset(nx, vp.W, vp.H, function () {})
    .catch(function () {})
    .then(function () { prefetching = false; });
}

function finish() { endcard.classList.remove('hide'); hud.classList.remove('dim'); }

function jumpTo(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.idx = i;
  endcard.classList.add('hide');
  player.stop();
  runCurrent();
}

function replayAll() {
  endcard.classList.add('hide');
  state.idx = 0;
  player.stop();
  runCurrent();
}

function exitStage() {
  player.stop();
  state.playing = false;
  stage.classList.add('hide');
  endcard.classList.add('hide');
  if (lightbox.classList.contains('hide')) document.body.style.overflow = '';
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      var ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) { var pr = ex.call(document); if (pr && pr.catch) pr.catch(function () {}); }
    }
  } catch (e) {}
  startPreviewLoop();
}

elGo.addEventListener('click', enterStage);
$('#backBtn').addEventListener('click', function (e) { e.stopPropagation(); exitStage(); });
$('#replayBtn').addEventListener('click', function (e) { e.stopPropagation(); replayAll(); });
$('#nextBtn').addEventListener('click', function (e) {
  e.stopPropagation();
  if (state.idx < state.queue.length - 1) jumpTo(state.idx + 1);
  else { player.stop(); finish(); }
});
$('#endReplay').addEventListener('click', replayAll);
$('#endBack').addEventListener('click', exitStage);

stage.addEventListener('click', function () {
  if (!endcard.classList.contains('hide')) return;
  if (hud.classList.contains('dim')) armHud();
  else { toast(player.togglePause() ? 'Paused' : 'Resumed'); armHud(); }
});
stage.addEventListener('mousemove', function () { if (state.playing) armHud(); });

document.addEventListener('keydown', function (e) {
  if (!lightbox.classList.contains('hide')) {
    if (e.key === 'Escape') closeLightbox();
    return;
  }
  if (!state.playing) return;
  var k = e.key.toLowerCase();
  if (k === 'escape' || k === 'q') exitStage();
  else if (k === ' ') { e.preventDefault(); toast(player.togglePause() ? 'Paused' : 'Resumed'); armHud(); }
  else if (k === 'r') replayAll();
  else if (k === 'arrowright' || k === 'n') jumpTo(state.idx + 1);
  else if (k === 'arrowleft' || k === 'p') jumpTo(state.idx - 1);
  else if (k === 'f') {
    var rq = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!document.fullscreenElement && rq && document.fullscreenEnabled !== false) {
      try { var pr = rq.call(stage); if (pr && pr.catch) pr.catch(function () {}); } catch (err) {}
    }
  }
});

window.addEventListener('resize', function () {
  if (!state.playing) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    var vp = viewport();
    if (lastVp && Math.abs(vp.W - lastVp.W) < 24 && Math.abs(vp.H - lastVp.H) < 24) return;
    lastVp = vp;
    assetCache = {};
    if (!building) { player.stop(); runCurrent(); }
  }, 320);
});
window.addEventListener('orientationchange', function () {
  if (state.playing) setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 260);
});

/* ================================================= 18. HERO LIVE PREVIEW == */
var pvCanvas = $('#previewCanvas');
var pvPlayer = createPlayer(pvCanvas);
var pvLabel = $('#pvLabel');
var pvIdx = 0, pvAlive = false, pvBusy = false, pvTimer = 0, pvCache = {};
var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function previewStep() {
  if (!pvAlive || pvBusy) return;
  pvBusy = true;
  var d = DEITIES[pvIdx % DEITIES.length];
  pvLabel.textContent = d.name;

  loadImage(d.src).then(function (img) {
    if (!pvAlive) return null;
    // deliberately modest: this canvas is ~300 CSS px wide, and every extra
    // pixel is main-thread Canny work that would jank the page while scrolling
    var W = 340, H = 604;
    var ck = [d.id, W, H, state.glow].join('|');
    if (pvCache[ck]) return pvCache[ck];
    return prepare(img, W, H, {
      fit: 'upper', rect: d.rect, face: d.face,
      tint: GLOWS[state.glow], glowStrength: CFG.GLOW_STRENGTH
    }, function () {}).then(function (a) {
      var ks = Object.keys(pvCache);
      while (ks.length >= 3) { delete pvCache[ks[0]]; ks.shift(); }
      pvCache[ck] = a;
      return a;
    });
  }).then(function (a) {
    if (!a || !pvAlive) { pvBusy = false; return; }
    pvPlayer.load(a);
    pvPlayer.play('fast', {
      reflection: true,
      brightness: CFG.DISPLAY_BRIGHTNESS,
      onUpdate: function (p, phase) { if (pvAlive && !state.playing) highlightPhase(phase); },
      onDone: function () {
        pvBusy = false; pvIdx++;
        pvTimer = setTimeout(previewStep, 550);
      }
    });
  }).catch(function () {
    pvBusy = false; pvIdx++;
    pvTimer = setTimeout(previewStep, 900);
  });
}

var pvOnScreen = true;

function startPreviewLoop() {
  if (pvAlive || REDUCED || !BUNDLED_READABLE || !pvOnScreen || document.hidden) return;
  pvAlive = true;
  pvTimer = setTimeout(previewStep, 350);
}
function stopPreviewLoop() {
  pvAlive = false; pvBusy = false;
  clearTimeout(pvTimer);
  pvPlayer.stop();
  clearPhase();
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) stopPreviewLoop();
  else if (!state.playing) startPreviewLoop();
});

/* Tracing an image is a couple of hundred milliseconds of main-thread work.
   Run the loop only while something it drives is on screen: the hero canvas
   itself, or the stage list whose "active" highlight it animates. Below that
   there is nothing to look at, so it stops — scrolling stays smooth and
   phone batteries are spared. */
if ('IntersectionObserver' in window) {
  var pvWatch = [pvCanvas, $('#timeline')].filter(Boolean);
  var pvSeen = new WeakMap();
  var pvIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { pvSeen.set(en.target, en.isIntersecting); });
    pvOnScreen = pvWatch.some(function (el) { return pvSeen.get(el); });
    if (!pvOnScreen) stopPreviewLoop();
    else if (!state.playing) startPreviewLoop();
  }, { threshold: 0.08 });
  pvWatch.forEach(function (el) { pvIO.observe(el); });
}

/* ============================================================ 19. OPTS ==== */
function wireSeg(sel, key, after) {
  $$(sel + ' button').forEach(function (b) {
    b.addEventListener('click', function () {
      state[key] = b.dataset.v;
      $$(sel + ' button').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      if (after) after();
    });
  });
}

wireSeg('#segSpeed', 'speed', syncUI);
wireSeg('#segFraming', 'framing', function () { assetCache = {}; });

$$('#swatches .sw').forEach(function (b) {
  b.addEventListener('click', function () {
    state.glow = b.dataset.v;
    $$('#swatches .sw').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    assetCache = {}; pvCache = {};
    stopPreviewLoop();
    setTimeout(startPreviewLoop, 120);
    if (state.mode === 'sketch') buildSketch();
  });
});

$('#tglReflect').addEventListener('click', function () {
  state.reflection = !state.reflection;
  this.setAttribute('aria-pressed', state.reflection ? 'true' : 'false');
});
$('#tglBright').addEventListener('click', function () {
  state.brightness = state.brightness === 1 ? CFG.DISPLAY_BRIGHTNESS : 1;
  this.setAttribute('aria-pressed', state.brightness !== 1 ? 'true' : 'false');
  if (state.mode === 'sketch') buildSketch();
});

$('#selectAll').addEventListener('click', function () {
  state.seq = DEITIES.map(function (d) { return d.id; });
  syncUI();
});
$('#clearAll').addEventListener('click', function () { state.seq = []; syncUI(); });

/* ============================================================ 20. BOOT ==== */
renderGrid();

loadImage(DEITIES[0].src).then(function (img) {
  BUNDLED_READABLE = pixelsReadable(img);
  if (!BUNDLED_READABLE) {
    $('#taintNote').classList.remove('hide');
    $('#taintText').innerHTML =
      '<b>Opened straight from the file system.</b> Chrome blocks scripts from reading the ' +
      'pixels of a local file, so the neon tracing is unavailable here. Everything works ' +
      'normally once the folder is published on GitHub Pages (or served over any http host) ' +
      '&mdash; and <b>uploading your own photo</b> works even now.';
    var frame = $('.preview-frame');
    if (frame) {
      frame.innerHTML = '<img src="' + DEITIES[0].src + '" alt="Sri Venkateswara" ' +
        'style="width:100%;height:100%;object-fit:contain">';
    }
  }
  syncUI();
  startPreviewLoop();
}).catch(function () {
  BUNDLED_READABLE = false;
  syncUI();
});

if (!HAS_FILTER) {
  console.info('Canvas filter() unsupported — using the JS box-blur fallback for the bloom.');
}

/* Small debug hook (harmless in production, handy when retuning constants) */
window.DivineDarshan = {
  CFG: CFG, SPEEDS: SPEEDS, GLOWS: GLOWS, DEITIES: DEITIES,
  prepare: prepare, loadImage: loadImage, createPlayer: createPlayer, state: state
};

})();
