import { useEffect } from 'react';
import { useT } from '../i18n';
import { useArchive } from '../store/archive';
import { useGame } from '../store/game';
import { Sheet } from '../desk/Sheet';
import { CompanySwitch } from './CompanySwitch';
import { DrawerSheet } from './DrawerSheet';
import { FilingCabinet } from './FilingCabinet';
import { InspectionReport } from './InspectionReport';
import { PrivacyCard, RegisterBook } from './RegisterBook';
import { TemplateForms } from './TemplateForms';
import { UploadBlotter } from './UploadBlotter';

/** The records room behind the Desk: oak panelling, a reading table and the green lamp's pool. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-[1] h-[900px] w-[1440px]">
      <svg width={1440} height={900} className="absolute left-0 top-0">
        <defs>
          <filter id="oak-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09 0.006" numOctaves={4} seed={19} />
            <feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.2  0 0 0 0 0.09  1 0.9 0 0 -0.38" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="#22120a" />
        <rect width="100%" height="100%" filter="url(#oak-grain)" />
      </svg>
      {/* panelled wall: stiles every 240 px, a chair rail, the reading table's edge */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(90deg,rgba(0,0,0,.42) 0,rgba(0,0,0,.42) 3px,rgba(255,205,150,.06) 3px,rgba(255,205,150,.06) 5px,transparent 5px,transparent 240px)',
        }}
      />
      <div className="absolute left-0 right-0 top-[584px] h-[10px]" style={{ background: 'linear-gradient(180deg,#5a3a1e,#2a170b)', boxShadow: '0 4px 8px rgba(0,0,0,.6)' }} />
      {/* the green-shaded reading lamp's light: warm in the middle, a little green under the shade */}
      <div
        className="lamp-flicker absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 520px 420px at 1180px 230px,rgba(214,226,150,.20),rgba(255,180,90,.12) 45%,rgba(0,0,0,0) 72%),radial-gradient(ellipse 620px 520px at 700px 380px,rgba(255,196,110,.26),rgba(255,150,60,.08) 50%,rgba(0,0,0,0) 74%)',
        }}
      />
    </div>
  );
}

/** A banker's lamp: green glass shade on a brass stem (decorative). */
function GreenLamp() {
  return (
    <svg aria-hidden="true" className="absolute left-[1104px] top-[78px] z-[11]" width="170" height="78" viewBox="0 0 170 78">
      <defs>
        <linearGradient id="lamp-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f8a5c" />
          <stop offset=".55" stopColor="#1f5a34" />
          <stop offset="1" stopColor="#123a22" />
        </linearGradient>
        <linearGradient id="lamp-brass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8c6b25" />
          <stop offset=".5" stopColor="#ecd084" />
          <stop offset="1" stopColor="#8c6b25" />
        </linearGradient>
        <radialGradient id="lamp-glow" cx=".5" cy="0" r="1">
          <stop offset="0" stopColor="rgba(255,226,150,.55)" />
          <stop offset="1" stopColor="rgba(255,226,150,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="85" cy="62" rx="76" ry="14" fill="url(#lamp-glow)" />
      <path d="M14 52 Q20 16 85 12 Q150 16 156 52 Z" fill="url(#lamp-glass)" stroke="#0d2616" strokeWidth="1.5" />
      <path d="M26 44 Q36 22 85 19" fill="none" stroke="rgba(220,255,220,.35)" strokeWidth="3" strokeLinecap="round" />
      <rect x="12" y="50" width="146" height="6" rx="3" fill="url(#lamp-brass)" />
      <rect x="80" y="2" width="10" height="11" rx="2" fill="url(#lamp-brass)" />
    </svg>
  );
}

function ConfirmReplace() {
  const t = useT();
  const mine = useGame((s) => s.myCompany);
  const cancel = useArchive((s) => s.cancelConfirm);
  const confirm = useArchive((s) => s.confirmImport);
  return (
    <Sheet title={t.t('ui.archive.confirm.replace.title')} onClose={cancel} width={600} testId="confirm-replace" role="alertdialog">
      <p className="m-0 mt-4 font-type text-label leading-relaxed">
        {t.t('ui.archive.confirm.replace.body', { name: mine?.companyName ?? '', date: mine?.snapshotDate ?? '' })}
      </p>
      <ConfirmButtons yes={t.t('ui.archive.confirm.replace.yes')} onYes={() => void confirm()} onNo={cancel} testId="confirm-replace-yes" />
    </Sheet>
  );
}

function ConfirmRemove() {
  const t = useT();
  const cancel = useArchive((s) => s.cancelConfirm);
  const confirm = useArchive((s) => s.confirmRemove);
  return (
    <Sheet title={t.t('ui.archive.confirm.remove.title')} onClose={cancel} width={600} testId="confirm-remove" role="alertdialog">
      <p className="m-0 mt-4 font-type text-label leading-relaxed">{t.t('ui.archive.confirm.remove.body')}</p>
      <ConfirmButtons yes={t.t('ui.archive.confirm.remove.yes')} onYes={() => void confirm()} onNo={cancel} testId="confirm-remove-yes" />
    </Sheet>
  );
}

function ConfirmButtons({ yes, onYes, onNo, testId }: { yes: string; onYes: () => void; onNo: () => void; testId: string }) {
  const t = useT();
  return (
    <div className="mt-6 flex justify-end gap-3">
      <button
        type="button"
        onClick={onNo}
        className="press min-h-touch cursor-pointer rounded-sm border-2 border-ink bg-transparent px-5 font-type text-label font-bold text-ink hover:bg-[rgba(36,26,16,.08)]"
      >
        {t.t('ui.archive.confirm.cancel')}
      </button>
      <button
        type="button"
        onClick={onYes}
        className="press min-h-touch cursor-pointer rounded-sm border-2 border-[#6a1c1f] bg-[#6a1c1f] px-5 font-type text-label font-bold text-cream-2 hover:bg-[#7d2a2f]"
        data-testid={testId}
      >
        {yes}
      </button>
    </div>
  );
}

/**
 * The Archive Room (Arşiv Odası): the company's records in a card index, the Excel template in the
 * pigeonhole, the upload blotter and its typed inspection report, the register of data sources and
 * the switch between the sample company and My company. Nothing here leaves the browser.
 */
export function ArchiveRoom() {
  const company = useGame((s) => s.company);
  const locale = useGame((s) => s.locale);
  const importedAt = useGame((s) => s.myCompany?.importedAt ?? null);
  const drawer = useArchive((s) => s.drawer);
  const confirm = useArchive((s) => s.confirm);
  const loadBrowse = useArchive((s) => s.loadBrowse);
  // the drawers' counts (and an open drawer) follow the company on the desk and the language
  useEffect(() => {
    void loadBrowse();
  }, [company, locale, importedAt, loadBrowse]);

  return (
    <div className="absolute left-0 top-0 h-[900px] w-[1440px]" data-testid="archive-room">
      <Backdrop />
      <GreenLamp />
      <FilingCabinet />
      <CompanySwitch />
      <UploadBlotter />
      <TemplateForms />
      <RegisterBook />
      <InspectionReport />
      <PrivacyCard />
      {drawer && <DrawerSheet sheet={drawer} />}
      {confirm === 'replace' && <ConfirmReplace />}
      {confirm === 'remove' && <ConfirmRemove />}
    </div>
  );
}
