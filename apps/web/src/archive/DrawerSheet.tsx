import { useMemo, useState } from 'react';
import { type SheetName, sheetSpec } from '@ceo-room/import';
import { useT } from '../i18n';
import { useArchive } from '../store/archive';
import { useGame } from '../store/game';
import { Sheet } from '../desk/Sheet';
import { cellText, isFigure } from './cells';

/** At most this many records are typed at once (the search narrows the rest). */
export const DRAWER_ROWS = 250;

/** A card-index drawer laid open: the sheet's records as a read-only ledger table, with a search. */
export function DrawerSheet({ sheet }: { sheet: SheetName }) {
  const t = useT();
  const browse = useArchive((s) => s.browse);
  const close = useArchive((s) => s.closeDrawer);
  const company = useGame((s) => s.company);
  const mine = useGame((s) => s.myCompany);
  const [query, setQuery] = useState('');
  const book = browse?.status === 'ready' ? browse.book : null;
  const data = book?.sheets.find((s) => s.name === sheet) ?? null;

  const rows = useMemo(() => {
    if (!data || !book) return [];
    const printed = data.rows.map((r, i) => ({ n: data.rowNumbers[i] ?? 0, cells: r.map((v, c) => cellText(t, data.columns[c]!, v, book)) }));
    const q = query.trim().toLocaleLowerCase(t.locale);
    return q ? printed.filter((r) => r.cells.some((c) => c.toLocaleLowerCase(t.locale).includes(q))) : printed;
  }, [data, book, query, t]);

  const sub = company === 'mine' && mine ? t.t('ui.archive.drawer.sub.mine', { name: mine.companyName, date: mine.snapshotDate }) : t.t('ui.archive.drawer.sub.sample');
  const shown = rows.slice(0, DRAWER_ROWS);

  return (
    <Sheet title={t.t(sheetSpec(sheet).labelKey)} onClose={close} width={1320} testId="drawer-sheet">
      <p className="m-0 mt-2 font-type text-label text-ink-muted" data-testid="drawer-sub">
        {sub}
      </p>
      {!browse || browse.status === 'loading' ? (
        <p className="m-0 mt-6 font-hand text-2xl font-semibold italic" style={{ color: '#5a2a14' }} role="status">
          {t.t('ui.archive.drawer.loading')}
        </p>
      ) : !data ? (
        <p className="m-0 mt-6 font-type text-label font-bold text-oxblood-ink" role="alert">
          {t.t('ui.archive.drawer.failed')}
        </p>
      ) : !data.present ? (
        <p className="m-0 mt-6 font-type text-label" data-testid="drawer-absent">
          {t.t('ui.archive.drawer.absent')}
        </p>
      ) : data.rows.length === 0 ? (
        <p className="m-0 mt-6 font-type text-label">{t.t('ui.archive.drawer.empty')}</p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-4">
            <label className="flex items-center gap-3 font-type text-label font-bold">
              {t.t('ui.archive.drawer.search')}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-touch w-[360px] rounded-sm border-2 border-ink bg-[#f4ecd6] px-3 font-type text-label text-ink"
                data-testid="drawer-search"
              />
            </label>
            <span className="font-type text-label text-ink-muted" role="status" data-testid="drawer-shown">
              {t.t('ui.archive.drawer.shown', { shown: shown.length, total: data.rows.length })}
            </span>
          </div>
          <div className="telegram-scroll mt-3 max-h-[520px] overflow-auto border-y-2 border-ink" tabIndex={0} role="region" aria-label={t.t(sheetSpec(sheet).labelKey)} data-testid="drawer-table">
            <table className="w-max min-w-full border-collapse font-type text-label">
              <thead className="sticky top-0 z-10" style={{ background: '#e6d8b6' }}>
                <tr className="border-b-2 border-ink text-left align-bottom">
                  <th scope="col" className="px-2 py-1.5 font-bold">
                    {t.t('ui.archive.drawer.row')}
                  </th>
                  {data.columns.map((c) => (
                    <th key={c.key} scope="col" className={`px-2 py-1.5 ${isFigure(c) ? 'text-right' : ''}`}>
                      <span className="block font-bold">{t.t(c.labelKey)}</span>
                      <span className="block font-normal text-ink-muted">{t.t(`import.unit.${c.unit}`)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.n} className="border-b border-dotted border-[rgba(60,40,20,.45)]" data-testid="drawer-row">
                    <td className="px-2 py-1.5 text-ink-muted">{r.n}</td>
                    {r.cells.map((c, i) => (
                      <td key={data.columns[i]!.key} className={`max-w-[320px] px-2 py-1.5 ${isFigure(data.columns[i]!) ? 'whitespace-nowrap text-right font-bold' : ''}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="m-0 px-2 py-3 font-type text-label">{t.t('ui.archive.drawer.noMatch')}</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}
