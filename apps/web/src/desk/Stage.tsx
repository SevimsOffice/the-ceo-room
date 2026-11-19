import { type ReactNode, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { WoodGrain } from './Atmosphere';

export const SCENE_W = 1440;
export const SCENE_H = 900;
/** Below this window width the Desk asks for a larger screen. */
export const MIN_WIDTH = 1280;

function useViewport(): { w: number; h: number } {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(get);
  useEffect(() => {
    const on = () => setVp(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

/** The 1440×900 scene, scaled to fit the window (≥1280 px wide); smaller windows get a note. */
export function Stage({ children }: { children: ReactNode }) {
  const { w, h } = useViewport();
  if (w < MIN_WIDTH) return <SmallScreenNote />;
  const scale = Math.min(w / SCENE_W, h / SCENE_H);
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-room">
      <div style={{ width: SCENE_W * scale, height: SCENE_H * scale, position: 'relative' }}>
        <div
          data-testid="scene"
          style={{ width: SCENE_W, height: SCENE_H, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SmallScreenNote() {
  const t = useT();
  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-desk p-6">
      <WoodGrain width="100%" height="100%" />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 45%, rgba(255,196,110,.30), rgba(0,0,0,0) 70%)' }} />
      <div className="paper on-paper relative max-w-md px-8 py-7" style={{ transform: 'rotate(-.8deg)', boxShadow: '0 2px 3px rgba(0,0,0,.4),0 26px 44px rgba(0,0,0,.65)' }}>
        <div className="brass mb-5 inline-block rounded-[3px] px-4 py-1.5 font-display text-sm font-extrabold tracking-[.24em]">{t.t('ui.brand')}</div>
        <h1 className="m-0 font-display text-3xl font-extrabold leading-tight">{t.t('ui.small.title')}</h1>
        <p className="mt-3 font-hand text-xl font-semibold italic leading-snug" style={{ color: '#5a2a14' }}>
          {t.t('ui.small.body')}
        </p>
      </div>
    </main>
  );
}
