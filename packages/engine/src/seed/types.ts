import type {
  Company,
  CompanySource,
  Customer,
  Department,
  EventCard,
  Material,
  Order,
  Payable,
  PeriodClose,
  Plant,
  ProductFamily,
  ProductionLine,
  PurchaseOrder,
  Receivable,
  RecurringCost,
  Settings,
  Supplier,
  WorkforceRow,
  WorkspaceId,
} from '../model/types';
import type { Money } from '../model/units';

/**
 * The company record as a seed carries it. `source` defaults to `'seed'` and `snapshotDate` to null
 * (the committed NOVARA files predate them); `day1Weekday` is always derived from `snapshotDate`.
 */
export type SeedCompany = Omit<Company, 'source' | 'snapshotDate' | 'day1Weekday'> & {
  source?: CompanySource;
  snapshotDate?: string | null;
};

/** A seed sales order; `listUnitPrice` defaults to `unitPrice` when the opening state is built. */
export type SeedOrder = Omit<Order, 'listUnitPrice'> & { listUnitPrice?: Money };

/** One JSON file per key in data/seed/. */
export interface SeedBundle {
  company: { company: SeedCompany; settings: Settings };
  departments: Department[];
  plants: { plants: Plant[]; lines: ProductionLine[] };
  productFamilies: ProductFamily[];
  materials: Material[];
  suppliers: Supplier[];
  customers: Customer[];
  orders: { salesOrders: SeedOrder[]; purchaseOrders: PurchaseOrder[] };
  workforce: WorkforceRow[];
  finance: {
    workspaceId: WorkspaceId;
    cash: Money;
    receivables: Receivable[];
    payables: Payable[];
    recurringCosts: RecurringCost[];
    history: PeriodClose[];
  };
  eventCards: EventCard[];
}

export const SEED_FILES = [
  'company',
  'departments',
  'plants',
  'productFamilies',
  'materials',
  'suppliers',
  'customers',
  'orders',
  'workforce',
  'finance',
  'eventCards',
] as const satisfies readonly (keyof SeedBundle)[];

/** Swappable data source (ADR-0006). The engine never does I/O itself. */
export interface CompanyDataSource {
  load(workspaceId: WorkspaceId): Promise<SeedBundle>;
}
