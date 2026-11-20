/**
 * Validation rules, one family per block, on hand-broken copies of the small real-company workbook.
 * Every finding is checked for its code and its cell (sheet, Excel row, column key + letter).
 */
import { describe, expect, it } from 'vitest';
import { REAL_SNAPSHOT, clone, realCompany, setCell } from '../test/fixtures';
import { type ImportIssue, type ImportReport, type Workbook, GENERIC_PROFILE, ISSUE_CODES, MAX_ROWS_PER_SHEET, analyseWorkbook, cellRef, sanitiseWorkbook, toSeedBundle, validateWorkbook } from './index';

const base = realCompany();
const fresh = (): Workbook => clone(base);
const issues = (r: ImportReport, code: string): ImportIssue[] => r.issues.filter((i) => i.code === code);
const one = (r: ImportReport, code: string): ImportIssue => {
  const hits = issues(r, code);
  expect(hits, `${code} in ${JSON.stringify(r.issues.map((i) => i.code))}`).toHaveLength(1);
  return hits[0]!;
};
const where = (i: ImportIssue): [string | null, number | null, string | null, string | null] => [i.sheet, i.row, i.column, i.columnLetter];
const removeColumn = (wb: Workbook, sheet: string, key: string): Workbook => {
  const idx = wb[sheet]![0]!.indexOf(key);
  for (const row of wb[sheet]!) row.splice(idx, 1);
  return wb;
};

describe('the clean fixture', () => {
  const r = validateWorkbook(base);
  it('has no errors, one overdue warning and the defaults as info', () => {
    expect(r.summary).toMatchObject({ errors: 0, warnings: 1 });
    expect(where(one(r, 'import.date.overdue'))).toEqual(['Receivables', 5, 'due_date', 'E']);
    expect(r.snapshotDate).toBe(REAL_SNAPSHOT);
    expect(r.summary.info).toBe(r.issues.filter((i) => i.severity === 'info').length);
  });

  it('reports in the design JSON shape', () => {
    expect(Object.keys(r).sort()).toEqual(['issues', 'snapshotDate', 'summary', 'templateVersion']);
    expect(Object.keys(r.summary).sort()).toEqual(['errors', 'info', 'rows', 'warnings']);
    for (const i of r.issues) {
      expect(['error', 'warning', 'info']).toContain(i.severity);
      expect(Object.keys(ISSUE_CODES)).toContain(i.code);
    }
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('marks estimated defaults apart from plain ones', () => {
    const est = issues(r, 'import.default.estimated').map((i) => `${i.sheet}!${i.columnLetter}${i.row}`);
    expect(est).toEqual(expect.arrayContaining(['Customers!J5', 'Customers!J6', 'Suppliers!F5', 'Workforce!D5']));
    expect(issues(r, 'import.default.estimated').find((i) => i.row === 5 && i.column === 'satisfaction_score')?.params).toEqual({ default: 75 });
    expect(where(issues(r, 'import.default.derived').find((i) => i.column === 'promised_date')!)).toEqual(['OpenOrders', 4, 'promised_date', 'J']);
  });
});

describe('level 1: structure', () => {
  it('rejects a workbook without README or with another template version', () => {
    const wb = fresh();
    delete wb.README;
    expect(where(one(validateWorkbook(wb), 'import.structure.notTemplate'))).toEqual(['README', null, null, null]);
    const v2 = fresh();
    v2.README![0]![1] = 2;
    const i = one(validateWorkbook(v2), 'import.structure.version');
    expect([i.sheet, i.row, i.columnLetter, i.params]).toEqual(['README', 1, 'B', { expected: 1, found: '2' }]);
  });

  it('rejects a missing required sheet; an optional one is noted', () => {
    const wb = fresh();
    delete wb.Customers;
    delete wb.History;
    const r = validateWorkbook(wb);
    expect(where(one(r, 'import.structure.missingSheet'))).toEqual(['Customers', null, null, null]);
    expect(one(r, 'import.default.sheetAbsent').sheet).toBe('History');
    expect(r.summary.rows.History).toBeUndefined();
  });

  it('rejects a missing required column, warns on an unknown one, rejects a duplicate', () => {
    const wb = removeColumn(fresh(), 'OpenOrders', 'qty');
    wb.OpenOrders![0]!.push('notes');
    wb.Customers![0]!.push('customer_id');
    const r = validateWorkbook(wb);
    expect(where(one(r, 'import.structure.missingColumn'))).toEqual(['OpenOrders', 1, 'qty', null]);
    expect(where(one(r, 'import.structure.unknownColumn'))).toEqual(['OpenOrders', 1, 'notes', 'P']);
    expect(where(one(r, 'import.structure.duplicateColumn'))).toEqual(['Customers', 1, 'customer_id', 'L']);
  });

  it('an absent optional column applies its default once for the whole column', () => {
    const r = validateWorkbook(removeColumn(fresh(), 'Customers', 'satisfaction_score'));
    expect(r.summary.errors).toBe(0);
    const i = one(r, 'import.default.columnAbsent');
    expect([i.sheet, i.column, i.params]).toEqual(['Customers', 'satisfaction_score', { default: 75 }]);
  });

  it('enforces row counts: too many rows, too few, one Settings row', () => {
    const big = fresh();
    for (let k = 0; k <= MAX_ROWS_PER_SHEET; k++) big.BOM!.push(['VLV-10', 'SAC', 1]);
    expect(one(validateWorkbook(big), 'import.structure.tooManyRows').params).toEqual({ max: MAX_ROWS_PER_SHEET, rows: MAX_ROWS_PER_SHEET + 5 });
    const empty = fresh();
    empty.Products = empty.Products!.slice(0, 3);
    expect(where(one(validateWorkbook(empty), 'import.structure.tooFewRows'))).toEqual(['Products', 4, null, null]);
    const two = fresh();
    two.Settings!.push([...two.Settings![3]!]);
    expect(where(one(validateWorkbook(two), 'import.structure.singleRow'))).toEqual(['Settings', 5, null, null]);
  });

  it('warns on a sheet that is not in the template', () => {
    const wb = fresh();
    wb.Notes = [['anything']];
    expect(one(validateWorkbook(wb), 'import.structure.unknownSheet').sheet).toBe('Notes');
  });
});

describe('level 2: fields', () => {
  const cases: [string, (wb: Workbook) => Workbook, string, [string, number, string, string]][] = [
    ['bad number', (wb) => setCell(wb, 'OpenOrders', 4, 'qty', 'abc'), 'import.field.notNumber', ['OpenOrders', 4, 'qty', 'E']],
    ['badly grouped thousands', (wb) => setCell(wb, 'Customers', 4, 'annual_revenue', '24.00.000'), 'import.field.notNumber', ['Customers', 4, 'annual_revenue', 'I']],
    ['decimal where an integer is required', (wb) => setCell(wb, 'BOM', 4, 'qty_per_unit', 2.5), 'import.field.notInteger', ['BOM', 4, 'qty_per_unit', 'C']],
    ['negative money', (wb) => setCell(wb, 'Products', 5, 'unit_price', -5), 'import.field.negative', ['Products', 5, 'unit_price', 'C']],
    ['impossible date', (wb) => setCell(wb, 'Receivables', 4, 'due_date', '2027-02-30'), 'import.field.notDate', ['Receivables', 4, 'due_date', 'E']],
    ['date in words', (wb) => setCell(wb, 'OpenOrders', 5, 'requested_date', 'next March'), 'import.field.notDate', ['OpenOrders', 5, 'requested_date', 'I']],
    ['duplicate id', (wb) => setCell(wb, 'Customers', 6, 'customer_id', 'C-001'), 'import.field.duplicate', ['Customers', 6, 'customer_id', 'A']],
    ['duplicate department', (wb) => setCell(wb, 'Workforce', 6, 'department', 'Operations'), 'import.field.duplicate', ['Workforce', 6, 'department', 'A']],
    ['unknown enum value', (wb) => setCell(wb, 'Materials', 4, 'unit', 'litre'), 'import.field.enum', ['Materials', 4, 'unit', 'C']],
    ['percent above 100', (wb) => setCell(wb, 'Suppliers', 4, 'on_time_delivery_pct', 120), 'import.field.outOfRange', ['Suppliers', 4, 'on_time_delivery_pct', 'F']],
    ['shifts out of range', (wb) => setCell(wb, 'Capacity', 4, 'shifts_per_day', 4), 'import.field.outOfRange', ['Capacity', 4, 'shifts_per_day', 'D']],
    ['not a boolean', (wb) => setCell(wb, 'Customers', 5, 'key_account', 'maybe'), 'import.field.notBoolean', ['Customers', 5, 'key_account', 'E']],
    ['not a country code', (wb) => setCell(wb, 'Customers', 6, 'country', 'Germany'), 'import.field.notCountry', ['Customers', 6, 'country', 'C']],
    ['required value blank', (wb) => setCell(wb, 'Products', 4, 'minutes_per_unit', null), 'import.field.required', ['Products', 4, 'minutes_per_unit', 'D']],
    ['text too long', (wb) => setCell(wb, 'Customers', 4, 'name', 'x'.repeat(121)), 'import.field.tooLong', ['Customers', 4, 'name', 'B']],
    ['one dot before three digits: thousands or decimals?', (wb) => setCell(wb, 'Customers', 4, 'annual_revenue', '1.250'), 'import.field.ambiguousSeparator', ['Customers', 4, 'annual_revenue', 'I']],
    ['one comma before three digits in a quantity', (wb) => setCell(wb, 'OpenOrders', 4, 'qty', '12,500'), 'import.field.ambiguousSeparator', ['OpenOrders', 4, 'qty', 'E']],
  ];
  for (const [name, mutate, code, cell] of cases) {
    it(name, () => {
      const r = validateWorkbook(mutate(fresh()));
      const i = one(r, code);
      expect(where(i)).toEqual(cell);
      expect(i.severity).toBe('error');
      // free text that is too long is not echoed (it may be a pasted note)
      if (code === 'import.field.tooLong') expect('value' in i).toBe(false);
      else if (code !== 'import.field.required') expect(i.value).toBeDefined();
    });
  }

  it('reads unambiguous text numbers: 1,25 and 1250,5 as decimals, 41.200.000,00 and 1,250.50 grouped', () => {
    const wb = setCell(fresh(), 'Customers', 4, 'annual_revenue', '41.200.000,00');
    setCell(wb, 'Customers', 5, 'annual_revenue', '1,250.50');
    setCell(wb, 'Products', 4, 'unit_price', '1250,5');
    setCell(wb, 'Customers', 4, 'discount_pct', '1,25');
    const a = analyseWorkbook(wb);
    expect(a.report.summary.errors).toBe(0);
    expect(a.sheets.Customers.rows[0]!.values.annual_revenue).toBe(4_120_000_000);
    expect(a.sheets.Customers.rows[1]!.values.annual_revenue).toBe(125_050);
    expect(a.sheets.Products.rows[0]!.values.unit_price).toBe(125_050);
    expect(a.sheets.Customers.rows[0]!.values.discount_pct).toBe(125);
  });

  it('range errors carry the bounds in template units', () => {
    expect(one(validateWorkbook(setCell(fresh(), 'Suppliers', 4, 'on_time_delivery_pct', 120)), 'import.field.outOfRange').params).toEqual({ min: 0, max: 100 });
  });

  it('warns when every value of a percent column is a fraction (Excel percentages read as 0.95)', () => {
    const wb = setCell(fresh(), 'Suppliers', 4, 'on_time_delivery_pct', 0.96);
    setCell(wb, 'Suppliers', 5, 'on_time_delivery_pct', 0.9);
    const r = validateWorkbook(wb);
    const i = one(r, 'import.field.percentLooksFractional');
    expect([i.severity, ...where(i)]).toEqual(['warning', 'Suppliers', null, 'on_time_delivery_pct', 'F']);
    // one real percentage in the column: no warning; zeros do not count either way
    setCell(wb, 'Suppliers', 5, 'on_time_delivery_pct', 90);
    expect(issues(validateWorkbook(wb), 'import.field.percentLooksFractional')).toEqual([]);
    expect(issues(validateWorkbook(base), 'import.field.percentLooksFractional')).toEqual([]);
  });

  it('rounds money beyond 2 decimals half to even and notes it', () => {
    const r = validateWorkbook(setCell(fresh(), 'Products', 4, 'unit_price', 1250.505));
    expect(where(one(r, 'import.field.rounded'))).toEqual(['Products', 4, 'unit_price', 'C']);
    expect(r.summary.errors).toBe(0);
  });

  it('accepts Excel serial dates, DD.MM.YYYY, Turkish booleans, grouped digits and lower-case codes', () => {
    expect(validateWorkbook(base).summary.errors).toBe(0); // the fixture uses all of them
  });
});

describe('Turkish thousands format', () => {
  it('reads "24.000.000" as 24 million TL with no issue on the cell; "24.000" stays ambiguous', () => {
    const wb = clone(base);
    setCell(wb, 'Customers', 4, 'annual_revenue', '24.000.000');
    const r = validateWorkbook(wb);
    expect(r.summary.errors).toBe(0);
    expect(r.issues.filter((i) => i.sheet === 'Customers' && i.row === 4 && i.column === 'annual_revenue')).toEqual([]);
    const built = toSeedBundle(wb, { workspaceId: 'ws_test', profile: GENERIC_PROFILE });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.bundle.customers[0]!.annualRevenue).toBe(2_400_000_000);

    const amb = clone(base);
    setCell(amb, 'Customers', 4, 'annual_revenue', '24.000');
    expect(validateWorkbook(amb).issues.map((i) => i.code)).toContain('import.field.ambiguousSeparator');
  });
});

describe('level 2: privacy guard', () => {
  const TCKN = '12345678950';
  const IBAN = 'TR33 0006 1005 1978 6457 8413 26';
  const cases: [string, (wb: Workbook) => Workbook, string, [string, number, string | null, string | null]][] = [
    ['TCKN in a name', (wb) => setCell(wb, 'Customers', 4, 'name', `Ali Veli ${TCKN}`), 'import.privacy.tckn', ['Customers', 4, 'name', 'B']],
    ['TCKN as a number in an id column', (wb) => setCell(wb, 'Customers', 5, 'customer_id', Number(TCKN)), 'import.privacy.tckn', ['Customers', 5, 'customer_id', 'A']],
    ['IBAN in a cash account', (wb) => setCell(wb, 'Cash', 4, 'account', `Banka A ${IBAN}`), 'import.privacy.iban', ['Cash', 4, 'account', 'A']],
    ['e-mail in a supplier name', (wb) => setCell(wb, 'Suppliers', 5, 'name', 'satis@egeconta.com.tr'), 'import.privacy.email', ['Suppliers', 5, 'name', 'B']],
    ['mobile phone in a plant name', (wb) => setCell(wb, 'Plants', 4, 'name', 'Konya OSB 0532 123 45 67'), 'import.privacy.phone', ['Plants', 4, 'name', 'B']],
    ['international phone in a line type', (wb) => setCell(wb, 'Capacity', 5, 'line_type', '+49 89 1234 5678'), 'import.privacy.phone', ['Capacity', 5, 'line_type', 'C']],
    ['e-mail on a sheet outside the template', (wb) => ({ ...wb, Notes: [['call', 'ayse@example.com']] }), 'import.privacy.email', ['Notes', 1, null, 'B']],
    ['person column in Workforce', (wb) => (wb.Workforce![0]!.push('employee_name'), wb), 'import.privacy.personColumn', ['Workforce', 1, 'employee_name', 'E']],
    ['any extra column in Workforce', (wb) => (wb.Workforce![0]!.push('notes'), wb), 'import.privacy.personColumn', ['Workforce', 1, 'notes', 'E']],
    ['phone column elsewhere', (wb) => (wb.Customers![0]!.push('Telefon'), wb), 'import.privacy.personColumn', ['Customers', 1, 'telefon', 'L']],
  ];
  for (const [name, mutate, code, cell] of cases) {
    it(name, () => {
      const i = one(validateWorkbook(mutate(fresh())), code);
      expect(where(i)).toEqual(cell);
      expect(i.severity).toBe('error');
      expect('value' in i).toBe(false); // personal data is never echoed into the report
    });
  }

  it('a sheet outside the template with personal headers (Personel: Ad Soyad, Maaş) is an error, not a warning', () => {
    const wb = fresh();
    wb.Personel = [['Ad Soyad', 'Maaş'], ['Ayşe Kaya', 85000]];
    const i = one(validateWorkbook(wb), 'import.privacy.personSheet');
    expect([i.severity, ...where(i)]).toEqual(['error', 'Personel', 1, 'ad_soyad', 'A']);
    expect(issues(validateWorkbook(wb), 'import.structure.unknownSheet')).toEqual([]);
    const named = fresh();
    named.Personel = [['tutar'], [85000]];
    expect(where(one(validateWorkbook(named), 'import.privacy.personSheet'))).toEqual(['Personel', null, null, null]);
    const notes = fresh();
    notes.Notlar = [['konu', 'tarih'], ['stok sayımı', '2027-01-10']];
    expect(validateWorkbook(notes).summary.errors).toBe(0);
  });

  it('a contact-person column on Customers is an error (company names stay allowed)', () => {
    const wb = fresh();
    wb.Customers![0]!.push('contact_person');
    expect(where(one(validateWorkbook(wb), 'import.privacy.personColumn'))).toEqual(['Customers', 1, 'contact_person', 'L']);
    expect(validateWorkbook(fresh()).issues.filter((x) => x.code.startsWith('import.privacy.'))).toEqual([]);
  });

  it('no finding echoes a cell where personal data was found', () => {
    const wb = setCell(fresh(), 'OpenOrders', 5, 'customer_id', 'ayse.kaya@example.com');
    const r = validateWorkbook(wb);
    const fk = one(r, 'import.fk.missing');
    expect(where(fk)).toEqual(['OpenOrders', 5, 'customer_id', 'B']);
    expect('value' in fk).toBe(false);
    expect(JSON.stringify(r)).not.toContain('ayse.kaya');
  });

  it('does not flag figures, dates or codes', () => {
    const wb = setCell(fresh(), 'Customers', 4, 'annual_revenue', Number(TCKN)); // a large amount, not an ID
    setCell(wb, 'Customers', 5, 'customer_id', 'C-2027-0131');
    setCell(wb, 'Products', 4, 'unit_price', '5 321 234 567');
    const r = validateWorkbook(wb);
    expect(r.issues.filter((i) => i.code.startsWith('import.privacy.'))).toEqual([]);
  });
});

describe('level 3: cross-sheet and business rules', () => {
  it('foreign keys resolve (order → customer, plant list → product, PO → sales order)', () => {
    const wb = setCell(fresh(), 'OpenOrders', 5, 'customer_id', 'C-099');
    setCell(wb, 'Plants', 4, 'product_ids', 'VLV-10, PMP-20, XX-1');
    setCell(wb, 'OpenPurchaseOrders', 4, 'for_order_id', 'SO-9');
    const r = validateWorkbook(wb);
    const fk = issues(r, 'import.fk.missing');
    expect(fk.map((i) => [...where(i), i.value, i.params.target])).toEqual([
      ['Plants', 4, 'product_ids', 'E', 'XX-1', 'Products'],
      ['OpenOrders', 5, 'customer_id', 'B', 'C-099', 'Customers'],
      ['OpenPurchaseOrders', 4, 'for_order_id', 'J', 'SO-9', 'OpenOrders'],
    ]);
  });

  it('every product has a BOM; no material twice', () => {
    const wb = fresh();
    wb.BOM = wb.BOM!.filter((row, i) => i < 3 || row[0] !== 'PMP-20');
    expect(where(one(validateWorkbook(wb), 'import.bom.missing'))).toEqual(['Products', 5, 'product_id', 'A']);
    const dup = fresh();
    dup.BOM!.push(['VLV-10', 'SAC', 3]);
    expect(where(one(validateWorkbook(dup), 'import.bom.duplicate'))).toEqual(['BOM', 8, 'material_id', 'B']);
  });

  it('the preferred supplier quotes the material', () => {
    const i = one(validateWorkbook(setCell(fresh(), 'Materials', 4, 'preferred_supplier_id', 'S2')), 'import.supplierPrice.missing');
    expect([...where(i), i.params]).toEqual(['Materials', 4, 'preferred_supplier_id', 'H', { supplierId: 'S2', materialId: 'SAC' }]);
  });

  it('every product is made in a plant with lines, and orders go to a plant that makes them', () => {
    const wb = setCell(fresh(), 'Plants', 4, 'product_ids', 'VLV-10');
    const r = validateWorkbook(wb);
    expect(where(one(r, 'import.product.noPlant'))).toEqual(['Products', 5, 'product_id', 'A']);
    expect(issues(r, 'import.order.plantProduct').map((i) => [i.row, i.params])).toEqual([
      [5, { plantId: 'P1', productId: 'PMP-20' }],
      [6, { plantId: 'P1', productId: 'PMP-20' }],
    ]);
    const noLine = fresh();
    noLine.Capacity = noLine.Capacity!.slice(0, 3);
    expect(where(one(validateWorkbook(noLine), 'import.structure.tooFewRows'))).toEqual(['Capacity', 4, null, null]);
    const plant2 = fresh();
    plant2.Plants!.push(['P2', 'Ereğli', null, 10, 'VLV-10']);
    expect(where(one(validateWorkbook(plant2), 'import.plant.noLine'))).toEqual(['Plants', 5, 'plant_id', 'A']);
  });

  it('capacity: a day has 24 hours; a down line returns after the snapshot', () => {
    const wb = setCell(fresh(), 'Capacity', 4, 'shifts_per_day', 3);
    setCell(wb, 'Capacity', 4, 'hours_per_shift', 9);
    setCell(wb, 'Capacity', 5, 'status', 'down');
    setCell(wb, 'Capacity', 5, 'repair_due_date', '2027-01-15');
    const r = validateWorkbook(wb);
    expect([...where(one(r, 'import.capacity.tooManyHours')), one(r, 'import.capacity.tooManyHours').params]).toEqual(['Capacity', 4, 'hours_per_shift', 'E', { hours: 27 }]);
    expect(where(one(r, 'import.capacity.repairPast'))).toEqual(['Capacity', 5, 'repair_due_date', 'G']);
  });

  it('dates against the snapshot: no orders from the future; overdue items warned', () => {
    const wb = setCell(fresh(), 'OpenOrders', 4, 'order_date', '2027-02-02');
    setCell(wb, 'OpenOrders', 5, 'requested_date', '2027-01-20');
    setCell(wb, 'Payables', 4, 'due_date', '2027-01-30');
    setCell(wb, 'History', 4, 'period_end', '2027-02-28');
    const r = validateWorkbook(wb);
    expect(issues(r, 'import.date.afterSnapshot').map(where)).toEqual([
      ['OpenOrders', 4, 'order_date', 'H'],
      ['History', 4, 'period_end', 'A'],
    ]);
    expect(where(one(r, 'import.order.overdue'))).toEqual(['OpenOrders', 5, 'requested_date', 'I']);
    expect(issues(r, 'import.date.overdue').map(where)).toContainEqual(['Payables', 4, 'due_date', 'D']);
  });

  it('progress, demand range, payroll', () => {
    const wb = setCell(fresh(), 'OpenOrders', 4, 'units_done', 401);
    setCell(wb, 'Demand', 4, 'qty_max', 200);
    setCell(wb, 'FixedCosts', 4, 'amount', 1000);
    const r = validateWorkbook(wb);
    expect(where(one(r, 'import.order.progress'))).toEqual(['OpenOrders', 4, 'units_done', 'M']);
    expect(where(one(r, 'import.demand.qtyRange'))).toEqual(['Demand', 4, 'qty_max', 'D']);
    expect(one(r, 'import.fixedCost.payrollAmountIgnored').severity).toBe('info');
    const none = fresh();
    none.FixedCosts = none.FixedCosts!.filter((row) => row[1] !== 'payroll');
    expect(one(validateWorkbook(none), 'import.fixedCost.noPayroll').severity).toBe('warning');
  });

  it('plausibility warnings: stock value, overdraft, receivables, capacity load', () => {
    const wb = setCell(fresh(), 'Materials', 4, 'stock_value', 2000000);
    setCell(wb, 'Cash', 4, 'balance', -2000000);
    setCell(wb, 'Customers', 4, 'annual_revenue', 100000);
    setCell(wb, 'Customers', 6, 'annual_revenue', 0);
    setCell(wb, 'OpenOrders', 5, 'qty', 2000);
    const r = validateWorkbook(wb);
    expect(r.summary.errors).toBe(0);
    const stock = one(r, 'import.stockValue.implausible');
    expect([...where(stock), stock.params]).toEqual(['Materials', 4, 'stock_value', 'E', { expected: 76000000, deviationPct: 163 }]);
    expect(one(r, 'import.cash.negative').params).toEqual({ total: -198500000 });
    expect(one(r, 'import.receivables.high').params).toEqual({ receivables: 75000000, annualRevenue: 10000000 });
    const cap = one(r, 'import.capacity.overloaded');
    expect([...where(cap), cap.params.plantId, cap.params.days]).toEqual(['Plants', 4, 'plant_id', 'A', 'P1', 90]);
    expect(cap.params.loadPct).toBeGreaterThan(150);
  });

  it('the snapshot date can be given as an option (noted when it differs from Settings)', () => {
    const r = validateWorkbook(base, { snapshotDate: '2027-02-01' });
    expect(r.snapshotDate).toBe('2027-02-01');
    const i = one(r, 'import.settings.snapshotOverride');
    expect([...where(i), i.params]).toEqual(['Settings', 4, 'snapshot_date', 'B', { sheet: REAL_SNAPSHOT, option: '2027-02-01' }]);
    expect(() => validateWorkbook(base, { snapshotDate: '1.2.2027' })).toThrow(RangeError);
  });

  it('cell references read as in Excel', () => {
    expect(cellRef({ sheet: 'OpenOrders', row: 7, columnLetter: 'C' })).toBe('OpenOrders!C7');
    expect(cellRef({ sheet: 'Customers', row: null, columnLetter: null })).toBe('Customers');
  });
});

describe('the workbook kept after an import', () => {
  it('holds the template sheets and known columns only, rows and letters unchanged', () => {
    const wb = fresh();
    wb.Notlar = [['konu'], ['stok sayımı']];
    wb.Customers![0]!.push('remarks');
    wb.Customers![3]!.push('call before noon');
    wb.Customers![1]![0] = 'my label note';
    wb.README!.push(['free text in the README']);
    const kept = sanitiseWorkbook(wb);
    expect(Object.keys(kept).sort()).toEqual(Object.keys(base).sort());
    expect(kept.Customers![0]).toEqual(base.Customers![0]);
    expect(kept.Customers![1]).toEqual([]);
    expect(JSON.stringify(kept)).not.toMatch(/stok sayımı|remarks|call before noon|my label note|free text/);
    expect(kept.README).toEqual([base.README![0]!.slice(0, 2)]);
    // validating what is kept gives the same data and the same errors, minus the dropped extras
    const a = analyseWorkbook(wb);
    const b = analyseWorkbook(kept);
    expect(b.report.summary.errors).toBe(0);
    expect(b.report.summary.warnings).toBe(a.report.summary.warnings - 2); // unknown sheet, unknown column
    for (const name of Object.keys(b.sheets) as (keyof typeof b.sheets)[]) expect(b.sheets[name].rows).toEqual(a.sheets[name].rows);
    const fk = setCell(clone(kept), 'OpenOrders', 5, 'customer_id', 'C-099');
    expect(where(one(validateWorkbook(fk), 'import.fk.missing'))).toEqual(['OpenOrders', 5, 'customer_id', 'B']);
  });
});
