import { Fragment } from 'react';
import { useT } from '../i18n';
import { CREDIT, CREDIT_H, CREDIT_LINK_H } from './credit';

/**
 * The maker's credit: a small engraved brass plate under the scene (outside it, so it never covers
 * the Desk or the Decision Room), in screen pixels: 13 px type, links 44 px tall.
 */
export function Credit({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <footer className={`flex items-center justify-center ${className}`} style={{ height: CREDIT_H }} data-testid="credit">
      <nav
        aria-label={t.t('ui.credit.label')}
        className="flex items-center rounded-[3px] px-3 font-type text-[13px] tracking-[.06em]"
        style={{ background: 'linear-gradient(180deg,#2a1710,#1c0f09)', border: '1px solid #7a5c20', color: '#e9dcc0', boxShadow: 'inset 0 1px 0 rgba(224,189,106,.25)' }}
      >
        <span className="font-display text-[14px] font-bold tracking-[.12em] text-brass-text" style={{ fontVariant: 'small-caps' }} data-testid="credit-name">
          {CREDIT.name}
        </span>
        {CREDIT.links.map((l) => (
          <Fragment key={l.id}>
            <span aria-hidden="true" className="px-1.5 text-brass-text">
              ·
            </span>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.t('ui.credit.link.aria', { name: CREDIT.name, site: t.t(l.labelKey) })}
              className="flex min-w-[44px] items-center justify-center px-1.5 text-[#efe3c4] underline decoration-dotted underline-offset-4 hover:text-brass-bright focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass-bright"
              style={{ height: CREDIT_LINK_H }}
              data-testid={`credit-${l.id}`}
            >
              {t.t(l.labelKey)}
            </a>
          </Fragment>
        ))}
      </nav>
    </footer>
  );
}
