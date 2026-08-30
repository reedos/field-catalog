/**
 * Focus peaking: paint the pixels that sit on a sharp edge.
 *
 * The worker scores sharpness as a Laplacian variance over the whole frame
 * (see sharpness.py), which answers "does this frame have sharp edges
 * somewhere". For a bird photograph the question is whether the *eye* is
 * sharp, and a frame scores just as well on a crisp wing above a soft head.
 * This runs the same Laplacian per pixel and paints what survives, so the
 * answer is visible instead of inferred from a number with no units.
 *
 * Everything here is local arithmetic on a preview that is already loaded --
 * no model, no network, and nothing to configure.
 */

/** Cyan: rare in fur, feathers and foliage, so it never reads as part of the animal. */
const INK: [number, number, number] = [0, 229, 255];

/**
 * What fraction of the frame to light up, by sensitivity step.
 *
 * There is no single right value, because peaking responds to contrast rather
 * than to focus: a tangle of twigs in the focal plane lights up hard while a
 * perfectly sharp patch of smooth plumage barely registers. A busy frame wants
 * the low step to stay selective; a smooth subject wants the high one before
 * anything shows at all.
 */
export const PEAK_STEPS = [0.015, 0.04] as const;

/**
 * Draw `img` into a canvas holding only its sharp edges, transparent elsewhere.
 * Returns null when the image is not yet decodable.
 */
export function peakingCanvas(img: HTMLImageElement, lit: number = PEAK_STEPS[0]): HTMLCanvasElement | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;

  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = sctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas; nothing to show rather than a thrown error
  }

  // Luma once, so the Laplacian below is one pass over a single channel.
  const luma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }

  // Same 4-neighbour Laplacian as the worker, kept per pixel. Borders stay 0.
  const mag = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = Math.abs(
        luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w] - 4 * luma[i],
      );
      mag[i] = v;
      if (v > max) max = v;
    }
  }
  if (max <= 0) return null;

  // Threshold at a percentile rather than a constant: a fixed cut lights up
  // everything on a contrasty frame and nothing on a soft one. Histogram
  // instead of a sort -- this runs over a million or so pixels.
  const BINS = 1024;
  const hist = new Int32Array(BINS);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] > 0) hist[Math.min(BINS - 1, ((mag[i] / max) * BINS) | 0)]++;
  }
  const want = Math.max(1, Math.floor(w * h * lit));
  let seen = 0;
  let bin = BINS - 1;
  for (; bin > 0; bin--) {
    seen += hist[bin];
    if (seen >= want) break;
  }
  const cut = (bin / BINS) * max;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!octx) return null;
  const img2 = octx.createImageData(w, h);
  const px = img2.data;
  for (let i = 0, p = 0; i < mag.length; i++, p += 4) {
    if (mag[i] >= cut) {
      px[p] = INK[0];
      px[p + 1] = INK[1];
      px[p + 2] = INK[2];
      // Brighter the further above the cut, so the true focal plane stands out
      // from edges that merely cleared the bar.
      px[p + 3] = 140 + Math.min(115, ((mag[i] - cut) / (max - cut || 1)) * 115);
    }
  }
  octx.putImageData(img2, 0, 0);
  return out;
}
