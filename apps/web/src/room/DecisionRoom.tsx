import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { AdvisorBrief } from '@ceo-room/engine';
import { useT } from '../i18n';
import { canDecide, currentRoomView, useGame } from '../store/game';
import type { RoomView } from '../worker/protocol';
import { PaperNoise } from '../desk/Atmosphere';
import { TONE_COLOR } from '../desk/TypedReport';
import { daysLeftText, figureText, runwayText, telegramNumber } from '../desk/figures';
import { ActionBar, type Stamp } from './ActionBar';
import { ImpactTable } from './ImpactTable';
import { MemoSheet } from './MemoSheet';
import { METRICS, baselineCell, baselineUnit, horizonHeading, metricLabel } from './impact';
import { optionLetters, optionName, withOptionNames } from './names';

const SEVERITY_COLOR = { high: '#8a1818', medium: '#7a4a00', low: '#2f4a3a' } as const;
const NOTE_TILT = [-0.5, 0.4, -0.3, 0.5];

function OpenedTelegram({ v }: { v: RoomView }) {
  const t = useT();
  const tg = v.telegram;
  if (!tg) return null;
  return (
    <article className="on-paper relative" style={{ transform: 'rotate(-1.2deg)', background: '#e4d3a4', color: '#241a10', boxShadow: '0 12px 20px rgba(0,0,0,.55)' }} data-testid="room-telegram">
      <div className="flex justify-between bg-[#2b1d14] px-3.5 py-[3px] font-type text-label tracking-[.12em] text-[#e9dcc0]">
        <span>{t.t('ui.telegram.form')}</span>
        <span>{t.t('ui.telegram.number', { n: telegramNumber(tg.id) })}</span>
      </div>
      <div className="px-3.5 pb-2 pt-2">
        <p className="m-0 font-type text-label font-bold leading-[1.25]">{t.msg(tg.message)}</p>
        <div className="mt-1.5 flex items-center justify-between">
          <span
            className="inline-block border-2 px-2 py-0.5 font-type text-label font-bold tracking-[.1em]"
            style={{ borderColor: SEVERITY_COLOR[tg.severity], color: SEVERITY_COLOR[tg.severity], transform: 'rotate(-3deg)' }}
          >
            {t.t(`ui.telegram.severity.${tg.severity}`)}
          </span>
          <span className="font-type text-label text-ink-muted">{t.t('ui.room.telegramDay', { day: tg.day })}</span>
        </div>
      </div>
    </article>
  );
}

/** A ledger line of the situation memo: label and figure on one line when they fit, else the figure below, right-aligned. */
function FigureRow({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className="report-row flex flex-wrap items-baseline justify-between gap-x-2 py-[3px]">
      <dt className="font-type text-label uppercase leading-tight text-ink-muted">{label}</dt>
      <dd className="m-0 ml-auto font-type text-[17px] font-bold leading-tight text-ink" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function SituationMemo({ v }: { v: RoomView }) {
  const t = useT();
  const urgent = v.status === 'open' && v.daysLeft <= 1;
  return (
    <section aria-labelledby="situation-title" className="paper on-paper relative mt-3 px-4 pb-2.5 pt-3" style={{ transform: 'rotate(.5deg)', boxShadow: '0 14px 26px rgba(0,0,0,.6)' }} data-testid="situation">
      <PaperNoise id="paper-situation" />
      <div className="relative">
        <h2 id="situation-title" className="m-0 font-display text-[20px] font-extrabold leading-tight">
          {t.t('ui.room.situation')}
        </h2>
        <div className="mt-1.5 h-[5px] border-b border-t-2 border-ink" />
        <p className="m-0 mt-1.5 font-type text-label leading-[1.25] text-[#3a2c1c]" data-testid="situation-text">
          {t.msg(v.situation)}
        </p>
        {v.status === 'open' && (
          <p className="m-0 mt-1.5 font-type text-label font-bold leading-[1.25]" style={{ color: urgent ? '#8a1818' : '#4a3a28' }} data-testid="room-deadline">
            {t.t('ui.room.deadlineLine', { left: daysLeftText(t, v.daysLeft), deadline: t.t('ui.room.deadline', { day: v.deadlineDay }) })}
          </p>
        )}
        <dl className="m-0 mt-1">
          {v.figures.flatMap((f) => {
            const row = (
              <FigureRow key={f.code} label={t.t(f.code)} testId={`room-figure-${f.code}`}>
                {figureText(t, f.code, f.value)}
              </FigureRow>
            );
            if (f.code !== 'figure.cash') return [row];
            return [
              row,
              <FigureRow key="runway" label={t.t('figure.runwayDays')} testId="room-runway">
                {runwayText(t, v.runway)}
              </FigureRow>,
            ];
          })}
        </dl>
      </div>
    </section>
  );
}

/** What happens if the CEO rejects (the default option): the figures every option is measured against. */
function BaselineCard({ v }: { v: RoomView }) {
  const t = useT();
  const impacts = v.analysis?.extended ?? v.impacts;
  if (!impacts) return null;
  const def = v.options.find((o) => o.id === v.defaultOptionId);
  const cols = `84px repeat(${METRICS.length}, minmax(0, 1fr))`;
  return (
    <section
      aria-labelledby="baseline-title"
      className="relative rounded-[3px] px-4 pb-2 pt-2 text-[#f1e8cf]"
      style={{ background: 'linear-gradient(180deg,#2f4a3a,#263d30)', boxShadow: '0 12px 22px rgba(0,0,0,.55)', border: '1px solid #1b2b21' }}
      data-testid="baseline"
    >
      <h3 id="baseline-title" className="m-0 font-display text-[17px] font-bold">
        {t.t('ui.room.baseline.title', { label: def ? t.t(def.labelKey) : v.defaultOptionId })}
      </h3>
      <table className="mt-1 w-full border-collapse font-type text-label">
        <thead>
          <tr className="grid gap-x-2 border-b border-[#9db39f] pb-1" style={{ gridTemplateColumns: cols }}>
            <th className="p-0 text-left font-normal">
              <span className="sr-only">{t.t('ui.room.table.horizon')}</span>
            </th>
            {METRICS.map((m) => (
              <th key={m} scope="col" className="p-0 text-right font-normal leading-tight">
                <span className="block font-bold" aria-hidden="true">{t.t(`ui.room.short.${m}`)}</span>
                <span className="block text-[#d5dfc9]" aria-hidden="true">{baselineUnit(t, m)}</span>
                <span className="sr-only">{t.t('ui.room.withNote', { text: metricLabel(t, m).label, note: baselineUnit(t, m) })}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {impacts.baseline.map((b) => {
            const head = horizonHeading(t, b.horizonDays, v.day);
            return (
              <tr key={b.horizonDays} className="grid items-baseline gap-x-2 border-b border-dotted border-[rgba(220,230,210,.35)] py-[2px]" style={{ gridTemplateColumns: cols }} data-testid="baseline-row">
                <th scope="row" className="p-0 text-left font-bold">
                  <span aria-hidden="true">{head.title}</span>
                  <span className="sr-only">{t.t('ui.room.withNote', { text: head.title, note: head.day })}</span>
                </th>
                {METRICS.map((m) => {
                  const c = baselineCell(t, m, b.kpis);
                  return (
                    <td key={m} className="p-0 text-right text-[17px] font-bold" style={{ color: c.tone === 'bad' ? '#ffb4a2' : c.tone === 'warn' ? '#f3d68c' : '#f6efd9' }} data-testid={`baseline-${m}-${b.horizonDays}`}>
                      {c.text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function OptionNote({ v, optionId, index, stamp }: { v: RoomView; optionId: string; index: number; stamp: Stamp }) {
  const t = useT();
  const selected = useGame((s) => s.room?.selected === optionId);
  const select = useGame((s) => s.selectOption);
  const decidable = useGame(canDecide);
  const o = v.options.find((x) => x.id === optionId)!;
  const impacts = v.analysis?.extended ?? v.impacts;
  const impact = impacts?.options.find((x) => x.optionId === optionId);
  const letter = optionLetters(v).get(optionId) ?? '';
  const first = o.assumptions[0];
  return (
    <article
      className={`on-paper relative box-border flex w-[270px] flex-col px-3 pb-3 pt-4 transition-transform duration-150 ${selected ? 'note-selected' : ''}`}
      style={{
        background: 'linear-gradient(180deg,#eadfc3,#e0d1ae)',
        color: '#2a1e12',
        transform: selected ? 'translateY(-8px)' : `rotate(${NOTE_TILT[index % NOTE_TILT.length]}deg)`,
        boxShadow: selected ? '0 0 0 3px #c9a24a,0 24px 36px rgba(0,0,0,.65)' : '0 14px 24px rgba(0,0,0,.55)',
      }}
      aria-labelledby={`option-${optionId}-title`}
      data-testid="option-note"
      data-option={optionId}
      data-selected={selected}
    >
      <span className="absolute left-[128px] top-[-8px] h-4 w-4 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%,#f6e2a0,#8c6b25)', boxShadow: '0 3px 4px rgba(0,0,0,.6)' }} aria-hidden="true" />
      {selected && (
        <span className="absolute right-3 top-[-14px] bg-oxblood px-3 py-1 font-type text-label font-bold tracking-[.1em] text-cream-2" style={{ transform: 'rotate(2deg)', boxShadow: '0 3px 6px rgba(0,0,0,.5)' }}>
          {t.t('ui.room.selected')}
        </span>
      )}
      <div className="flex items-center gap-2.5">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border-2 border-oxblood font-display text-xl font-extrabold text-oxblood" aria-hidden="true">
          {letter}
        </span>
        <h3 id={`option-${optionId}-title`} className="m-0 font-display text-[19px] font-bold leading-[1.15]">
          <span className="sr-only">{t.t('ui.room.optionLetter', { letter })} </span>
          {t.t(o.labelKey)}
        </h3>
      </div>
      {first && <p className="m-0 mt-1.5 font-hand text-[18px] font-semibold italic leading-[1.15] text-[#3a2c1c]">{t.msg(first)}</p>}
      <div className="mt-2">
        {impact?.error ? (
          <p className="m-0 font-type text-label text-oxblood-ink">{t.msg(impact.error)}</p>
        ) : (
          impact && <ImpactTable horizons={impact.horizons} today={v.day} testId={`impact-${optionId}`} />
        )}
      </div>
      <button
        type="button"
        onClick={() => select(optionId)}
        disabled={!decidable || stamp !== null}
        aria-pressed={selected}
        className={`press mt-auto box-border h-touch w-full cursor-pointer rounded-[3px] border-2 border-oxblood font-display text-[16px] font-bold ${
          selected ? 'bg-oxblood text-cream-2' : 'bg-transparent text-oxblood hover:bg-[rgba(106,28,31,.08)]'
        } disabled:cursor-not-allowed`}
        style={{ marginTop: 10 }}
        data-testid="choose-option"
      >
        {selected ? t.t('ui.room.selected') : t.t('ui.room.choose')}
      </button>
      {stamp === 'approved' && selected && (
        <span className="stamp-in pointer-events-none absolute left-6 top-[42%] z-10 border-[5px] border-double border-bottle-ink bg-[rgba(236,224,196,.6)] px-3.5 py-2 font-display text-[26px] font-extrabold tracking-[.06em] text-bottle-ink" style={{ transform: 'rotate(-12deg)' }} data-testid="approved-stamp">
          {t.t('ui.room.stamp.approved')}
        </span>
      )}
    </article>
  );
}

/**
 * An advisor's signed letter. Folded, it shows who writes, the pick and the first caution; "read
 * more" unfolds the reasoning and any further cautions (the column then scrolls).
 */
function AdvisorLetter({ v, brief, index, expanded, onToggle }: { v: RoomView; brief: AdvisorBrief; index: number; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  const role = t.t(`ui.room.advisor.short.${brief.role}`);
  const bodyId = `advisor-${brief.role}-more`;
  return (
    <article
      className="paper on-paper relative box-border w-full px-3.5 pb-1.5 pt-3"
      style={{ transform: `rotate(${index % 2 === 0 ? 0.8 : -0.8}deg)`, boxShadow: '0 14px 24px rgba(0,0,0,.55)', marginTop: index === 0 ? 0 : 12 }}
      aria-labelledby={`advisor-${brief.role}`}
      data-testid={`advisor-${brief.role}`}
      data-recommends={brief.recommendedOptionId}
      data-expanded={expanded}
    >
      <PaperNoise id={`paper-advisor-${brief.role}`} opacity={0.3} />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-[44px] w-[44px] flex-none items-center justify-center font-display text-[15.5px] font-bold text-[#f3e6c8]"
            style={{ borderRadius: '50% 46% 50% 48%', background: 'radial-gradient(circle at 35% 30%,#b0302f,#5a0f12)', boxShadow: '0 3px 6px rgba(0,0,0,.5),inset 0 0 0 3px rgba(255,255,255,.12)' }}
            aria-hidden="true"
          >
            {role}
          </span>
          <h3 id={`advisor-${brief.role}`} className="m-0 font-display text-[16px] font-bold leading-tight">
            {t.t('ui.room.advisor.title', { title: t.t(brief.titleKey), role })}
          </h3>
        </div>
        <p className="m-0 mt-1.5 font-type text-label font-bold leading-[1.25] text-oxblood" data-testid="advisor-recommends">
          {t.t('ui.room.advisor.recommends', { option: optionName(t, v, brief.recommendedOptionId) })}
        </p>
        <p id={bodyId} hidden={!expanded} className="m-0 mt-1.5 font-hand text-[18px] font-semibold italic leading-[1.12] text-[#2a1c10]" data-testid="advisor-rationale">
          {withOptionNames(t, v, brief.rationale)}
        </p>
        {brief.caveats.length > 0 && (
          <ul className="m-0 mt-1.5 list-none border-t border-dotted border-[rgba(60,40,20,.55)] p-0 pt-1" data-testid="advisor-caveats">
            {brief.caveats.map((c, i) => (
              <li key={i} hidden={i > 0 && !expanded} className="mt-0.5 font-hand text-[18px] font-bold italic leading-[1.12] text-[#6a1414]">
                {t.t('ui.room.advisor.caveat', { text: withOptionNames(t, v, c) })}
              </li>
            ))}
          </ul>
        )}
        <div className="-mb-1 flex flex-wrap items-center justify-between gap-x-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
            className="press -ml-2 flex h-touch min-w-touch cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm border-0 bg-transparent px-2 font-type text-label font-bold text-oxblood underline decoration-dotted underline-offset-4 hover:bg-[rgba(106,28,31,.08)]"
            data-testid="advisor-toggle"
          >
            <span aria-hidden="true" className="inline-block transition-transform duration-150" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
              ▸
            </span>
            {t.t(expanded ? 'ui.room.advisor.less' : 'ui.room.advisor.more')}
          </button>
          <p className="m-0 -mt-2 mb-1.5 ml-auto whitespace-nowrap text-right font-hand text-[19px] font-semibold italic leading-tight text-ink" data-testid="advisor-signature">
            {t.t('ui.room.advisor.signature', { name: brief.advisorName, role })}
          </p>
        </div>
      </div>
    </article>
  );
}

/** The room while its figures are being calculated or a closed decision. */
function RoomNote({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-[296px] top-[300px] z-10 w-[834px] text-center font-hand text-3xl font-semibold italic text-cream-2" data-testid="room-note">
      {children}
    </div>
  );
}

/** A focused control by what it is (test id, option), not by node: nodes are rebuilt. */
type FocusKey = { testId: string; option: string | null };

function focusKey(el: HTMLElement): FocusKey | null {
  const testId = el.getAttribute('data-testid');
  return testId ? { testId, option: el.closest('[data-option]')?.getAttribute('data-option') ?? null } : null;
}

/** The control a key names now; the analysis button is replaced by its tab once requested. */
function findFocus(k: FocusKey | null): HTMLElement | null {
  if (!k) return null;
  const scope = k.option ? document.querySelector(`[data-option="${k.option}"]`) : document;
  const q = (id: string) => scope?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
  return q(k.testId) ?? (k.testId === 'request-analysis' ? q('analysis-tab') : null);
}

/**
 * The Decision Room: the opened telegram and situation memo on the left, the options as pinned
 * notes with their +7 / +30 (+90 once analysed) changes against the baseline in the middle, the
 * CFO's and COO's signed notes on the right, and the action bar (seal, stamp, analysis, memo).
 */
export function DecisionRoom() {
  const t = useT();
  const room = useGame((s) => s.room);
  const v = useGame(currentRoomView);
  const busy = useGame((s) => s.busy !== null || s.advancePending);
  // the view for today's state arrived and says there is no such decision
  const missing = useGame((s) => s.room?.view?.version === s.version && s.room.view.data === null);
  const closeRoom = useGame((s) => s.closeRoom);
  const [stamp, setStamp] = useState<Stamp>(null);
  // which advisors' letters are unfolded (kept while the figures are recalculated after a day)
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const optionsHeading = useRef<HTMLHeadingElement>(null);
  const shown = v !== null && v.status === 'open';
  // the control last focused in the room, to find it again after the figures were recalculated
  const lastFocus = useRef<FocusKey | null>(null);
  useEffect(() => {
    const on = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) lastFocus.current = focusKey(e.target);
    };
    document.addEventListener('focusin', on);
    return () => document.removeEventListener('focusin', on);
  }, []);
  // on opening, focus moves to the options (once the figures are in); the opener is gone with the
  // Desk. While the figures are recalculated (after a day or an instruction) the room's controls
  // are briefly gone: focus comes back to the same control (or what replaced it) when they return.
  const opened = useRef(false);
  useEffect(() => {
    if (!shown) return;
    const first = !opened.current;
    opened.current = true;
    const active = document.activeElement;
    if (!first && active !== null && active !== document.body) return;
    if (!first) findFocus(lastFocus.current)?.focus();
    if (first || document.activeElement === null || document.activeElement === document.body) optionsHeading.current?.focus();
  }, [shown]);
  if (!room) return null;

  if (!v) {
    return (
      <RoomNote>
        <p className="m-0" aria-live="polite">
          {missing ? t.t('ui.room.missing') : busy ? t.t('ui.room.waitingClock') : t.t('ui.room.calculating')}
        </p>
      </RoomNote>
    );
  }

  if (v.status !== 'open') {
    return (
      <RoomNote>
        <p className="m-0" data-testid="room-closed">
          {t.t('ui.room.closed', { status: t.t(`ui.decision.status.${v.status}`) })}
        </p>
        <button
          type="button"
          onClick={closeRoom}
          className="press mt-6 min-h-touch cursor-pointer rounded-md border border-brass-edge bg-[#2a1710] px-6 font-display text-lg font-bold not-italic text-brass-text hover:bg-[#3a2016]"
        >
          {t.t('ui.room.backToDesk')}
        </button>
      </RoomNote>
    );
  }

  const onTable = v.options.filter((o) => o.id !== v.defaultOptionId);
  return (
    <>
      <div className="absolute left-[30px] top-[88px] z-10 telegram-scroll h-[712px] w-[252px] overflow-y-auto overflow-x-hidden px-1 pb-4 pt-1" data-testid="room-left" tabIndex={0} role="region" aria-label={t.t('ui.room.situation')}>
        <OpenedTelegram v={v} />
        <SituationMemo v={v} />
      </div>

      <section aria-labelledby="options-heading" className="absolute left-[296px] top-[84px] z-10 w-[834px]" data-testid="room-options">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="options-heading" ref={optionsHeading} tabIndex={-1} className="m-0 font-display text-[26px] font-medium italic leading-tight text-cream-2">
            {t.plural('ui.room.options.heading', onTable.length)}
          </h2>
        </div>
        <div className="mt-2">
          <BaselineCard v={v} />
        </div>
        <div className={`relative mt-5 flex gap-3 ${onTable.length < 3 ? 'justify-center' : ''}`}>
          {onTable.map((o, i) => (
            <OptionNote key={o.id} v={v} optionId={o.id} index={i} stamp={stamp} />
          ))}
          {stamp === 'rejected' && (
            <span
              className="stamp-in pointer-events-none absolute left-[150px] top-[180px] z-20 border-[6px] border-double border-oxblood-ink bg-[rgba(236,224,196,.6)] px-7 py-2.5 font-display text-[50px] font-extrabold tracking-[.08em] text-oxblood-ink"
              style={{ transform: 'rotate(-10deg)' }}
              data-testid="rejected-stamp"
            >
              {t.t('ui.room.stamp.rejected')}
            </span>
          )}
        </div>
      </section>

      <section aria-labelledby="counsel-heading" className="absolute left-[1140px] top-[84px] z-10 telegram-scroll h-[720px] w-[286px] overflow-y-auto overflow-x-hidden px-2 pb-3 pt-1" data-testid="room-counsel" tabIndex={0}>
        <h2 id="counsel-heading" className="brass m-0 inline-block rounded-[3px] px-4 py-1.5 font-display text-label font-bold tracking-[.08em]">
          {t.t('ui.room.counsel')}
        </h2>
        <div className="mt-3">
          {v.advisors.map((b, i) => (
            <AdvisorLetter key={b.role} v={v} brief={b} index={i} expanded={unfolded[b.role] === true} onToggle={() => setUnfolded((u) => ({ ...u, [b.role]: !u[b.role] }))} />
          ))}
        </div>
      </section>

      <ActionBar v={v} stamp={stamp} setStamp={setStamp} />
      {room.memoOpen && v.memo && <MemoSheet v={v} />}
    </>
  );
}
