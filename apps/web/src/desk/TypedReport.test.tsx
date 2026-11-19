// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEngine, selectMorningReport, selectOverallHealth, selectProjectedRunway } from '@ceo-room/engine';
import { loadSeed } from '@ceo-room/seed-data';
import { buildDirectory } from '../worker/directory';
import type { WorkerRequest } from '../worker/protocol';
import { setTransport, useGame } from '../store/game';
import { TypedReport } from './TypedReport';
import { TelegramStack } from './TelegramStack';

const engine = createEngine(loadSeed(), { rngSeed: 42, workspaceId: 'ws_test' });
const state = engine.state();
const report = selectMorningReport(state, { includeRunway: false });
const runway = selectProjectedRunway(state);
const health = selectOverallHealth(state, runway);

function setup(withRunway: boolean, locale: 'tr' | 'en' = 'tr') {
  const sent: WorkerRequest[] = [];
  setTransport({ send: (m) => sent.push(m) });
  useGame.setState({
    locale,
    phase: 'ready',
    report,
    version: 1,
    runway: withRunway ? { version: 1, runway, health } : null,
    directory: buildDirectory(state),
    thresholds: { capacityComfortBps: 8500, capacityMaxBps: 12000, runwayDangerDays: 30, runwayHorizonDays: 180 },
    busy: null,
    playing: false,
    orderBook: null,
    dossier: null,
  });
  return sent;
}

afterEach(cleanup);

describe('TypedReport', () => {
  it('shows the report with runway "calculating…" until it arrives', () => {
    setup(false);
    render(<TypedReport />);
    expect(screen.getByText('Sabah Raporu')).toBeTruthy();
    expect(screen.getByText('NOVARA Sanayi')).toBeTruthy();
    expect(screen.getByTestId('report-cash-note').textContent).toBe('öngörülen nakit süresi: hesaplanıyor…');
    expect(screen.getByTestId('report-revenue-value').textContent).toBe('76,4 milyon TL');
  });

  it('fills in runway and health when the worker posts them', () => {
    setup(true, 'en');
    render(<TypedReport />);
    expect(screen.getByTestId('report-cash-note').textContent).toBe(`projected cash runway: ${runway.days} days`);
    expect(screen.getByTestId('report-health-value').textContent).toBe(`${health.score} / 100`);
  });

  it('the open-orders line opens the order book (a real request to the engine)', () => {
    const sent = setup(true);
    render(<TypedReport />);
    fireEvent.click(screen.getByTestId('report-orders'));
    expect(sent).toEqual([{ type: 'openOrderBook' }]);
    expect(useGame.getState().orderBook).toEqual({ book: null });
  });
});

describe('TelegramStack', () => {
  it('opening a telegram without a decision files it as read; one with a decision stays open', () => {
    const sent = setup(true, 'en');
    render(<TelegramStack />);
    const forms = screen.getAllByTestId('telegram');
    expect(forms).toHaveLength(report.telegrams.length);
    const large = forms.find((f) => f.dataset.code === 'card.largeOrder')!;
    fireEvent.click(large.querySelector('button')!);
    expect(sent).toEqual([{ type: 'dispatch', command: { type: 'acknowledgeDevelopment', developmentId: 'dev-0001' } }]);

    const price = forms.find((f) => f.dataset.code === 'card.supplierPriceIncrease')!;
    fireEvent.click(price.querySelector('button')!);
    expect(sent).toHaveLength(1);
    fireEvent.click(screen.getByText('Open dossier No. 1'));
    expect(sent.at(-1)).toEqual({ type: 'openDecision', decisionId: 'dec-0001' });
  });
});
