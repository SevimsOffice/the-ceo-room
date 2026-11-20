import { useT } from '../i18n';
import { useArchive } from '../store/archive';
import { PaperNoise } from '../desk/Atmosphere';
import type { DownloadKind } from './protocol';

/**
 * The pigeonhole with the printed forms: the Excel template filled with the sample company, and the
 * empty one (README with the instructions; codes, labels and units rows). In the chosen language,
 * written in the browser.
 */
export function TemplateForms() {
  const t = useT();
  const downloading = useArchive((s) => s.downloading);
  const download = useArchive((s) => s.download);
  const lang = t.t(`ui.locale.${t.locale}.name`);
  const form = (kind: Extract<DownloadKind, 'example' | 'empty'>, title: string, note: string, tilt: number) => (
    <button
      type="button"
      onClick={() => void download(kind)}
      disabled={downloading !== null}
      aria-label={t.t('ui.archive.forms.download', { name: title, lang })}
      className="press paper on-paper relative flex h-[84px] flex-1 cursor-pointer flex-col items-start justify-center px-3 text-left disabled:cursor-wait"
      style={{ transform: `rotate(${tilt}deg)`, boxShadow: '0 6px 12px rgba(0,0,0,.55)' }}
      data-testid={`download-${kind}`}
    >
      <PaperNoise id={`paper-form-${kind}`} opacity={0.25} />
      <span className="relative font-display text-[17px] font-extrabold leading-tight">{title}</span>
      <span className="relative mt-0.5 font-type text-label leading-tight text-ink-muted">{downloading === kind ? t.t('ui.archive.forms.working') : note}</span>
      <span className="relative mt-0.5 font-type text-label font-bold leading-tight text-oxblood-ink">{t.t('ui.archive.forms.format', { lang })}</span>
    </button>
  );
  return (
    <section
      aria-labelledby="forms-title"
      className="absolute left-[476px] top-[452px] z-10 w-[460px] rounded-[4px] px-3 pb-3 pt-1.5"
      style={{ background: 'linear-gradient(180deg,#4e2f17,#3a2210)', boxShadow: 'inset 0 0 0 2px #24130a, 0 14px 24px rgba(0,0,0,.6)' }}
      data-testid="template-forms"
    >
      <h2 id="forms-title" className="m-0 mb-1.5 font-type text-label font-bold uppercase tracking-[.14em] text-brass-text">
        {t.t('ui.archive.forms.heading')}
      </h2>
      {/* two pigeonholes */}
      <div className="flex gap-3 rounded-[2px] p-2" style={{ background: '#1d0f07', boxShadow: 'inset 0 6px 12px rgba(0,0,0,.8)' }}>
        {form('example', t.t('ui.archive.forms.example'), t.t('ui.archive.forms.example.note'), -0.8)}
        {form('empty', t.t('ui.archive.forms.empty'), t.t('ui.archive.forms.empty.note'), 0.6)}
      </div>
    </section>
  );
}
