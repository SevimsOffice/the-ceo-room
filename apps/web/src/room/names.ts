/** How the room names its options: letters on the table, the default as the baseline. */
import type { Msg } from '@ceo-room/engine';
import type { Translator } from '@ceo-room/i18n';
import type { RoomView } from '../worker/protocol';

/** Letters of the options on the table (the default option is the baseline, not lettered). */
export function optionLetters(v: RoomView): Map<string, string> {
  const out = new Map<string, string>();
  v.options.filter((o) => o.id !== v.defaultOptionId).forEach((o, i) => out.set(o.id, String.fromCharCode(65 + i)));
  return out;
}

/** An option's name for advisor notes and the status line: "B — Switch to the alternative supplier". */
export function optionName(t: Translator, v: RoomView, optionId: string): string {
  const o = v.options.find((x) => x.id === optionId);
  const label = o ? t.t(o.labelKey) : optionId;
  if (optionId === v.defaultOptionId) return t.t('ui.room.baselineName', { label });
  return `${optionLetters(v).get(optionId) ?? ''} — ${label}`;
}

/** An engine message whose option ids are printed as the options' names. */
export function withOptionNames(t: Translator, v: RoomView, m: Msg): string {
  const params: Record<string, string | number | boolean | null> = { ...m.params };
  for (const k of ['optionId', 'thirtyDayOptionId']) {
    const id = params[k];
    if (typeof id === 'string') params[k] = optionName(t, v, id);
  }
  return t.t(m.code, params);
}

