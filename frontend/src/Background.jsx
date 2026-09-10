/**
 * Site-wide animated background: a real looping video of neurons wiring
 * into a brain (frontend/public/neuron-brain.mp4), used identically on
 * every page.
 *
 * The source clip is a portrait phone recording (478x850) — filling a wide
 * landscape screen with object-cover means scaling it up ~3x and center-
 * cropping the top/bottom, which is unavoidable without the original
 * higher-resolution/landscape source (there's no ffmpeg or similar on this
 * machine to re-encode or reframe it). A slight extra scale hides the
 * video's own edge/encoding artifacts once cropped, a mild contrast/
 * saturation lift compensates for softness from the upscale, and a vignette
 * (rather than one flat scrim) keeps the center — where the brain/neurons
 * actually sit — clearest while still darkening the edges for text contrast.
 */
export default function Background() {
  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden pointer-events-none z-0" aria-hidden="true">
      <video
        className="absolute inset-0 w-full h-full object-cover scale-110"
        style={{ filter: "contrast(1.15) saturate(1.25) brightness(1.06)" }}
        src="/neuron-brain.mp4"
        autoPlay
        loop
        muted
        playsInline
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, rgba(2,6,23,0.25) 0%, rgba(2,6,23,0.45) 55%, rgba(2,6,23,0.82) 100%)" }}
      />
    </div>
  );
}

/** Dark base so the video's own black frame edges blend seamlessly. */
export const BG_TINT = "bg-slate-950";
