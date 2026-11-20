import { TEMPLATE, type SheetName } from '@ceo-room/import';
import { useT } from '../i18n';
import { useArchive } from '../store/archive';
import { useGame } from '../store/game';

/**
 * The oak filing cabinet: one card-index drawer per sheet of the company's data, each with a brass
 * label holder and a pull. Pulling a drawer lays its cards out as a ledger table (DrawerSheet).
 */
export function FilingCabinet() {
  const t = useT();
  const company = useGame((s) => s.company);
  const mine = useGame((s) => s.myCompany);
  const book = useArchive((s) => (s.browse?.status === 'ready' ? s.browse.book : null));
  const openDrawer = useArchive((s) => s.openDrawer);
  const rowsOf = (name: SheetName): number | null => {
    const sheet = book?.sheets.find((x) => x.name === name);
    if (sheet) return sheet.present ? sheet.rows.length : null;
    if (company === 'mine' && mine) return mine.summary.rows[name] ?? null;
    return null;
  };
  const sub = company === 'mine' && mine ? t.t('ui.archive.cabinet.mine', { name: mine.companyName, date: mine.snapshotDate }) : t.t('ui.archive.cabinet.sample');

  return (
    <section
      aria-labelledby="cabinet-title"
      className="absolute left-[36px] top-[90px] z-10 w-[416px] rounded-[4px] px-3 pb-4 pt-3"
      style={{
        background: 'linear-gradient(90deg,#4a2c15,#5c391b 18%,#52321a 50%,#5f3b1c 82%,#43280f)',
        boxShadow: 'inset 0 0 0 2px #2a170a, inset 0 2px 0 rgba(255,210,150,.18), 0 24px 40px rgba(0,0,0,.7)',
      }}
      data-testid="filing-cabinet"
    >
      <div className="mx-auto mb-3 w-fit rounded-[2px] px-4 py-1 text-center brass">
        <h2 id="cabinet-title" className="m-0 font-display text-[18px] font-extrabold uppercase tracking-[.16em]">
          {t.t('ui.archive.cabinet')}
        </h2>
      </div>
      <p className="m-0 mb-2.5 truncate text-center font-type text-label text-[#efe3c4]" data-testid="cabinet-company" title={sub}>
        {sub}
      </p>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        {TEMPLATE.sheets.map((spec) => {
          const rows = rowsOf(spec.name);
          const name = t.t(`ui.archive.drawer.${spec.name}`);
          return (
            <button
              key={spec.name}
              type="button"
              onClick={() => openDrawer(spec.name)}
              aria-label={rows === null && book ? t.t('ui.archive.drawer.openAbsent', { name }) : t.t('ui.archive.drawer.open', { name, rows: rows ?? 0 })}
              className="press group relative flex h-[62px] cursor-pointer flex-col items-center justify-center rounded-[3px] px-2"
              style={{
                background: 'linear-gradient(180deg,#6b4423,#5a381b 55%,#4c2f16)',
                boxShadow: 'inset 0 0 0 1px #2c1709, inset 0 2px 0 rgba(255,214,160,.2), inset 0 -3px 0 rgba(0,0,0,.35), 0 2px 3px rgba(0,0,0,.5)',
              }}
              data-testid="drawer"
              data-sheet={spec.name}
            >
              {/* brass label holder with its cream card */}
              <span className="flex h-[34px] w-full items-center justify-between gap-1.5 rounded-[2px] border-2 border-[#b8913f] px-2 group-hover:border-[#e2c071]" style={{ background: '#efe3c4', boxShadow: '0 0 0 1px #5e4210' }}>
                <span className="truncate font-display text-[15.5px] font-bold leading-none text-ink">{name}</span>
                <span className="shrink-0 font-type text-label font-bold leading-none text-ink-muted" data-testid="drawer-count">
                  {rows === null ? (book ? t.t('ui.figure.none') : '') : t.t('ui.archive.drawer.count', { rows })}
                </span>
              </span>
              {/* the pull */}
              <span aria-hidden="true" className="brass-dot mt-1.5 block h-[7px] w-[64px] rounded-full" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
