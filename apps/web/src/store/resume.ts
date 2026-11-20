/** Which company to open on start: the one that was on the desk, if it is still stored. */
import type { SeedBundle } from '@ceo-room/engine';
import type { CompanyId } from '../archive/protocol';
import type { CompanyDb, MyCompanyMeta } from './companyDb';
import { loadActiveCompany, storeActiveCompany } from './storage';

export interface Resumed {
  company: CompanyId;
  /** My company's imported bundle (null for the sample) */
  bundle: SeedBundle | null;
  /** My company as stored (also when the sample is on the desk), or null */
  meta: MyCompanyMeta | null;
  /** My company was on the desk but is no longer stored: the sample is opened instead */
  lost: boolean;
}

export async function resumeCompany(db: CompanyDb): Promise<Resumed> {
  const active = loadActiveCompany();
  const meta = await db.loadMeta().catch(() => null);
  if (active === 'sample') return { company: 'sample', bundle: null, meta, lost: false };
  const data = meta ? await db.loadData().catch(() => null) : null;
  if (data) return { company: 'mine', bundle: data.bundle, meta, lost: false };
  storeActiveCompany('sample');
  return { company: 'sample', bundle: null, meta: null, lost: true };
}
