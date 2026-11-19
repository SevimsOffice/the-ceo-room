/**
 * A brass dial gauge (port of the design's SVG): 240° sweep, 11 ticks, oxblood ticks over the
 * warning zone, needle at `fraction` (0–1) or resting at zero while `fraction` is null.
 */
const CX = 62;
const CY = 62;
const START = -120;
const SWEEP = 240;
const TICKS = 11;

function tick(i: number): { x1: number; y1: number; x2: number; y2: number; major: boolean } {
  const major = i === 0 || i === 5 || i === TICKS - 1;
  const a = ((START + (SWEEP * i) / (TICKS - 1)) * Math.PI) / 180;
  const r1 = 41;
  const r2 = major ? 30 : 35;
  return { x1: CX + r1 * Math.sin(a), y1: CY - r1 * Math.cos(a), x2: CX + r2 * Math.sin(a), y2: CY - r2 * Math.cos(a), major };
}

export interface BrassGaugeProps {
  id: string;
  label: string;
  /** the figure printed under the dial */
  value: string;
  /** 0–1, clamped; null = needle at rest (calculating) */
  fraction: number | null;
  /** tick indexes 0–10 drawn in oxblood */
  warn: (i: number) => boolean;
  ariaLabel: string;
  testId?: string;
}

export function BrassGauge({ id, label, value, fraction, warn, ariaLabel, testId }: BrassGaugeProps) {
  const f = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));
  const angle = START + SWEEP * f;
  return (
    <figure className="m-0 flex w-[124px] flex-col items-center" role="img" aria-label={ariaLabel} data-testid={testId}>
      <svg width="124" height="124" viewBox="0 0 124 124" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f1d98c" />
            <stop offset=".5" stopColor="#b8903a" />
            <stop offset="1" stopColor="#6e5018" />
          </linearGradient>
        </defs>
        <circle cx={CX} cy={CY} r="59" fill={`url(#${id}-brass)`} stroke="#3d2a0a" strokeWidth="1.5" />
        <circle cx={CX} cy={CY} r="49" fill="#efe3c4" stroke="#6b4f17" strokeWidth="1.5" />
        {Array.from({ length: TICKS }, (_, i) => {
          const t = tick(i);
          return (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={warn(i) ? '#8a1818' : '#2a1e12'} strokeWidth={t.major ? 2.4 : 1.6} />
          );
        })}
        <g className="needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px`, opacity: fraction === null ? 0.35 : 1 }}>
          <line x1={CX} y1={CY + 8} x2={CX} y2={CY - 38} stroke="#1d130b" strokeWidth="2.6" strokeLinecap="round" />
        </g>
        <circle cx={CX} cy={CY} r="6" fill={`url(#${id}-brass)`} stroke="#3d2a0a" />
      </svg>
      <figcaption className="mt-1.5 text-center">
        <div className="min-h-[58px] font-type text-label uppercase leading-tight tracking-[.02em] text-[#d9c9a4]">{label}</div>
        <div className="font-type text-[19px] font-bold text-brass-bright" data-testid={testId ? `${testId}-value` : undefined}>
          {value}
        </div>
      </figcaption>
    </figure>
  );
}
