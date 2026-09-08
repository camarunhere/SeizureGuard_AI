import { useEffect, useRef } from "react";

/**
 * Quiet, slow-moving canvas backgrounds — one per page, each shaped around
 * what that page is actually for. Kept calm on purpose: low alpha, slow
 * motion, nothing that competes with the clinical content sitting on top.
 *
 * Variants:
 *   eeg-hero  — a calm scrolling multi-channel EEG trace (landing / login)
 *   brain     — a softly pulsing brain-shaped glow (patient dashboard)
 *   livewave  — continuous scrolling EEG channels (live monitoring)
 *   network   — a sparse neural network graph (AI prediction / XAI)
 *   alert     — a slow breathing red pulse (emergency alert page)
 *   timeline  — a single calm trend line (history & analytics)
 *   clinical  — a quiet multi-node grid (clinician — many patients)
 *   insight   — slow-rotating amber light rays from a soft glow (explainable AI — "shedding light")
 *   profile   — calm concentric rings around a center point (profile — personal, settled)
 */
export default function Background({ variant }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W, H, dpr, raf;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const rand = (a, b) => a + Math.random() * (b - a);
    const state = init(variant);

    function init(v) {
      switch (v) {
        case "network":
          return { nodes: Array.from({ length: 20 }, () => ({
            x: rand(0, 1), y: rand(0, 1), vx: rand(-0.05, 0.05), vy: rand(-0.05, 0.05), r: rand(1.2, 2.4),
          })) };
        case "clinical":
          return { nodes: Array.from({ length: 16 }, () => ({
            x: rand(0, 1), y: rand(0, 1), vx: rand(-0.03, 0.03), vy: rand(-0.03, 0.03), r: rand(1.5, 2.8),
          })) };
        case "timeline":
          return { dots: Array.from({ length: 12 }, () => ({
            x: rand(0, 1), y: rand(0, 1), v: rand(0.05, 0.14), r: rand(1, 2),
          })) };
        case "insight":
          return { rays: Array.from({ length: 11 }, (_, i) => ({
            angle: (i / 11) * Math.PI * 2, len: rand(0.32, 0.58),
          })) };
        default:
          return {};
      }
    }

    // Realistic-ish EEG trace: mixed low-frequency sines + occasional sharp spike.
    const eegY = (p, seed) => {
      const t = p * 40 + seed;
      let y = Math.sin(t * 1.3) * 0.5 + Math.sin(t * 2.9 + 1) * 0.3 + Math.sin(t * 5.1 + 2) * 0.15;
      const spikePhase = ((t * 0.15) % 1);
      if (spikePhase > 0.97) y += (1 - (spikePhase - 0.97) / 0.03) * 2.2 * (seed % 2 ? 1 : -1);
      return y;
    };

    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);

      if (variant === "eeg-hero" || variant === "eeg") {
        const channels = variant === "eeg-hero" ? 3 : 1;
        const colors = ["30,58,138", "13,148,136", "225,29,72"];
        for (let c = 0; c < channels; c++) {
          const y0 = H * (channels === 1 ? 0.5 : (c + 1) / (channels + 1));
          ctx.beginPath();
          for (let x = 0; x <= W; x += 3) {
            const y = y0 + eegY(x / W + t * 0.00003, c * 7 + 1) * (H * 0.05);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(${colors[c]},${variant === "eeg-hero" ? 0.16 : 0.2})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      if (variant === "livewave") {
        const colors = ["30,58,138", "13,148,136", "225,29,72", "124,58,247"];
        for (let c = 0; c < 4; c++) {
          const y0 = H * (c + 1) / 5;
          ctx.beginPath();
          for (let x = 0; x <= W; x += 3) {
            const y = y0 + eegY(x / W + t * 0.00006, c * 11 + 3) * (H * 0.04);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(${colors[c]},0.16)`;
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      }

      if (variant === "brain") {
        const cx = W * 0.8, cy = H * 0.25;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.0007);
        const r = 220 + pulse * 30;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(30,58,138,${0.1 + pulse * 0.05})`);
        g.addColorStop(1, "rgba(30,58,138,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

        const cx2 = W * 0.12, cy2 = H * 0.85;
        const pulse2 = 0.5 + 0.5 * Math.sin(t * 0.0005 + 2);
        const r2 = 180 + pulse2 * 24;
        const g2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r2);
        g2.addColorStop(0, `rgba(13,148,136,${0.08 + pulse2 * 0.04})`);
        g2.addColorStop(1, "rgba(13,148,136,0)");
        ctx.fillStyle = g2;
        ctx.fillRect(cx2 - r2, cy2 - r2, r2 * 2, r2 * 2);
      }

      if (variant === "alert") {
        const cx = W * 0.5, cy = H * 0.4;
        for (let i = 0; i < 3; i++) {
          const phase = ((t * 0.0004 + i / 3) % 1);
          const r = phase * Math.max(W, H) * 0.6;
          const alpha = (1 - phase) * 0.14;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(220,38,38,${alpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      if (variant === "timeline") {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = H * 0.7 + Math.sin(x * 0.006 + t * 0.0002) * 18;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(30,58,138,0.14)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "rgba(13,148,136,0.14)";
        for (const d of state.dots) {
          d.y -= d.v / H * 0.6;
          if (d.y < -0.02) { d.y = 1.02; d.x = Math.random(); }
          ctx.beginPath();
          ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (variant === "insight") {
        const cx = W * 0.8, cy = H * 0.2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.00007);
        for (const r of state.rays) {
          const len = Math.max(W, H) * r.len;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(r.angle) * len, Math.sin(r.angle) * len);
          ctx.strokeStyle = "rgba(217,119,6,0.08)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.0006);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 170 + pulse * 20);
        g.addColorStop(0, `rgba(245,158,11,${0.14 + pulse * 0.04})`);
        g.addColorStop(1, "rgba(245,158,11,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - 190, cy - 190, 380, 380);
      }

      if (variant === "profile") {
        const cx = W * 0.5, cy = H * 0.34;
        for (let i = 0; i < 3; i++) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.0005 + i * 1.4);
          const r = 55 + i * 46 + pulse * 8;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(51,65,85,${0.1 - i * 0.022})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      if (variant === "network" || variant === "clinical") {
        const pts = state.nodes;
        const linkDist = variant === "clinical" ? 140 : 120;
        for (const n of pts) {
          n.x += n.vx / W; n.y += n.vy / H;
          if (n.x < 0 || n.x > 1) n.vx *= -1;
          if (n.y < 0 || n.y > 1) n.vy *= -1;
        }
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const dx = (pts[i].x - pts[j].x) * W, dy = (pts[i].y - pts[j].y) * H;
            const d = Math.hypot(dx, dy);
            if (d < linkDist) {
              ctx.beginPath();
              ctx.moveTo(pts[i].x * W, pts[i].y * H);
              ctx.lineTo(pts[j].x * W, pts[j].y * H);
              ctx.strokeStyle = `rgba(30,58,138,${0.12 * (1 - d / linkDist)})`;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }
        ctx.fillStyle = "rgba(30,58,138,0.22)";
        for (const n of pts) {
          ctx.beginPath();
          ctx.arc(n.x * W, n.y * H, n.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    if (reduced) {
      draw(0);
    } else {
      const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [variant]);

  return <canvas ref={ref} aria-hidden="true" className="fixed inset-0 w-full h-full pointer-events-none z-0" />;
}

/** Per-variant page tint — soft gradients so the quiet motion still reads clearly. */
export const BG_TINTS = {
  "eeg-hero": "bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100",
  eeg: "bg-gradient-to-br from-slate-50 via-rose-50 to-slate-100",
  brain: "bg-gradient-to-br from-blue-50 via-slate-50 to-cyan-50",
  livewave: "bg-gradient-to-br from-indigo-50 via-slate-50 to-teal-50",
  network: "bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-50",
  alert: "bg-gradient-to-br from-red-50 via-slate-50 to-orange-50",
  timeline: "bg-gradient-to-b from-teal-50 via-slate-50 to-blue-50",
  clinical: "bg-gradient-to-br from-indigo-50 via-slate-50 to-blue-50",
  insight: "bg-gradient-to-br from-amber-50 via-slate-50 to-orange-50",
  profile: "bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100",
};
