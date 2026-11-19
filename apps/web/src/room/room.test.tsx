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
import { PRESS_MS } from './ActionBar';
import { deltaCell, millions } from './impact';
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

  it('choosing an option then pressing the seal sends approveOption after the press', () => {
    vi.useFakeTimers();
    render(<DecisionRoom />);
    fireEvent.click(screen.getByTestId('approve-seal'));
    expect(screen.getByTestId('room-status').textContent).toContain('bir seçenek seçin');
    const switchNote = screen.getAllByTestId('option-note')[1]!;
    fireEvent.click(switchNote.querySelector('[data-testid=choose-option]')!);
    expect(useGame.getState().room?.selected).toBe('switch');
    fireEvent.click(screen.getByTestId('approve-seal'));
    expect(screen.getByTestId('approved-stamp')).toBeTruthy();
    expect(sent).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(PRESS_MS);
    });
    expect(sent).toEqual([{ type: 'dispatch', command: { type: 'approveOption', decisionId: 'dec-0001', optionId: 'switch' } }]);
  });

  it('while its figures are for an older day the room shows no numbers', () => {
    useGame.setState({ version: 4 });
    render(<DecisionRoom />);
    expect(screen.queryAllByTestId('option-note')).toHaveLength(0);
    expect(screen.getByTestId('room-note').textContent).toContain('hesaplıyor');
  });
});
