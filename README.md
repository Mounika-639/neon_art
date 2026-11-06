# Divine Darshan — Neon Sketch Reveal

A browser port of the OpenCV "Neon Sketch Reveal" script. Glowing dots gather out of
darkness, tighten into a neon line drawing of the deity, hold, then crossfade into the
full photograph — with the mirror reflection along the floor.

**Frontend only.** HTML, CSS and vanilla JavaScript. No Python, no Flask, no Node, no
PHP, no backend API, no database, no build step, no npm install. Open `index.html` over
http and it runs.

---

## Files

```
divine-darshan/
├── index.html      welcome page, gallery, stage list, options, full-screen player
├── style.css       all styling, responsive down to 360 px
├── script.js       the whole engine + every interaction (one classic <script>, no modules)
├── README.md       this file
└── images/
    ├── swamy_photo.jpeg    Sri Venkateswara   736 × 1308
    ├── ganesha.jpg         Sri Ganesha        941 × 1672
    ├── shiva.jpg           Sri Shiva          941 × 1672
    ├── lakshmi.jpg         Sri Lakshmi        941 × 1672
    ├── krishna.jpg         Sri Krishna        941 × 1672
    └── hanuman.jpg         Sri Hanuman        941 × 1672
```

Total ≈ 2.1 MB, of which 2.0 MB is the photographs. Every path in the HTML and JS is
relative (`images/krishna.jpg`), so the site works from any sub-folder and from a
GitHub Pages project URL such as `https://user.github.io/divine-darshan/`.

---

## Deploy to GitHub Pages

1. Create a repository (for example `divine-darshan`).
2. Upload the **contents** of this folder to the repository root — `index.html`,
   `style.css`, `script.js` and the whole `images/` folder.
   `index.html` must sit at the top level, not inside a sub-folder.
3. **Settings → Pages**.
4. **Source:** *Deploy from a branch*. **Branch:** `main`, folder `/ (root)`. **Save**.
5. Wait about a minute, then open `https://<your-username>.github.io/<repo-name>/`.

Command line, if you prefer:

```bash
cd divine-darshan
git init
git add .
git commit -m "Divine Darshan"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
# then do steps 3-5 above
```

Any other static host works identically: Netlify (drag the folder in), Vercel,
Cloudflare Pages, Firebase Hosting, or plain Apache/Nginx.

### Adding or swapping deities

Drop a `.jpg` into `images/`, then add one entry to the `DEITIES` array near the top of
`script.js`:

```js
{ id: 'durga', name: 'Sri Durga', sub: 'Mahishasuramardini',
  src: 'images/durga.jpg',
  rect: [0.05, 0.08, 0.95, 0.62],   // upper-body box, used by the Fill modes
  face: [0.50, 0.27] }              // focal point, keeps the face in frame
```

`rect` and `face` are normalised 0–1 and only affect the two **Fill** framing modes.
The default **Fit** mode shows the whole picture and ignores them.

---

## Testing locally

Opening `index.html` by double-clicking gives a `file://` page, and **Chrome blocks
scripts from reading the pixels of a local file**. The gallery, the selection, the
lightbox and the layout all work, but the neon tracing cannot run — the page says so
in a banner instead of pretending. Serve the folder over http instead:

```bash
# Python (any version 3.x)
python3 -m http.server 8080
# then open http://localhost:8080

# or VS Code: right-click index.html -> "Open with Live Server"
```

*(This is only for previewing on your own machine — the deployed site needs no server
process of any kind.)*

Firefox is more permissive and usually runs the full experience straight from
`file://`.

---

## What the page does

**Welcome page**

- Live hero preview that keeps cycling through all six deities.
- Gallery: tap a card to preview it; tick the badge to add it to the play sequence.
  *Select all* / *Clear*, plus an ordered 1, 2, 3… badge on each queued card.
- **Original photo / Neon sketch** tabs on the main image, with *Save sketch* (PNG
  download), *Reset*, and an expand button for a full-screen, uncropped viewer.
- Upload your own photo — it never leaves your browser.
- Five-stage accordion. The stage currently running in the hero preview lights up.
- Options: reveal speed, framing, glow colour, mirror reflection, screen boost.
- An honest "What was ported" section.

**Player**

| key | action | | key | action |
|---|---|---|---|---|
| `Esc` / `Q` | exit | | `→` / `N` | next deity |
| `Space` | pause | | `←` / `P` | previous |
| `R` | replay | | `F` | fullscreen |

Tap or click the canvas to pause. Progress bar, per-deity dots and the current stage
name are in the HUD.

**Timing** — the Python original takes about 14 s. The default **Quick** preset reaches
the finished sketch in **1.3 s** and the full photograph in **4 s**:

| preset | dots | refine | hold | crossfade | photo | total |
|---|---|---|---|---|---|---|
| Quick *(default)* | 0.7 s | 0.6 s | 0.4 s | 0.7 s | 1.6 s | **4.0 s** |
| Fast | 1.1 s | 0.9 s | 0.6 s | 0.9 s | 2.2 s | 5.7 s |
| Classic *(Python timings)* | 3.5 s | 3.0 s | 3.0 s | 1.5 s | 3.0 s | 14.0 s |

**Framing** — default is **Fit**: `object-fit: contain`, the whole deity always visible,
never cropped and never stretched. The letterbox is filled with a soft blurred spill of
the picture's own colour rather than dead black; that backdrop is decorative and is
never fed to the edge detector. The two **Fill** modes (upper body, centred) cover the
screen edge to edge and therefore do trim the image — they are opt-in.

**Responsive** — one column below 980 px, a two-column deity grid below 620 px, sticky
launch bar with safe-area insets, `44 px` minimum touch targets, and the player canvas
is rebuilt on rotation. Device pixel ratio is capped at 2 and the canvas at 2.6 MP so a
phone does not try to trace a 12 MP surface.

---

## What was ported, and what could not be

The same breakdown is on the page itself, in section 4.

### Genuinely re-implemented in JavaScript

Real algorithms in `script.js`, not stand-ins:

| Python | JavaScript |
|---|---|
| `cv2.Canny` | Sobel gradients → 4-bin non-maximum suppression → double threshold → stack-based hysteresis |
| `cv2.dilate`, 3×3 kernel, N iterations | separable 3×3 max filter — exact |
| HSV saturation / value boost on edge pixels | exact, same `S_GAIN` / `V_GAIN` / `V_LIFT` maths |
| `get_block_grid`, `DARK_PIXEL_SKIP` | same 10 px grid and skip threshold |
| seeded shuffle, dot loop, `(1−t)²` refine curve, crossfade | exact, seed 42 (mulberry32) |
| `add_reflection` | exact — flipped, gradient-masked, additively blended |
| `AUTO_CONTRAST` 99th-percentile normalisation | exact |
| `load_and_fit` cover crop | ported, plus a new no-crop **Fit** mode |

### Approximated — and the difference

- **`cv2.bilateralFilter(gray, 7, 50, 50)` → a 1.4 σ Gaussian blur.** A true
  edge-preserving bilateral filter is O(n·r²) per pixel and far too slow in JavaScript
  at full screen resolution. Edges in noisy or heavily textured areas therefore come out
  a little differently from the Python run.
- **`cv2.GaussianBlur(sigmaX=4 / 14)` → the browser's own GPU blur** via
  `ctx.filter = "blur()"`, with a three-pass box blur as a fallback on older Safari.
  Visually equivalent, not bit-identical.
- **Glow and mosaic constants were retuned.** The original `1.4 / 1.1 / 0.7 × 1.6` gains
  saturated every edge to flat white on these images, and a 10 px brightest-pixel block
  lit up completely if a single pixel inside it was lit. This build uses softer gains and
  weights each block by how much of it is actually lit, so the dot field reads as the
  sketch and converges exactly on the neon layer. A deliberate change, not a port error.
- **Two things are additions, not ports:** the **Fit** framing mode and the blurred
  backdrop behind a Fit-framed picture.

### Cannot be moved into a browser

- **`cv2.imwrite` / `shutil.copyfile`** — a web page cannot silently write
  `output_neon_sketch.png` to your disk. The honest equivalent is the **Save sketch**
  button, which triggers a normal download you have to accept.
- **`ctypes.windll.user32.GetSystemMetrics` and the `tkinter` fallback** — there is no
  API to read the physical monitor resolution. The page uses `window.innerWidth` /
  `innerHeight` and `devicePixelRatio`, which is the correct measure for a canvas anyway.
- **`cv2.namedWindow`, `WND_PROP_FULLSCREEN`, `cv2.waitKey`** — replaced by the
  Fullscreen API and DOM key events. iPhone Safari has no Fullscreen API at all, so the
  player falls back to a fixed full-viewport overlay.
- **Reading pixels from `file://`** — Chrome treats local files as opaque origins, so
  `getImageData` on an image loaded from `images/` throws `SecurityError`. This
  disappears completely once the folder is served over http/https, which is what
  GitHub Pages does.

### There was no AI or ML to port

The original script is classical image processing end to end — edge detection, blurs,
colour-space maths and array reshaping. There is no neural network, no model file and no
training step anywhere in it, which is exactly why it maps onto the Canvas 2D API so
cleanly. Nothing has been faked or stubbed out to make the page look functional.

---

## Browser support

Chrome / Edge 90+, Firefox 88+, Safari 15+, Chrome Android, iOS Safari 15+.
`ctx.filter` (Safari below 17) and `IntersectionObserver` both have fallbacks.
`prefers-reduced-motion` turns off the looping hero preview and page transitions.

## Performance

Measured in headless Chromium with a software rasteriser — real hardware is faster.

| viewport | canvas backing store | time to first frame |
|---|---|---|
| phone 390 × 844 @3 (DPR capped to 2) | 780 × 1688 — 1.32 MP | ≈ 1.1 s |
| laptop 1440 × 900 @2 | 2040 × 1275 — 2.60 MP | ≈ 1.2 s |

The next deity in the sequence is prepared in the background during the *hold* and
*crossfade* stages, so only the first one ever shows the loading ring. Up to three
prepared assets are cached; the cache is cleared when framing or glow colour changes.
