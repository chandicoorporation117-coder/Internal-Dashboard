// Runs the parsing half of apps-script/Code.gs on fixture rows (no Apps Script needed).
//   node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadScript(config = {}) {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx);
  Object.assign(ctx.CONFIG, config);
  // Plain copies, so deepEqual doesn't trip over arrays from the vm realm.
  const parseWorkbook_ = ctx.parseWorkbook_;
  ctx.parseWorkbook_ = (...args) => JSON.parse(JSON.stringify(parseWorkbook_(...args)));
  return ctx;
}

// Header text as it appears in the weekly report (order shuffled a little on purpose in the long fixture).
const HEADERS = [
  "Murder 302 PPC (Incl. All Types)", "Dacoity (395 PPC)", "Dacoity with Hurt", "Dacoity with Murder (396 PPC)",
  "Dacoity with Rape", "Robbery (392 PPC)", "Robbery with Hurt", "Robbery with Murder", "Robbery with Rape",
  "Snatching (356/379 PPC)", "Child Sexual Abuse (377-B PPC)", "Rape/Sodomy with Minor", "Vehicle Theft (381-A PPC)",
  "Burglary (457 PPC)", "Acid Attack (336-B PPC)", "Rape (376 PPC)", "Gang Rape (375-A PPC)",
  "Fatal Road Accidents", "Religious Cases (295-A,B,C PPC)", "Cattle Theft",
];
const zeros = () => HEADERS.map(() => "");
const counts = (pairs) => { const c = HEADERS.map(() => 0); for (const [h, v] of Object.entries(pairs)) c[h] = v; return c; };

// Layout (a): one tab per day, like the weekly report.
function dayTab(rows) {
  return [
    ["Punjab Police", "", "", ""],
    ["Daily Crime Diary - 20 Heads", "", "", ""],
    [],
    ["Sr. No.", "Region", "District", "", ...HEADERS, "Total Cases"],
    ...rows,
  ];
}

test("matchHead_ maps every weekly header to its own head", () => {
  const s = loadScript();
  assert.deepEqual(HEADERS.map((h) => s.matchHead_(h)), HEADERS.map((_, i) => i));
  assert.equal(s.matchHead_("Total Cases"), -1);
  assert.equal(s.matchHead_("Sr. No."), -1);
});

test("parseDate_ reads common tab-name formats", () => {
  const s = loadScript();
  const today = new Date(2026, 9, 24);
  assert.equal(s.parseDate_("2026-10-12", today), "2026-10-12");
  assert.equal(s.parseDate_("12-10-2026", today), "2026-10-12");
  assert.equal(s.parseDate_("12.10.26", today), "2026-10-12");
  assert.equal(s.parseDate_("12 Oct 2026", today), "2026-10-12");
  assert.equal(s.parseDate_("12-Oct-26", today), "2026-10-12");
  assert.equal(s.parseDate_("October 12, 2026", today), "2026-10-12");
  assert.equal(s.parseDate_("12th October", today), "2026-10-12");
  assert.equal(s.parseDate_("30 Dec", today), "2025-12-30"); // no year, would be in the future -> last year
  assert.equal(s.parseDate_(new Date(2026, 9, 12)), "2026-10-12");
  assert.equal(s.parseDate_(46307), "2026-10-12"); // sheet serial number
  for (const name of ["20 Head - Dashboard", "Sheet1", "Summary 2026", "Notes", "31-02-2026"]) {
    assert.equal(s.parseDate_(name, today), null, name);
  }
  assert.equal(loadScript({ DATE_ORDER: "MDY" }).parseDate_("10/12/2026", today), "2026-10-12");
});

test("layout (a): one tab per day, carried-down Region, total row and blank day", () => {
  const s = loadScript();
  const tabs = [
    { name: "20 Head - Dashboard", values: [["Weekly summary"], ["nothing here"]] },
    {
      name: "12-10-2026",
      values: dayTab([
        [1, "Lahore", "Lahore", "لاہور", ...counts({ 0: 3, 12: 40, 13: 5 }), 48],
        [2, "Sheikhupura", "Sheikhupura", "", ...counts({ 12: 6 }), 6],
        [3, "", "Kasur", "", ...counts({ 0: 1, 9: 2 }), 3],      // Region blank -> Sheikhupura
        [4, "", "Nankana Sahib", "", ...zeros(), ""],             // not reported yet -> dropped
        ["", "Punjab Total", "", "", ...counts({ 0: 4, 12: 46 }), 57],
      ]),
    },
    {
      name: "13 Oct 2026", // template copied for the day but not filled in yet
      values: dayTab([
        [1, "Lahore", "Lahore", "", ...zeros(), 0],
        [2, "Sheikhupura", "Sheikhupura", "", ...zeros(), 0],
        ["", "Punjab Total", "", "", ...counts({}), 0],
      ]),
    },
  ];
  const out = s.parseWorkbook_(tabs, new Date(2026, 9, 24));
  assert.deepEqual(out.records.map((r) => r.date), ["2026-10-12", "2026-10-13"]);
  const [day, blank] = out.records;
  assert.deepEqual(day.districts.map((d) => [d.name, d.region]), [
    ["Lahore", "Lahore"], ["Sheikhupura", "Sheikhupura"], ["Kasur", "Sheikhupura"],
  ]);
  assert.equal(day.districts[0].counts.length, 20);
  assert.equal(day.districts[0].counts[12], 40);
  assert.equal(day.districts[2].counts[9], 2);
  assert.deepEqual(blank.districts, []);
  assert.equal(out.headsFull[0], "Murder 302 PPC (Incl. All Types)");
  assert.deepEqual(out.warnings, []);
});

test("layout (b): one long tab with a Date column", () => {
  const s = loadScript();
  // Columns in a different order, Region before District, heads reversed: matching is by header text.
  const H = [...HEADERS].reverse();
  const row = (date, region, district, pairs) => {
    const c = counts(pairs);
    return [date, region, district, ...H.map((h) => c[HEADERS.indexOf(h)])];
  };
  const values = [
    ["Daily Dairy - all days"],
    ["Date", "Region", "District", ...H],
    row(new Date(2026, 9, 12), "Lahore", "Lahore", { 0: 2, 12: 30 }),
    row("", "Gujranwala", "Gujranwala", { 9: 4 }),           // Date carried down
    row("", "", "Sialkot", { 13: 1 }),                       // Region carried down
    row("", "Punjab Total", "", { 0: 2 }),                   // skipped
    ["13/10/2026", "Lahore", "Lahore", ...zeros()],           // blank day: only empty rows
    ["", "", "Gujranwala", ...zeros()],
    row("14/10/2026", "", "Sialkot", { 19: 1 }),             // new date resets Region (unknown here)
    row("", "Gujranwala", "Gujranwala", { 0: 0 }),           // explicit zero row counts as filled
  ];
  const out = s.parseWorkbook_([{ name: "Daily", values }], new Date(2026, 9, 24));
  assert.deepEqual(out.records.map((r) => r.date), ["2026-10-12", "2026-10-13", "2026-10-14"]);
  const [d12, d13, d14] = out.records;
  assert.deepEqual(d12.districts.map((d) => [d.name, d.region]), [
    ["Lahore", "Lahore"], ["Gujranwala", "Gujranwala"], ["Sialkot", "Gujranwala"],
  ]);
  assert.equal(d12.districts[0].counts[12], 30);
  assert.equal(d12.districts[0].counts[0], 2);
  assert.equal(d12.districts[1].counts[9], 4);
  assert.equal(d12.districts[2].counts[13], 1);
  assert.deepEqual(d13.districts, []);
  assert.deepEqual(d14.districts.map((d) => [d.name, d.region]), [["Sialkot", ""], ["Gujranwala", "Gujranwala"]]);
  assert.equal(d14.districts[1].counts.reduce((a, b) => a + b, 0), 0);
});

test("LAYOUT and HEAD_OVERRIDES config", () => {
  const renamed = HEADERS.map((h, i) => (i === 15 ? "Zina-bil-Jabr" : h));
  const values = [["Sr. No.", "Region", "District", ...renamed], [1, "Lahore", "Lahore", ...counts({ 15: 2 })]];
  const plain = loadScript().parseWorkbook_([{ name: "12-10-2026", values }]);
  assert.equal(plain.records[0].districts[0].counts[15], 2); // "zina" is recognised already
  const odd = values.map((r, i) => (i === 0 ? r.map((c) => (c === "Zina-bil-Jabr" ? "Col X" : c)) : r));
  const missed = loadScript().parseWorkbook_([{ name: "12-10-2026", values: odd }]);
  assert.equal(missed.records[0].districts[0].counts[15], 0);
  assert.match(missed.warnings.join("\n"), /no column found for Rape/);
  const fixed = loadScript({ HEAD_OVERRIDES: { "Col X": 15 } }).parseWorkbook_([{ name: "12-10-2026", values: odd }]);
  assert.equal(fixed.records[0].districts[0].counts[15], 2);
  // LAYOUT: 'long' ignores date-named tabs.
  assert.deepEqual(loadScript({ LAYOUT: "long" }).parseWorkbook_([{ name: "12-10-2026", values }]).records, []);
});
