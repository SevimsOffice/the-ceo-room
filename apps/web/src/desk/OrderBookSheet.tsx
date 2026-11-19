import type { Compared, OrderBookLine } from '@ceo-room/engine';
import { type Translator, formatBps, formatSimDay } from '@ceo-room/i18n';
import { useT } from '../i18n';
import { useGame } from '../store/game';
import { Sheet } from './Sheet';

/** A live figure, with the plan next to it where they differ. */
function Cmp<T extends number | null>({ c, fmt, testId }: { c: Compared<T>; fmt: (v: T) => string; testId?: string }) {
  const t = useT();
  if (c.differs && c.plan !== null) {
    return (
      <span data-testid={testId} data-differs="true">
        <span className="font-bold">{fmt(c.live)}</span>
        <span className="block whitespace-normal text-label leading-snug text-oxblood-ink">{t.t('ui.orders.planToLive', { plan: fmt(c.plan), live: fmt(c.live) })}</span>
      </span>
    );
  }
  return (
    <span data-testid={testId} className="font-bold">
      {fmt(c.live)}
    </span>
  );
}

function Row({ o, t }: { o: OrderBookLine; t: Translator }) {
  const directory = useGame((s) => s.directory);
  const customer = directory?.customers[o.customerId] ?? o.customerId;
  const product = directory?.families[o.familyId] ? t.t(directory.families[o.familyId]!) : o.familyId;
  const day = (d: number | null) => (d === null ? t.t('ui.figure.none') : formatSimDay(d, t.locale));
  return (
    <tr className="border-b border-dotted border-[rgba(60,40,20,.45)] align-top" data-testid="order-row" data-order={o.orderId} data-differs={o.differs}>
      <td className="py-2 pr-3">
        <span className="font-bold">{o.orderId}</span>
      </td>
      <td className="py-2 pr-3">
        <span className="block truncate" title={customer}>
          {customer}
        </span>
        {o.blockedBy && <span className="block text-label text-oxblood-ink">{t.t('ui.orders.blocked', { materialId: o.blockedBy })}</span>}
      </td>
      <td className="py-2 pr-3">{product}</td>
      <td className="py-2 pr-3 text-right whitespace-nowrap">{t.t('ui.orders.progress', { done: o.unitsDone, qty: o.qty })}</td>
      <td className="py-2 pr-3 text-right">
        <Cmp c={o.figures.value} fmt={(v) => t.money(v)} testId="order-value" />
      </td>
      <td className="py-2 pr-3 text-right">
        <Cmp c={o.figures.marginBps} fmt={(v) => formatBps(v, t.locale, 1)} testId="order-margin" />
      </td>
      <td className="py-2 pr-3">
        <Cmp c={o.figures.promisedDay} fmt={day} />
      </td>
      <td className="py-2 pr-3">
        <Cmp c={o.figures.expectedShipDay} fmt={day} />
      </td>
      <td className="py-2">
        <Cmp c={o.figures.receivableDay} fmt={day} />
      </td>
    </tr>
  );
}

/** The order book: every open order, live figures with the plan alongside where they differ. */
export function OrderBookSheet() {
  const t = useT();
  const sheet = useGame((s) => s.orderBook);
  const close = useGame((s) => s.closeOrderBook);
  if (!sheet) return null;
  const book = sheet.book;
  const cols = ['order', 'customer', 'product', 'progress', 'value', 'margin', 'promised', 'ship', 'payment'] as const;
  const widths = [92, 190, 128, 84, 150, 150, 140, 150, 148];
  const right = new Set(['progress', 'value', 'margin']);
  return (
    <Sheet title={t.t('ui.orders.heading')} onClose={close} width={1320} testId="order-book">
      {!book && <p className="font-type text-label text-ink-muted">{t.t('ui.orders.loading')}</p>}
      {book && (
        <div className="font-type text-label text-ink">
          <p className="m-0 mt-3 text-label text-ink-muted" data-testid="order-book-sub">
            {t.t('ui.orders.sub', { count: book.totals.count, value: book.totals.value, day: book.day })}
          </p>
          <p className="m-0 mt-1 font-hand text-lg font-semibold italic" style={{ color: '#5a2a14' }}>
            {t.t('ui.orders.legend')}
            {book.orders.some((o) => !o.hasPlan) && ` ${t.t('ui.orders.noPlan')}`}
          </p>
          {book.orders.length === 0 ? (
            <p className="mt-4">{t.t('ui.orders.empty')}</p>
          ) : (
            <table className="mt-3 w-full table-fixed border-collapse">
              <colgroup>
                {widths.map((w, i) => (
                  <col key={cols[i]} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b-2 border-ink">
                  {cols.map((c) => (
                    <th key={c} scope="col" className={`pb-1.5 pr-3 text-label font-normal uppercase tracking-[.02em] text-ink-muted ${right.has(c) ? 'text-right' : 'text-left'}`}>
                      {t.t(`ui.orders.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {book.orders.map((o) => (
                  <Row key={o.orderId} o={o} t={t} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Sheet>
  );
}
