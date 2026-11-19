/**
 * The room's light and materials, ported from design/claude-design/Main.dc.html: walnut grain,
 * desk planks, one tungsten lamp pool, vignette and film grain. All procedural SVG/CSS.
 */
import type { CSSProperties } from 'react';

export function WoodGrain({ width = 1440, height = 900 }: { width?: number | string; height?: number | string }) {
  return (
    <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden="true">
      <defs>
        <filter id="wood-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.085" numOctaves={4} seed={7} />
          <feColorMatrix type="matrix" values="0 0 0 0 0.34  0 0 0 0 0.15  0 0 0 0 0.07  1 0.9 0 0 -0.42" />
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="#1f0e08" />
      <rect width="100%" height="100%" filter="url(#wood-grain)" />
    </svg>
  );
}

const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 1440, height: 900, pointerEvents: 'none' };

/** Plank joints across the desk. */
export function DeskPlanks() {
  return (
    <div
      aria-hidden="true"
      style={{
        ...fill,
        background:
          'repeating-linear-gradient(180deg,transparent 0,transparent 178px,rgba(0,0,0,.5) 178px,rgba(0,0,0,.5) 180px,rgba(255,200,140,.05) 180px,rgba(255,200,140,.05) 181px)',
      }}
    />
  );
}

/** The warm pool of the desk lamp (~2700K), with a faint flicker. */
export function LampLight() {
  return (
    <div
      aria-hidden="true"
      className="lamp-flicker"
      style={{
        ...fill,
        background: 'radial-gradient(ellipse 760px 560px at 46% 40%,rgba(255,196,110,.38),rgba(255,150,60,.12) 48%,rgba(0,0,0,0) 72%)',
      }}
    />
  );
}

/** Edges fall off into warm brown-black. Above everything, below dialogs. */
export function Vignette() {
  return (
    <div
      aria-hidden="true"
      style={{
        ...fill,
        zIndex: 30,
        background: 'radial-gradient(ellipse 80% 75% at 46% 42%,rgba(0,0,0,0) 40%,rgba(8,3,1,.45) 78%,rgba(3,1,0,.85) 100%)',
      }}
    />
  );
}

/** Fine film grain over the whole frame. */
export function FilmGrain() {
  return (
    <svg width={1440} height={900} style={{ ...fill, zIndex: 31, mixBlendMode: 'overlay', opacity: 0.16 }} aria-hidden="true">
      <defs>
        <filter id="film-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={11} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#film-grain)" />
    </svg>
  );
}

/** Paper fibre over a sheet; `id` must be unique on the page. */
export function PaperNoise({ id, opacity = 0.35 }: { id: string; opacity?: number }) {
  return (
    <svg
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', mixBlendMode: 'multiply', opacity, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <filter id={id} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={3} seed={3} />
          <feColorMatrix type="matrix" values="0 0 0 0 .45  0 0 0 0 .33  0 0 0 0 .15  0 0 0 .6 0" />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}
