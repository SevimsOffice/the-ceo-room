import { useEffect, useRef, useState } from 'react';
import { formatInt, formatMonthYear, isoDateParts } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { PaperNoise } from './Atmosphere';

interface LeafFace {
  /** the large figure: the day number (sample) or the day of the month (My company) */
  big: string;
  weekday: string;
  /** the strip on top: "GÜN" (sample) or the month and year (My company) */
  label: string;
  forecast: boolean;
  key: number;
}

function Leaf({ face, className = '', testId }: { face: LeafFace; className?: string; testId?: string }) {
  const t = useT();
  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-[3px] text-ink ${className}`}
      style={{ background: '#efe5c9', boxShadow: '0 12px 20px rgba(0,0,0,.55)', transform: 'rotate(1.5deg)' }}
      data-testid={testId}
    >
      <div className="flex h-[30px] items-center justify-center whitespace-nowrap font-type text-label font-bold uppercase tracking-[.2em]" style={{ background: '#6a1c1f', color: '#efe0c2' }} data-testid={testId ? `${testId}-label` : undefined}>
        {face.label}
      </div>
      <div
        className={`text-center font-type font-bold ${face.forecast ? 'mt-0.5 text-[68px] leading-[1]' : 'mt-1.5 text-[84px] leading-[1.05]'}`}
        data-testid={testId ? `${testId}-day` : undefined}
      >
        {face.big}
      </div>
      <div className={`text-center font-display italic ${face.forecast ? 'text-lg leading-tight' : 'text-xl'}`}>{face.weekday}</div>
      {face.forecast && (
        <div className="mt-0.5 flex justify-center">
          <span
            className="border-2 border-oxblood-ink px-1.5 font-type text-label font-bold leading-tight tracking-[.08em] text-oxblood-ink"
            style={{ transform: 'rotate(-3deg)' }}
            data-testid={testId ? `${testId}-forecast` : undefined}
          >
            {t.t('ui.calendar.forecast')}
          </span>
        </div>
      )}
      <PaperNoise id={`paper-leaf-${testId ?? 'old'}`} opacity={0.3} />
    </div>
  );
}

/**
 * Tear-off calendar: today's leaf; yesterday's tears away when the day turns. The sample counts
 * days ("GÜN 12"); My company shows the real date (Day 1 = the snapshot date) and marks every
 * later day as a forecast.
 */
export function CalendarLeaf() {
  const t = useT();
  const report = useGame((s) => s.report);
  const prev = useRef<LeafFace | null>(null);
  const [torn, setTorn] = useState<LeafFace | null>(null);

  const face: LeafFace | null = report
    ? (() => {
        const weekday = t.t(report.weekdayCode);
        const parts = report.date ? isoDateParts(report.date) : null;
        if (report.date && parts) {
          return { big: formatInt(parts.day, t.locale), weekday, label: formatMonthYear(report.date, t.locale), forecast: report.forecast, key: report.day };
        }
        return { big: formatInt(report.day, t.locale), weekday, label: t.t('ui.calendar.day'), forecast: false, key: report.day };
      })()
    : null;

  const day = report?.day ?? null;
  useEffect(() => {
    if (day === null || !face) return;
    const before = prev.current;
    prev.current = face;
    if (before && before.key !== day) {
      setTorn({ ...before, key: day });
      const timer = setTimeout(() => setTorn(null), 850);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  if (!report || !face) return null;
  const aria = report.date ? t.t('ui.calendar.aria.date', { date: report.date, weekday: face.weekday }) : t.t('ui.calendar.aria', { day: report.day, weekday: face.weekday });
  return (
    <div
      className="absolute left-[1229px] top-[90px] z-10 h-[176px] w-[150px]"
      role="img"
      aria-label={face.forecast ? `${aria} · ${t.t('ui.calendar.forecast')}` : aria}
      data-forecast={face.forecast}
    >
      <Leaf face={face} testId="calendar" />
      {torn && <Leaf key={torn.key} face={torn} className="leaf-tear" />}
      <div className="brass-dot absolute left-[33px] top-[-10px] h-4 w-4 rounded-full" aria-hidden="true" />
      <div className="brass-dot absolute left-[101px] top-[-10px] h-4 w-4 rounded-full" aria-hidden="true" />
    </div>
  );
}
