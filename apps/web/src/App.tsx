import { useEffect } from 'react';
import { useT } from './i18n';
import { useGame } from './store/game';
import { Desk } from './desk/Desk';
import { Stage } from './desk/Stage';

export function App() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.t('ui.documentTitle');
  }, [locale, t]);
  return (
    <Stage>
      <Desk />
    </Stage>
  );
}
