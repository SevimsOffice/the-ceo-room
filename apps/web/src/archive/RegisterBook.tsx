import { useT } from '../i18n';
import { useArchive } from '../store/archive';
import { useGame } from '../store/game';

/** "2027-02-01T14:05:09.123Z" → its date and local time (the browser clock, shown in the register only). */
function importedAt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso.slice(0, 10), time: '' };
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

/**
 * The register of data sources, a bound ledger: the built-in sample and, once imported, My company
 * (file, when, snapshot date, rows and the inspection's counts), with the control that deletes it.
 */
export function RegisterBook() {
  const t = useT();
  const company = useGame((s) => s.company);
  const mine = useGame((s) => s.myCompany);
  const askRemove = useArchive((s) => s.askRemove);
  const pending = useArchive((s) => s.pending);
  const onDesk = (
    <span className="ml-2 inline-block border border-[#1f5a34] px-1 font-type text-label font-bold uppercase leading-tight text-[#1f5a34]" data-testid="register-active">
      {t.t('ui.archive.register.active')}
    </span>
  );
  const at = mine ? importedAt(mine.importedAt) : null;
  const rows = mine ? Object.values(mine.summary.rows).reduce((a, b) => a + b, 0) : 0;
  return (
    <section
      aria-labelledby="register-title"
      className="absolute left-[476px] top-[598px] z-10 w-[460px] rounded-[4px] p-[7px]"
      style={{ background: 'linear-gradient(135deg,#2f4a3a,#1d3326)', boxShadow: 'inset 0 0 0 1px #0f1f15, 0 18px 30px rgba(0,0,0,.65)' }}
      data-testid="register"
    >
      <div
        className="on-paper relative px-4 pb-2 pt-2 text-ink"
        style={{ background: 'repeating-linear-gradient(180deg,transparent 0,transparent 25px,rgba(60,90,120,.16) 25px,rgba(60,90,120,.16) 26px),linear-gradient(180deg,#ece1c5,#e3d5b3)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="register-title" className="m-0 font-display text-[20px] font-extrabold">
            {t.t('ui.archive.register.heading')}
          </h2>
          {mine && (
            <button
              type="button"
              onClick={askRemove}
              disabled={pending !== null}
              className="press min-h-touch shrink-0 cursor-pointer rounded-sm border-2 border-[#6a1c1f] bg-transparent px-3 font-type text-label font-bold text-[#6a1c1f] hover:bg-[rgba(106,28,31,.08)] disabled:opacity-50"
              data-testid="remove-mine"
            >
              {t.t('ui.archive.register.remove')}
            </button>
          )}
        </div>
        <ol className="m-0 list-none pl-0">
          <li className="border-b border-dotted border-[rgba(60,40,20,.5)] py-1" data-testid="register-sample">
            <div className="font-type text-label font-bold">
              {t.t('ui.archive.register.sample')}
              {company === 'sample' && onDesk}
            </div>
            <div className="font-type text-label text-ink-muted">{t.t('ui.archive.register.sample.kind')}</div>
          </li>
          <li className="py-1" data-testid="register-mine">
            {mine && at ? (
              <>
                <div className="truncate font-type text-label font-bold" title={mine.companyName}>
                  {mine.companyName}
                  {company === 'mine' && onDesk}
                </div>
                <div className="truncate font-type text-label text-ink-muted" title={mine.fileName}>
                  {t.t('ui.archive.register.mine.kind', { file: mine.fileName })}
                </div>
                <div className="font-type text-label text-ink-muted">{t.t('ui.archive.register.mine.imported', { date: at.date, time: at.time })}</div>
                <div className="font-type text-label text-ink-muted">{t.t('ui.archive.register.mine.rows', { snapshot: mine.snapshotDate, rows })}</div>
                <div className="font-type text-label text-ink-muted" data-testid="register-status">
                  {t.t('ui.archive.register.mine.status', { errors: mine.summary.errors, warnings: mine.summary.warnings, info: mine.summary.info })}
                </div>
              </>
            ) : (
              <div className="font-type text-label text-ink-muted">{t.t('ui.archive.register.mine.none')}</div>
            )}
          </li>
        </ol>
      </div>
    </section>
  );
}

/** The typed notice: imported data stays in this browser and is never sent anywhere. */
export function PrivacyCard() {
  const t = useT();
  return (
    <aside
      aria-labelledby="privacy-title"
      className="on-paper absolute left-[966px] top-[710px] z-10 w-[436px] px-4 pb-2 pt-2"
      style={{ background: '#efe5c9', color: '#241a10', transform: 'rotate(-.5deg)', boxShadow: '0 12px 20px rgba(0,0,0,.6)', borderLeft: '6px solid #2f4a3a' }}
      data-testid="privacy-notice"
    >
      <h2 id="privacy-title" className="m-0 font-type text-label font-bold uppercase tracking-[.08em] text-[#1f3a28]">
        {t.t('ui.archive.privacy.heading')}
      </h2>
      <p className="m-0 mt-0.5 font-type text-label leading-[1.28]">{t.t('ui.archive.privacy.body')}</p>
    </aside>
  );
}
