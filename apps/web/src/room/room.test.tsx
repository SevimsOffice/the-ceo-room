// @vitest-environment jsdom
/**
 * The Decision Room's pure helpers (memo lines → engine commands, impact cells) and the room
 * rendered from a real worker view: notes, baseline, advisors, and the seal sending its command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEngine, selectDecision } from '@ceo-room/engine';
import { createTranslator } from '@ceo-room/i18n';
import { loadSeed } from '@ceo-room/seed-data';
import { RNG_SEED, WORKSPACE_ID } from '../worker/handler';
import { roomView } from '../worker/room';
import type { WorkerRequest } from '../worker/protocol';
import { setTransport, useGame } from '../store/game';
import { buildDirectory } from '../worker/directory';
import { DecisionRoom } from './DecisionRoom';
import { deskFocusTarget } from '../desk/Desk';
import { PRESS_MS } from './ActionBar';
import { deltaCell, millions } from './impact';
import { optionName } from './names';
import { answersDemand, availableKinds, lineToCommand, memoCommands, newLine, parsePercent, parseQty, sameMemo, switchTargets } from './memo';

const seed = loadSeed();
const engine = createEngine(seed, { rngSeed: RNG_SEED, workspaceId: WORKSPACE_ID });
const view = roomView(engine, 'dec-0001')!;
const catalog = view.memo!;
const tr = createTranslator('tr');
const en = createTranslator('en');

describe('memo lines', () => {
  it('reads typed numbers strictly', () => {
    expect(parsePercent('12')).toBe(1200);
    expect(parsePercent('12,5')).toBe(1250);
    expect(parsePercent('0.25')).toBe(25);
    expect(parsePercent(' 7 ')).toBe(700);
    expect(parsePercent('12.345')).toBeNull();
    expect(parsePercent('-3')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
    expect(parseQty('2.000')).toBe(2000);
    expect(parseQty('2,000')).toBe(2000);
    expect(parseQty('1.5x')).toBeNull();
    expect(parseQty('')).toBeNull();
  });

  it('never reads a decimal quantity as a larger whole number; grouped thousands are accepted', () => {
    // review fix: "2.5" was read as 25 and "1,5" as 15
    for (const bad of ['2.5', '1,5', '0.5', '12.34.5', '1.234,567', '12.50', '1 5', '.500', '12.', '0.500', '0,500', '000.500', '00.500', '0 500']) expect(parseQty(bad), bad).toBeNull();
    // review fix: a grouped number never starts with a zero group ("0.500" is a decimal, not 500)
    expect(parseQty('007')).toBe(7);
    expect(parseQty('1.000.000')).toBe(1_000_000);
    expect(parseQty('100.000')).toBe(100_000);
    expect(parseQty('12.500')).toBe(12500);
    expect(parseQty('12,500')).toBe(12500);
    expect(parseQty('12500')).toBe(12500);
    expect(parseQty('12 500')).toBe(12500);
    expect(parseQty('1.250.000')).toBe(1_250_000);
    const po = (qty: string) => lineToCommand({ kind: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty }, catalog);
    expect(po('2.5')).toMatchObject({ ok: false, error: { key: 'ui.room.memo.error.qtyFormat' } });
    expect(po('1,5')).toMatchObject({ ok: false, error: { key: 'ui.room.memo.error.qtyFormat' } });
    expect(po('12.500')).toMatchObject({ ok: true, command: { qty: 12500 } });
    expect(po('0.500')).toMatchObject({ ok: false, error: { key: 'ui.room.memo.error.qtyFormat' } });
    // review fix: a whole number too large is out of range (with the max), not malformed
    const range = { ok: false, error: { key: 'ui.room.memo.error.qty', params: { max: catalog.limits.maxPurchaseQty } } };
    for (const big of ['9999999999999', '12345678901234567890', '1.000.000.000.000', String(catalog.limits.maxPurchaseQty + 1)]) expect(po(big), big).toMatchObject(range);
    expect(tr.has('ui.room.memo.error.qtyFormat') && en.has('ui.room.memo.error.qtyFormat')).toBe(true);
  });

  it('builds exactly the engine’s intent commands, within its limits', () => {
    expect(lineToCommand({ kind: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: '2000' }, catalog)).toEqual({
      ok: true,
      command: { type: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: 2000 },
    });
    expect(lineToCommand({ kind: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: '0' }, catalog)).toMatchObject({ ok: false, error: { key: 'ui.room.memo.error.qty' } });
    expect(lineToCommand({ kind: 'placePurchaseOrder', supplierId: 'sup_kuzeycelik', materialId: 'steel', qty: String(catalog.limits.maxPurchaseQty + 1) }, catalog).ok).toBe(false);
    expect(lineToCommand({ kind: 'repriceOrders', materialId: 'steel', percent: '50' }, catalog)).toEqual({ ok: true, command: { type: 'repriceOrders', materialId: 'steel', passThroughBps: 5000 } });
    expect(lineToCommand({ kind: 'repriceOrders', materialId: 'steel', percent: '101' }, catalog).ok).toBe(false);
    expect(lineToCommand({ kind: 'repriceOrders', materialId: 'aluminium', percent: '10' }, catalog)).toMatchObject({ ok: false, error: { key: 'ui.room.memo.error.noReprice' } });
    expect(lineToCommand({ kind: 'grantDiscount', customerId: 'cus_velora', percent: '50' }, catalog)).toEqual({ ok: true, command: { type: 'grantDiscount', customerId: 'cus_velora', discountBps: 5000 } });
    expect(lineToCommand({ kind: 'grantDiscount', customerId: 'cus_velora', percent: '50.01' }, catalog).ok).toBe(false);
    // the preferred supplier is not a switch target
    expect(switchTargets(catalog, 'steel')).not.toContain('sup_kuzeycelik');
    expect(lineToCommand({ kind: 'switchSupplier', materialId: 'steel', toSupplierId: 'sup_kuzeycelik' }, catalog).ok).toBe(false);
    expect(lineToCommand(newLine('switchSupplier', catalog), catalog).ok).toBe(true);
  });

  it('a memo needs one to four valid lines; only a supplier price rise can be passed on', () => {
    expect(memoCommands([], catalog).commands).toBeNull();
    const line = { kind: 'repriceOrders' as const, materialId: 'steel', percent: '' };
    expect(newLine('repriceOrders', catalog)).toEqual(line);
    expect(memoCommands([{ ...line, percent: '10' }], catalog).commands).toHaveLength(1);
    expect(memoCommands([{ ...line, percent: '10' }, { ...line, percent: 'x' }], catalog)).toMatchObject({ commands: null, errors: [null, { key: 'ui.room.memo.error.passThrough' }] });
    expect(availableKinds(catalog)).toEqual(['placePurchaseOrder', 'switchSupplier', 'repriceOrders', 'grantDiscount']);
    expect(availableKinds({ ...catalog, repriceMaterialId: null })).not.toContain('repriceOrders');
    expect(sameMemo([{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 1 }], [{ type: 'repriceOrders', materialId: 'steel', passThroughBps: 1 }])).toBe(true);
    expect(sameMemo(null, [])).toBe(false);
  });

  it('on a discount demand a memo without a discount to that customer is a refusal', () => {
    const c = { ...catalog, demand: { customerId: 'cus_velora', discountBps: 800 } };
    expect(newLine('grantDiscount', c)).toEqual({ kind: 'grantDiscount', customerId: 'cus_velora', percent: '8' });
    expect(answersDemand([{ type: 'grantDiscount', customerId: 'cus_velora', discountBps: 0 }], c)).toBe(true);
    expect(answersDemand([{ type: 'placePurchaseOrder', supplierId: 's', materialId: 'm', qty: 1 }], c)).toBe(false);
    expect(answersDemand([], catalog)).toBe(true);
  });
});

describe('impact cells', () => {
  it('print engine deltas in the row’s unit, with tone', () => {
    expect(millions(0, tr, true)).toBe('0');
    expect(millions(-1_803_480_000, tr, true)).toBe('−18,0');
    expect(millions(82_432_050, en, true)).toBe('+0.82');
    const neg30 = view.impacts!.options.find((o) => o.optionId === 'negotiate')!.horizons[1]!;
    expect(deltaCell(tr, 'cash', neg30)).toEqual({ text: millions(neg30.delta.cash, tr, true), tone: 'bad' });
    expect(deltaCell(tr, 'risk', neg30).text).toBe(tr.t(`ui.room.risk.${neg30.risk.option}`));
    expect(deltaCell(en, 'margin', neg30).tone).toBe(neg30.delta.grossMarginBps > 0 ? 'good' : 'bad');
  });
});

describe('DecisionRoom', () => {
  let sent: WorkerRequest[];
  beforeEach(() => {
    sent = [];
    setTransport({ send: (m) => sent.push(m) });
    useGame.setState({
      phase: 'ready',
      locale: 'tr',
      version: 3,
      directory: buildDirectory(engine.state()),
      view: 'room',
      room: { decisionId: 'dec-0001', view: { version: 3, data: view }, selected: null, pending: null, memoOpen: false, memo: null },
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the situation, the three options with +7/+30, the baseline and both advisors', () => {
    render(<DecisionRoom />);
    expect(screen.getAllByTestId('option-note').map((n) => n.dataset.option)).toEqual(['negotiate', 'switch', 'passOn']);
    expect(screen.getAllByTestId('impact-horizon')).toHaveLength(6);
    expect(screen.getAllByTestId('baseline-row')).toHaveLength(2);
    expect(screen.getByTestId('advisor-cfo').dataset.recommends).toBe(view.advisors[0]!.recommendedOptionId);
    expect(screen.getByTestId('advisor-coo').dataset.recommends).toBe(view.advisors[1]!.recommendedOptionId);
    expect(screen.getByTestId('room-figure-figure.cash').textContent).toBe(tr.money(selectDecision(engine.state(), 'dec-0001')!.supportingFigures[0]!.value));
  });

  it('choosing an option then pressing the seal sends approveOption at the press (the seal coming down is only drawn)', () => {
    vi.useFakeTimers();
    render(<DecisionRoom />);
    fireEvent.click(screen.getByTestId('approve-seal'));
    expect(screen.getByTestId('room-status').textContent).toContain('bir seçenek seçin');
    const switchNote = screen.getAllByTestId('option-note')[1]!;
    fireEvent.click(switchNote.querySelector('[data-testid=choose-option]')!);
    expect(useGame.getState().room?.selected).toBe('switch');
    fireEvent.click(screen.getByTestId('approve-seal'));
    expect(screen.getByTestId('approved-stamp')).toBeTruthy();
    expect(sent).toEqual([{ type: 'dispatch', command: { type: 'approveOption', decisionId: 'dec-0001', optionId: 'switch' } }]);
    act(() => {
      vi.advanceTimersByTime(PRESS_MS);
    });
    expect(sent).toHaveLength(1);
  });

  it('leaving the room during the press does not drop the command', () => {
    vi.useFakeTimers();
    useGame.setState({ room: { ...useGame.getState().room!, selected: 'negotiate' } });
    render(<DecisionRoom />);
    fireEvent.click(screen.getByTestId('approve-seal'));
    // the room goes away at once (e.g. the CEO switched rooms): nothing is waiting on a timer
    cleanup();
    act(() => {
      vi.advanceTimersByTime(PRESS_MS * 2);
    });
    expect(sent).toEqual([{ type: 'dispatch', command: { type: 'approveOption', decisionId: 'dec-0001', optionId: 'negotiate' } }]);
  });

  it('focus: the options heading on opening; the pressed seal keeps focus (aria-disabled) and has it back after a refusal', () => {
    useGame.setState({ room: { ...useGame.getState().room!, selected: 'switch' } });
    render(<DecisionRoom />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: /seçenek/ }));
    const seal = screen.getByTestId('approve-seal');
    seal.focus();
    fireEvent.click(seal);
    expect(useGame.getState().room?.pending).toBe('approve');
    expect(seal.getAttribute('aria-disabled')).toBe('true');
    expect(seal.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(seal);
    // a second press while it is being sent does nothing
    fireEvent.click(seal);
    expect(sent.filter((m) => m.type === 'dispatch')).toHaveLength(1);
    act(() => {
      useGame.getState().receive({ type: 'dispatched', ok: false, command: { type: 'approveOption', decisionId: 'dec-0001', optionId: 'switch' }, error: { code: 'error.decisionClosed', params: {} } });
    });
    expect(useGame.getState().room?.pending).toBeNull();
    expect(screen.queryByTestId('approved-stamp')).toBeNull();
    expect(seal.getAttribute('aria-disabled')).toBe('false');
    expect(document.activeElement).toBe(seal);
  });

  it('every joined phrase comes from the catalogue (option names, advisor title and signature, deadline line)', () => {
    useGame.setState({ locale: 'en' });
    render(<DecisionRoom />);
    const cfo = view.advisors[0]!;
    expect(screen.getByTestId('advisor-cfo').querySelector('h3')!.textContent).toBe(en.t('ui.room.advisor.title', { title: en.t(cfo.titleKey), role: 'CFO' }));
    expect(screen.getByTestId('advisor-cfo').querySelector('[data-testid=advisor-signature]')!.textContent).toBe(en.t('ui.room.advisor.signature', { name: cfo.advisorName, role: 'CFO' }));
    expect(screen.getByTestId('room-deadline').textContent).toContain(' · ');
    const sw = view.options.find((o) => o.id === 'switch')!;
    expect(optionName(en, view, 'switch')).toBe(en.t('ui.room.optionName', { letter: 'B', label: en.t(sw.labelKey) }));
    expect(optionName(en, view, 'switch')).toMatch(/^B — /);
    expect(optionName(tr, view, 'absorb')).toBe(tr.t('ui.room.baselineName', { label: tr.t(view.options[0]!.labelKey) }));
    for (const loc of [tr, en]) {
      for (const k of ['ui.room.optionName', 'ui.room.advisor.title', 'ui.room.advisor.signature', 'ui.room.deadlineLine', 'ui.room.memo.lineNumber', 'ui.room.withNote', 'ui.room.memo.qtyRead']) {
        expect(loc.has(k), `${loc.locale} ${k}`).toBe(true);
      }
    }
  });

  it('the memo shows how a typed quantity was read, before any preview', () => {
    useGame.setState({ room: { ...useGame.getState().room!, memoOpen: true } });
    render(<DecisionRoom />);
    // the steel decision opens the memo on a purchase-order line (no demand to answer)
    const qty = screen.getByTestId('memo-qty');
    fireEvent.change(qty, { target: { value: '12.500' } });
    const named = createTranslator('tr', { directory: buildDirectory(engine.state()) });
    expect(screen.getByTestId('memo-qty-read').textContent).toBe(named.t('ui.room.memo.qtyRead', { qty: 12500, materialId: 'steel' }));
    expect(screen.getByTestId('memo-qty-read').textContent).toContain('12.500 birim');
    fireEvent.change(qty, { target: { value: '12500' } });
    expect(screen.getByTestId('memo-qty-read').textContent).toContain('12.500 birim');
    fireEvent.change(qty, { target: { value: '2.5' } });
    expect(screen.queryByTestId('memo-qty-read')).toBeNull();
    expect(screen.getByTestId('memo-error').textContent).toBe(tr.t('ui.room.memo.error.qtyFormat'));
    expect(sent.filter((m) => m.type === 'previewCustom')).toHaveLength(0);
  });

  it('advisor letters are folded to the pick and first caution; "read more" is a real toggle', () => {
    render(<DecisionRoom />);
    const cfo = screen.getByTestId('advisor-cfo');
    const toggle = cfo.querySelector<HTMLButtonElement>('[data-testid=advisor-toggle]')!;
    const rationale = cfo.querySelector<HTMLElement>('[data-testid=advisor-rationale]')!;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(rationale.id);
    expect(toggle.textContent).toContain(tr.t('ui.room.advisor.more'));
    expect(rationale.hidden).toBe(true);
    const items = [...cfo.querySelectorAll<HTMLElement>('[data-testid=advisor-caveats] li')];
    expect(items[0]!.hidden).toBe(false);
    for (const li of items.slice(1)) expect(li.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain(tr.t('ui.room.advisor.less'));
    expect(rationale.hidden).toBe(false);
    for (const li of items) expect(li.hidden).toBe(false);
    // the other letter stays as it was
    expect(screen.getByTestId('advisor-coo').querySelector('[data-testid=advisor-toggle]')!.getAttribute('aria-expanded')).toBe('false');
    expect(en.t('ui.room.advisor.more')).toBe('read more');
    expect(tr.t('ui.room.advisor.more')).toBe('devamını oku');
  });

  it('+1 day advances exactly one day from the room, and waits while anything is running or pending', () => {
    render(<DecisionRoom />);
    const day = screen.getByTestId('room-advance-day');
    expect(day.textContent).toContain(tr.t('ui.room.action.day'));
    expect(day.getAttribute('aria-label')).toBe(tr.t('ui.room.action.day.aria'));
    fireEvent.click(day);
    fireEvent.click(day);
    expect(sent).toEqual([{ type: 'advance', days: 1 }]);
    expect(useGame.getState().advancePending).toBe(true);
    expect(day.getAttribute('aria-disabled')).toBe('true');
    // a decision being sent, or auto-play, keeps the clock where it is
    act(() => useGame.setState({ advancePending: false, room: { ...useGame.getState().room!, pending: 'analysis' } }));
    fireEvent.click(day);
    act(() => useGame.setState({ room: { ...useGame.getState().room!, pending: null }, playing: true }));
    expect(day.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(day);
    expect(sent).toHaveLength(1);
    act(() => useGame.setState({ playing: false }));
    expect(day.getAttribute('aria-disabled')).toBe('false');
  });

  it('a pressed Preview keeps the focus in the memo (aria-disabled while previewing, never disabled)', () => {
    useGame.setState({ room: { ...useGame.getState().room!, memoOpen: true } });
    render(<DecisionRoom />);
    fireEvent.change(screen.getByTestId('memo-qty'), { target: { value: '100' } });
    const preview = screen.getByTestId('memo-preview-button');
    expect(preview.getAttribute('aria-disabled')).toBe('false');
    preview.focus();
    fireEvent.click(preview);
    expect(sent.filter((m) => m.type === 'previewCustom')).toHaveLength(1);
    expect(useGame.getState().room?.memo?.status).toBe('waiting');
    expect(preview.hasAttribute('disabled')).toBe(false);
    expect(preview.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(preview);
    // pressed again while waiting: nothing more is asked
    fireEvent.click(preview);
    expect(sent.filter((m) => m.type === 'previewCustom')).toHaveLength(1);
  });

  it('a choice cannot be made while a decision is being sent; the pressed choice keeps the focus', () => {
    render(<DecisionRoom />);
    const choose = screen.getAllByTestId('choose-option')[0]!;
    choose.focus();
    act(() => useGame.setState({ room: { ...useGame.getState().room!, pending: 'analysis' } }));
    expect(choose.hasAttribute('disabled')).toBe(false);
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(choose);
    fireEvent.click(choose);
    expect(useGame.getState().room?.selected).toBeNull();
    act(() => useGame.setState({ room: { ...useGame.getState().room!, pending: null } }));
    expect(choose.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(choose);
    expect(useGame.getState().room?.selected).toBe('negotiate');
  });

  it('while its figures are for an older day the room shows no numbers', () => {
    useGame.setState({ version: 4 });
    render(<DecisionRoom />);
    expect(screen.queryAllByTestId('option-note')).toHaveLength(0);
    expect(screen.getByTestId('room-note').textContent).toContain('hesaplıyor');
  });
});

describe('focus on the Desk after the room closes', () => {
  it('goes to the carbon copy of that decision, else its telegram, else its folder, else the morning report', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <h2 id="report-title" tabindex="-1">report</h2>
      <button data-testid="decision-folder" data-decision="dec-0001">folder</button>
      <article data-testid="telegram" data-decision="dec-0001"><button>telegram</button></article>
      <button data-testid="ledger-slip" data-decision="dec-0001">slip</button>`;
    const pick = (id: string | null) => deskFocusTarget(root, id)?.textContent;
    expect(pick('dec-0001')).toBe('slip');
    root.querySelector('[data-testid=ledger-slip]')!.setAttribute('data-decision', 'dec-0002');
    expect(pick('dec-0001')).toBe('telegram');
    root.querySelector('[data-testid=telegram]')!.remove();
    expect(pick('dec-0001')).toBe('folder');
    expect(pick('dec-0003')).toBe('report');
    expect(pick(null)).toBe('report');
  });
});
