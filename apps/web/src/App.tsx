import { useEffect } from 'react';
import { useGame } from './store/game';
import { useT } from './i18n';

export function App() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const report = useGame((s) => s.report);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.t('ui.documentTitle');
  }, [locale, t]);
  return <main className="p-8 font-type">{report ? t.t('ui.header.day', { day: report.day, weekday: t.t(report.weekdayCode) }) : t.t('ui.status.loading')}</main>;
}
