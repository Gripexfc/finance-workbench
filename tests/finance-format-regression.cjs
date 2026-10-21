const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const sourcePath = process.argv[2] || require('node:path').join(__dirname, '..', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const xlsxUtils = require(require('node:path').join(require('node:path').dirname(sourcePath), 'vendor/xlsx.full.min.js')).utils;
const marker = '\n  document.addEventListener("click",';
assert.ok(source.includes(marker), 'Initialization strip marker must exist');
const instrumented = source.slice(0, source.indexOf(marker)) + `
  globalThis.__finance = {
    evaluate: (expression) => eval(expression),
    getState: () => state,
    setState: (next) => { state = next; },
    setReportMonth: (value) => { if (typeof reportMonth !== 'undefined') reportMonth = value; }
  };
})();`;

function boot(saved) {
  const storage = new Map(saved ? [['finance-workbench-mvp-v1', JSON.stringify(saved)]] : []);
  const exports = [];
  const element = () => ({ textContent: '', innerHTML: '', classList: { add() {}, remove() {} }, addEventListener() {}, click() {}, remove() {}, hidden: false });
  const context = {
    Date, Math, Number, String, Object, Array, Map, Set, JSON, RegExp,
    TextEncoder, TextDecoder, Uint8Array, atob, btoa,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    location: { hash: '' },
    document: { querySelector: element, querySelectorAll: () => [], createElement: element, body: { appendChild() {}, classList: { add() {}, remove() {} } } },
    window: { XLSX: { utils: { ...xlsxUtils, aoa_to_sheet: rows => { const sheet = xlsxUtils.aoa_to_sheet(rows); sheet.__rows = rows; return sheet; } }, writeFile: (book, name) => exports.push({ book, name }) } },
    Blob, URL, setTimeout: () => 0, clearTimeout() {},
  };
  vm.runInNewContext(instrumented, context, { filename: sourcePath });
  return { api: context.__finance, storage, exports };
}

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', message: error.message }); }
}
function near(actual, expected, message) { assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-7, `${message}: actual=${actual}, expected=${expected}`); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function text(html) { return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim(); }
function htmlRows(html) { return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(match => [...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(cell => text(cell[1]))); }
function parsedMoney(value) { return Number(String(value).replace(/[￥¥,+\s]/g, '')); }
function rowBy(report, label) { const row = report.rows.find(row => row.label === label); assert.ok(row, `Missing profit row: ${label}`); return row; }
function fixture() {
  const initial = plain(boot().api.getState());
  for (const key of ['bank', 'statements', 'sales', 'purchases', 'payments', 'payroll', 'expenses', 'fixedAssets', 'invoiceRecords', 'taxItems', 'periodClosings', 'assetDepreciationRuns', 'productCosts']) initial[key] = [];
  initial.taxConfig = { period: '2026-10', vatRate: 0.13, corporateRate: 0.25 };
  initial.payrollConfig = { personalSocialRate: 0, employerSocialRate: 0.1, personalFundRate: 0, employerFundRate: 0.05 };
  initial.sales = [
    { no: 'main', date: '2026-10-01', total: 1000, paid: 0 },
    { no: 'other', date: '2026-10-02', total: 200, paid: 0, incomeType: '其他业务收入' },
    { no: 'outside', date: '2026-09-02', total: 9999, paid: 0 }
  ];
  initial.expenses = [
    { no: 'operating', expenseDate: '2026-10-01', amount: 100, category: '营业成本' },
    { no: 'selling', expenseDate: '2026-10-02', amount: 20, category: '销售费用' },
    { no: 'admin', expenseDate: '2026-10-03', amount: 9, category: '管理费用' },
    { no: 'unknown', submitDate: '2026-10-04', amount: 11, category: '差旅交通' },
    { no: 'outside', expenseDate: '2026-09-02', amount: 777, category: '营业成本' }
  ];
  initial.payroll = [{ month: '2026-10', gross: 120, socialBase: 100, fundBase: 100, tax: 0 }];
  initial.assetDepreciationRuns = [{ period: '2026-10', total: 30 }];
  return initial;
}

const app = boot();
const api = app.api;
const evaluate = expression => api.evaluate(expression);
let report;
test('profit rows follow reference format and keep original net income', () => {
  api.setState(fixture()); api.setReportMonth('2026-10'); report = evaluate('reportData().incomeStatement');
  assert.deepEqual(plain(report.rows.filter(row => row.group).map(row => row.group)), ['一、营业收入', '二、营业成本及期间费用']);
  near(rowBy(report, '主营业务收入').value, 1000, 'main revenue');
  near(rowBy(report, '其他业务收入').value, 200, 'other revenue');
  near(rowBy(report, '营业收入合计').value, 1200, 'revenue total');
  const independentNet = 1200 - 140 - 135 - 30 - ((1200 - 140 - 135) * 0.25);
  near(rowBy(report, '三、净利润').value, independentNet, 'original net income formula preserved');
});
test('operating, selling, administrative expenses count each source once', () => {
  api.setState(fixture()); report = evaluate('reportData().incomeStatement');
  near(rowBy(report, '减：营业成本').value, 100, 'operating costs');
  near(rowBy(report, '销售费用').value, 20, 'selling expenses');
  near(rowBy(report, '管理费用及财务费用').value, 185, 'administrative incl payroll and depreciation');
  const deductions = report.rows.filter(row => row.label && !['主营业务收入', '其他业务收入', '营业收入合计', '三、净利润'].includes(row.label));
  near(deductions.reduce((sum, row) => sum + row.value, 0), 536.25, 'deductions counted once');
  near(rowBy(report, '营业收入合计').value - deductions.reduce((sum, row) => sum + row.value, 0), rowBy(report, '三、净利润').value, 'statement reconciles');
});
test('UI and Excel share the reference columns, labels, amounts and percentages', () => {
  api.setState(fixture()); report = evaluate('reportData().incomeStatement');
  const ui = htmlRows(evaluate('reportStatementTable(reportData().incomeStatement)'));
  assert.deepEqual(ui[0], ['项目', '本月数', '本月占比']);
  evaluate('exportReportExcel("incomeStatement")');
  const output = app.exports.at(-1); assert.ok(output, 'Excel export captured');
  const excel = output.book.Sheets['利润表'].__rows;
  assert.deepEqual(plain(excel[3]), ui[0]);
  assert.equal(excel.length - 4, ui.length - 1, 'UI and Excel body rows');
  const ratioBase = 1200;
  for (let index = 0; index < report.rows.length; index++) {
    const data = report.rows[index]; const cells = ui[index + 1]; const exported = excel[index + 4];
    assert.equal(cells[0], data.group || data.label, `UI label ${index}`);
    assert.equal(exported[0], cells[0], `Excel label ${index}`);
    if (data.group) { assert.ok(exported.slice(1).every(cell => cell === '' || cell == null), `group export blank ${index}`); continue; }
    near(parsedMoney(cells[1]), data.value, `UI amount ${data.label}`);
    near(Number(exported[1]), data.value, `Excel amount ${data.label}`);
    near(Number(exported[2]) * 100, data.value / ratioBase * 100, `Excel ratio ${data.label}`);
    assert.equal(output.book.Sheets['利润表'][`C${index + 5}`].z, '0.0%', `Excel percentage number format ${data.label}`);
    assert.ok(cells[2].endsWith('%'), `percentage suffix ${data.label}`);
    near(Number(cells[2].replace('%', '')), Number((data.value / ratioBase * 100).toFixed(1)), `percentage ${data.label}`);
  }
});
test('explicit expense category survives an unrelated budget-category label', () => {
  const tagged = fixture(); tagged.expenses[0].budgetCategory = '原材料费'; tagged.expenses[1].budgetCategory = '市场预算';
  api.setState(tagged); report = evaluate('reportData().incomeStatement');
  near(rowBy(report, '减：营业成本').value, 100, 'explicit operating category retained');
  near(rowBy(report, '销售费用').value, 20, 'explicit selling category retained');
});
test('zero revenue with costs remains finite and keeps the loss', () => {
  const zero = fixture(); zero.sales = [];
  api.setState(zero); report = evaluate('reportData().incomeStatement');
  near(rowBy(report, '三、净利润').value, -305, 'loss with zero revenue');
  const html = evaluate('reportStatementTable(reportData().incomeStatement)');
  assert.ok(!/NaN|Infinity|undefined/.test(html), 'UI must not contain invalid values');
  const exported = plain(evaluate('reportRowsForExport(reportData().incomeStatement)'));
  assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(exported)), 'Excel must not contain invalid values');
  for (const row of htmlRows(html).slice(1)) if (row.length > 1) assert.ok(row[2] === '—' || /^0(?:\.0+)?%$/.test(row[2]), `zero-income share safe: ${row[2]}`);
});
test('empty accounting period returns a zero net result', () => {
  api.setState(fixture()); api.setReportMonth('2030-01'); report = evaluate('reportData().incomeStatement');
  near(rowBy(report, '营业收入合计').value, 0, 'empty revenue');
  near(rowBy(report, '三、净利润').value, 0, 'empty profit');
  assert.ok(!/NaN|Infinity|undefined/.test(evaluate('reportStatementTable(reportData().incomeStatement)')));
  api.setReportMonth('2026-10');
});
test('all-report Excel keeps balance-sheet and cash-flow column formats', () => {
  api.setState(fixture()); evaluate('exportReportExcel("incomeStatement", true)');
  const output = app.exports.at(-1);
  assert.deepEqual(plain(output.book.SheetNames), ['资产负债表', '利润表', '现金流量表']);
  assert.deepEqual(plain(output.book.Sheets['资产负债表'].__rows[3]), ['项目', '期末余额', '说明', '项目', '期末余额', '说明']);
  assert.deepEqual(plain(output.book.Sheets['现金流量表'].__rows[3]), ['项目', '金额', '说明']);
});

function products() { return [
  { id: 'P1', period: '2026-10', name: 'A', quantity: 10, directMaterial: 600, directLabor: 200, manufacturingOverhead: 200, standardUnitCost: 90 },
  { id: 'P2', period: '2026-10', name: 'B', quantity: 100, directMaterial: 600, directLabor: 200, manufacturingOverhead: 200, standardUnitCost: 20 },
  { id: 'P3', period: '2026-10', name: 'C', quantity: 2, directMaterial: 100, directLabor: 30, manufacturingOverhead: 20, standardUnitCost: 0 },
  { id: 'outside', period: '2026-09', name: 'D', quantity: 1, directMaterial: 999, directLabor: 0, manufacturingOverhead: 0, standardUnitCost: 1 }
]; }
test('product costs derive totals, unit costs, variances and missing-standard status', () => {
  const state = fixture(); state.productCosts = products(); api.setState(state); api.setReportMonth('2026-10');
  const rows = plain(evaluate('productCostRows()'));
  assert.equal(rows.length, 3, 'period filtering');
  near(rows[0].total, 1000, 'A total'); near(rows[0].unitCost, 100, 'A unit cost'); near(rows[0].variance, 100 / 9, 'A variance'); assert.equal(rows[0].status, '超支');
  near(rows[1].unitCost, 10, 'B unit cost'); near(rows[1].variance, -50, 'B variance'); assert.equal(rows[1].status, '节约');
  assert.equal(rows[2].variance, null); assert.equal(rows[2].status, '未设标准');
  const html = evaluate('renderModuleCost()');
  assert.ok(html.includes('-31.0%'), 'weighted aggregate variance of standard-bearing products: (2000-2900)/2900');
  assert.ok(!/NaN|Infinity|undefined/.test(html), 'cost UI finite');
  const headers = htmlRows(html).find(row => row[0] === '产品名称');
  assert.deepEqual(headers, ['产品名称', '产量', '直接材料', '直接人工', '制造费用', '总成本', '单位成本', '标准成本', '差异率', '状态', '操作']);
});
test('old saved data migrates to empty product costs and backup includes the new domain', () => {
  const legacy = fixture(); delete legacy.productCosts;
  const migrated = boot(legacy);
  assert.deepEqual(plain(migrated.api.getState().productCosts), []);
  assert.ok(migrated.api.evaluate('BACKUP_KEYS.includes("productCosts")'));
  const backed = plain(migrated.api.evaluate('businessSnapshot()'));
  assert.deepEqual(backed.productCosts, []);
});
test('version-one saved data stays empty after persisted migration and reload', () => {
  const legacy = fixture(); delete legacy.productCosts; legacy.demoDataVersion = 1;
  const migrated = boot(legacy);
  assert.deepEqual(plain(migrated.api.getState().productCosts), [], 'initial migrated state');
  const persisted = JSON.parse(migrated.storage.get('finance-workbench-mvp-v1'));
  const reloaded = boot(persisted);
  assert.deepEqual(plain(reloaded.api.getState().productCosts), [], 'reload must not inject demo products');
});
test('product import validates positive quantities, months, finite costs and duplicate IDs', () => {
  const valid = { 产品编号: 'P0', 核算月份: '2026-10', 产品名称: '导入产品', 产量: '2', 直接材料: '¥1,000', 直接人工: '20', 制造费用: '0', 标准成本: '' };
  const validate = row => {
    evaluate(`globalThis.__row = ${JSON.stringify(row)}`);
    return plain(evaluate('validateImport("productCost", importTypes.productCost.columns, Array.isArray(globalThis.__row) ? globalThis.__row : [globalThis.__row])'));
  };
  assert.equal(validate(valid).valid, true, 'valid currency-formatted import with missing standard');
  for (const [key, value] of [['产量', 0], ['产量', -1], ['产量', 'Infinity'], ['核算月份', '2026-13'], ['直接材料', -1], ['直接人工', 'NaN']]) assert.equal(validate({ ...valid, [key]: value }).valid, false, `invalid ${key}: ${value}`);
  assert.equal(validate([valid, valid]).valid, false, 'duplicate product IDs');
});
test('product import upserts by ID and export keeps derived values and percent formats', () => {
  const state = fixture(); state.productCosts = products(); api.setState(state);
  const input = [{ 产品编号: 'P1', 核算月份: '2026-10', 产品名称: 'A更新', 产量: '20', 直接材料: '1000', 直接人工: '200', 制造费用: '0', 标准成本: '50' }];
  evaluate(`globalThis.__input = ${JSON.stringify(input)}`);
  const stats = plain(evaluate('applyImport("productCost", globalThis.__input)'));
  assert.equal(stats.updatedRows, 1); assert.equal(stats.insertedRows, 0); assert.equal(api.getState().productCosts.length, 4);
  const row = plain(evaluate('productCostRows().find(row => row.id === "P1")')); near(row.total, 1200, 'updated total'); near(row.unitCost, 60, 'updated unit'); near(row.variance, 20, 'updated variance');
  evaluate('exportProductCosts()'); const output = app.exports.at(-1); const sheet = output.book.Sheets['产品成本'];
  assert.ok(sheet, 'cost worksheet'); assert.equal(sheet.__rows.length, 4, 'header plus current period rows');
  assert.equal(sheet.__rows[1][7], 1200); assert.equal(sheet.__rows[1][8], 60); near(sheet.__rows[1][10], 0.2, 'variance ratio export'); assert.equal(sheet.K2.z, '0.0%');
});
test('cost backup validation rejects invalid or duplicate records before restore', () => {
  evaluate(`globalThis.__products = ${JSON.stringify(products())}`);
  assert.doesNotThrow(() => evaluate('validateProductCostBackup(globalThis.__products)'));
  assert.throws(() => evaluate('validateProductCostBackup([{...globalThis.__products[0],quantity:0}])'), /产量/);
  assert.throws(() => evaluate('validateProductCostBackup([globalThis.__products[0],globalThis.__products[0]])'), /重复/);
});

console.log(JSON.stringify({ sourcePath, sourceSha256: require('node:crypto').createHash('sha256').update(source).digest('hex'), results, passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length }, null, 2));
process.exitCode = results.some(result => result.status === 'FAIL') ? 1 : 0;
