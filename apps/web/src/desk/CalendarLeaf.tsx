import { useEffect, useRef, useState } from 'react';
import { formatInt } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { PaperNoise } from './Atmosphere';

function Leaf({ day, weekday, label, className = '', testId }: { day: string; weekday: string; label: string; className?: string; testId?: string }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden rounded-[3px] text-ink ${className}`}
      style={{ background: '#efe5c9', boxShadow: '0 12px 20px rgba(0,0,0,.55)', transform: 'rotate(1.5deg)' }}
      data-testid={testId}
    >
      <div className="flex h-[30px] items-center justify-center font-type text-[13px] font-bold tracking-[.3em]" style={{ background: '#6a1c1f', color: '#efe0c2' }}>
        {label}
      </div>
      <div className="mt-1.5 text-center font-display text-[84px] font-extrabold leading-[1.05]" data-testid={testId ? `${testId}-day` : undefined}>
        {day}
      </div>
      <div className="text-center font-display text-xl italic">{weekday}</div>
      <PaperNoise id={`paper-leaf-${testId ?? 'old'}`} opacity={0.3} />
    </div>
  );
}

/** Tear-off calendar: today's leaf; yesterday's tears away when the day turns. */
export function CalendarLeaf() {
  const t = useT();
  const report = useGame((s) => s.report);
  const prev = useRef<{ day: number; weekday: string } | null>(null);
  const [torn, setTorn] = useState<{ day: number; weekday: string; key: number } | null>(null);

  const day = report?.day ?? null;
  const weekday = report ? t.t(report.weekdayCode) : '';
  useEffect(() => {
    if (day === null) return;
    const before = prev.current;
    prev.current = { day, weekday };
    if (before && before.day !== day) {
      setTorn({ ...before, key: day });
      const timer = setTimeout(() => setTorn(null), 850);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  if (!report) return null;
  const label = t.t('ui.calendar.day');
  return (
    <div className="absolute left-[1229px] top-[90px] z-10 h-[176px] w-[150px]" role="img" aria-label={t.t('ui.calendar.aria', { day: report.day, weekday })}>
      <Leaf day={formatInt(report.day, t.locale)} weekday={weekday} label={label} testId="calendar" />
      {torn && <Leaf key={torn.key} day={formatInt(torn.day, t.locale)} weekday={torn.weekday} label={label} className="leaf-tear" />}
      <div className="brass-dot absolute left-[33px] top-[-10px] h-4 w-4 rounded-full" aria-hidden="true" />
      <div className="brass-dot absolute left-[101px] top-[-10px] h-4 w-4 rounded-full" aria-hidden="true" />
    </div>
  );
}
