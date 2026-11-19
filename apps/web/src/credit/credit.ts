/** Who made THE CEO ROOM, and where to find her: the one place these live. */
export const CREDIT = {
  name: 'Sevim Durmuş',
  links: [
    { id: 'instagram', labelKey: 'ui.credit.instagram', href: 'https://www.instagram.com/sevimsoffice/' },
    { id: 'linkedin', labelKey: 'ui.credit.linkedin', href: 'https://www.linkedin.com/in/sevimdurmus/' },
  ],
} as const;

/** Height of the credit strip under the scene, in screen pixels (its links are 44 px tall). */
export const CREDIT_H = 48;
/** Height of the credit's links in screen pixels (≥ 44 px touch targets at every scale). */
export const CREDIT_LINK_H = 44;
