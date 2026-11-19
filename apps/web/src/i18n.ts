import { useMemo } from 'react';
import { type Translator, createTranslator } from '@ceo-room/i18n';
import { useGame } from './store/game';

/** The translator for the chosen locale, with the company's names and currency. */
export function useT(): Translator {
  const locale = useGame((s) => s.locale);
  const directory = useGame((s) => s.directory);
  const currency = useGame((s) => s.currency);
  return useMemo(
    () =>
      createTranslator(locale, {
        directory: directory ?? undefined,
        currency,
        onMissing: (code) => {
          if (import.meta.env.DEV) console.warn(`[i18n] missing ${locale} text for "${code}"`);
        },
      }),
    [locale, directory, currency],
  );
}
