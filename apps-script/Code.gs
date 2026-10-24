/**
 * Daily 20-head crime diary -> JSON for the dashboard.
 *
 * Bind this script to the "20-Heads Crime Data_Daily Dairy" spreadsheet
 * (Extensions > Apps Script) and deploy it as a web app with
 *   Execute as: Me    Who has access: Only myself / your domain   (never "Anyone").
 *
 *   <web app URL>                  -> JSON { records: [{ date, districts: [{ name, region, counts }] }] }
 *   <web app URL>?view=dashboard   -> the dashboard page itself (needs Dashboard.html, see README)
 *
 * Two sheet layouts are supported (see README):
 *   (a) one tab per day, tab name is the date, laid out like the weekly report;
 *   (b) one long tab with a Date column plus Region, District and the 20 heads.
 */

// ---------- Config ----------
var CONFIG = {
  // 'auto' reads date-named tabs as layout (a) and any other tab with a Date column as layout (b).
  // Force one with 'tabs' or 'long'.
  LAYOUT: 'auto',
  // Layout (b): name of the long tab. '' = every non-date tab that has a Date column.
  LONG_TAB_NAME: '',
  // How to read all-number dates such as 05/10/2026: 'DMY' (5 Oct) or 'MDY' (10 May).
  DATE_ORDER: 'DMY',
  // Tabs to ignore entirely, by exact name.
  SKIP_TABS: [],
  // If a head column isn't recognised, map its exact header text to a head index (0-19, see HEADS).
  // e.g. { 'Zina-bil-Jabr (376 PPC)': 15 }
  HEAD_OVERRIDES: {},
  // Optional extra gate on top of the deployment's access setting: lower-case e-mails allowed to read.
  // Empty = rely on the deployment setting alone. Only works for viewers Apps Script can identify
  // (same Google Workspace domain, or the owner).
  ALLOWED_EMAILS: [],
};

// Same order as SHORT_HEADS in scripts/extract_data.py.
var HEADS = [
  'Murder', 'Dacoity', 'Dacoity w/ Hurt', 'Dacoity w/ Murder', 'Dacoity w/ Rape',
  'Robbery', 'Robbery w/ Hurt', 'Robbery w/ Murder', 'Robbery w/ Rape',
  'Snatching', 'Child Sexual Abuse', 'Rape/Sodomy (Minor)', 'Vehicle Theft',
  'Burglary', 'Acid Attack', 'Rape', 'Gang Rape', 'Fatal Road Accidents',
  'Religious Cases', 'Cattle Theft',
];

// ---------- Web app entry points ----------
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!isAllowed_()) {
    return json_({ error: 'Not authorised' });
  }
  if (params.view === 'dashboard') {
    return HtmlService.createHtmlOutputFromFile('Dashboard')
      .setTitle('Crime Diary Dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return json_(readSpreadsheet_());
}

// Called by the dashboard via google.script.run when it is served by this script.
function getDailyData() {
  if (!isAllowed_()) throw new Error('Not authorised');
  return JSON.stringify(readSpreadsheet_());
}

function isAllowed_() {
  if (!CONFIG.ALLOWED_EMAILS.length) return true;
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return CONFIG.ALLOWED_EMAILS.indexOf(email) !== -1;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = ss.getSheets().map(function (sh) {
    return { name: sh.getName(), values: sh.getDataRange().getValues() };
  });
  var data = parseWorkbook_(tabs, new Date());
  data.source = ss.getName();
  data.generated = new Date().toISOString();
  return data;
}

// ---------- Parsing (pure functions, no Apps Script services; tested in tests/) ----------

/**
 * tabs: [{ name, values: 2-D array as returned by Range.getValues() }]
 * Returns { heads, headsFull, records: [{ date, districts }], warnings }.
 * Dates whose rows are all blank come back with districts: [] so the dashboard can grey them out.
 */
function parseWorkbook_(tabs, today) {
  var byDate = {};
  var headsFull = HEADS.slice();
  var warnings = [];

  function add(date, districts, where) {
    var rec = byDate[date] || (byDate[date] = { date: date, districts: [] });
    districts.forEach(function (d) {
      var i = indexByName_(rec.districts, d.name);
      if (i === -1) rec.districts.push(d);
      else {
        warnings.push(where + ': ' + d.name + ' appears twice for ' + date + '; using the later row');
        rec.districts[i] = d;
      }
    });
  }

  tabs.forEach(function (tab) {
    if (CONFIG.SKIP_TABS.indexOf(tab.name) !== -1) return;
    var tabDate = CONFIG.LAYOUT === 'long' ? null : parseDate_(tab.name, today);
    var res;
    if (tabDate) {
      res = parseTable_(tab.values, false);
      if (!res) { warnings.push('Tab "' + tab.name + '": no header row with District and crime-head columns'); return; }
      add(tabDate, res.rows.map(function (r) { return r.district; }), 'Tab "' + tab.name + '"');
    } else if (CONFIG.LAYOUT !== 'tabs' && (!CONFIG.LONG_TAB_NAME || CONFIG.LONG_TAB_NAME === tab.name)) {
      res = parseTable_(tab.values, true);
      if (!res) return; // not a data tab (e.g. a summary or notes tab)
      res.rows.forEach(function (r) { add(r.date, r.district ? [r.district] : [], 'Tab "' + tab.name + '"'); });
    } else {
      return;
    }
    res.warnings.forEach(function (w) { warnings.push('Tab "' + tab.name + '": ' + w); });
    res.headCols.forEach(function (c, h) { if (c !== -1 && headsFull[h] === HEADS[h]) headsFull[h] = res.headerText[h]; });
  });

  var records = Object.keys(byDate).sort().map(function (k) { return byDate[k]; });
  return { heads: HEADS.slice(), headsFull: headsFull, records: records, warnings: warnings };
}

/**
 * Finds the header row, then reads district rows below it.
 * withDate = true for the long layout (needs a Date column; dates are carried down like Region).
 * Returns null if no usable header row is found.
 */
function parseTable_(values, withDate) {
  var hdr = findHeader_(values, withDate);
  if (!hdr) return null;
  var rows = [];
  var region = '', date = null;
  for (var r = hdr.row + 1; r < values.length; r++) {
    var row = values[r];
    var regionCell = hdr.regionCol === -1 ? '' : String(row[hdr.regionCol] == null ? '' : row[hdr.regionCol]).trim();
    var name = String(row[hdr.districtCol] == null ? '' : row[hdr.districtCol]).trim();
    if (withDate) {
      var cell = row[hdr.dateCol];
      if (cell !== '' && cell != null) {
        var d = parseDate_(cell);
        if (d) { if (d !== date) region = ''; date = d; }
      }
    }
    if (regionCell) region = regionCell; // Region is only filled on the first district of each region
    if (!name || /total/i.test(name) || /total/i.test(regionCell)) continue;
    if (withDate && !date) continue;

    var blank = true;
    var counts = hdr.headCols.map(function (c) {
      if (c === -1) return 0;
      var n = toCount_(row[c]);
      if (n === null) return 0;
      blank = false;
      return n;
    });
    // A district row with every head cell empty is "not reported", not zero.
    var out = { date: date, district: blank ? null : { name: name, region: region, counts: counts } };
    if (out.district || withDate) rows.push(out);
  }
  return { rows: rows, headCols: hdr.headCols, headerText: hdr.headerText, warnings: hdr.warnings };
}

function findHeader_(values, withDate) {
  var limit = Math.min(values.length, 30);
  for (var r = 0; r < limit; r++) {
    var row = values[r];
    var districtCol = -1, regionCol = -1, dateCol = -1;
    var headCols = HEADS.map(function () { return -1; });
    var headerText = HEADS.slice();
    var warnings = [], found = 0;
    for (var c = 0; c < row.length; c++) {
      var raw = String(row[c] == null ? '' : row[c]).trim();
      var n = norm_(raw);
      if (!n) continue;
      if (districtCol === -1 && /^district/.test(n)) { districtCol = c; continue; }
      if (regionCol === -1 && /^region/.test(n)) { regionCol = c; continue; }
      if (dateCol === -1 && /^date\b/.test(n)) { dateCol = c; continue; }
      var h = matchHead_(raw);
      if (h === -1) continue;
      if (headCols[h] !== -1) { warnings.push('"' + raw + '" also matched ' + HEADS[h] + '; ignored'); continue; }
      headCols[h] = c;
      headerText[h] = raw.replace(/\s+/g, ' ');
      found++;
    }
    if (districtCol === -1 || found < 10 || (withDate && dateCol === -1)) continue;
    headCols.forEach(function (c, h) {
      if (c === -1) warnings.push('no column found for ' + HEADS[h] + ' (counted as 0; add it to CONFIG.HEAD_OVERRIDES)');
    });
    return { row: r, districtCol: districtCol, regionCol: regionCol, dateCol: dateCol,
             headCols: headCols, headerText: headerText, warnings: warnings };
  }
  return null;
}

/** Maps a crime-head header (e.g. "Murder 302 PPC (Incl. All Types)") to its index in HEADS, or -1. */
function matchHead_(header) {
  var exact = CONFIG.HEAD_OVERRIDES[String(header).trim()];
  if (exact != null) return exact;
  var h = ' ' + norm_(header) + ' ';
  var has = function (re) { return re.test(h); };
  var hurt = has(/hurt|injur/), killed = has(/murder|qatl/), rape = has(/rape|zina/);
  if (has(/total/)) return -1;
  if (has(/acid/)) return 14;
  if (has(/accident/)) return 17;
  if (has(/cattle|livestock/)) return 19;
  if (has(/religio|blasphem| 295/)) return 18;
  if (has(/snatch/)) return 9;
  if (has(/vehicle|motor ?cycle|car theft|381 a /)) return 12;
  if (has(/burglar|house ?break|457 /)) return 13;
  if (has(/dacoit/)) return hurt ? 2 : killed ? 3 : rape ? 4 : 1;
  if (has(/robber/)) return hurt ? 6 : killed ? 7 : rape ? 8 : 5;
  if (has(/gang/) && rape) return 16;
  if (has(/sodomy/) || (rape && has(/minor|child/))) return 11;
  if (has(/child|minor/) && has(/sexual|abuse/)) return 10;
  if (rape) return 15;
  if (killed || has(/ 302 /)) return 0;
  return -1;
}

/** Cell -> non-negative integer, or null if the cell is blank / not a number. */
function toCount_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? Math.max(0, Math.round(v)) : null;
  var s = String(v).trim();
  if (s === '-' || s === '–') return 0;
  if (!/^\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return null;
  return Math.round(Number(s.replace(/,/g, '')));
}

var MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Date cell or tab name -> 'YYYY-MM-DD', or null.
 * Accepts Date objects, sheet serial numbers and text such as 2026-10-12, 12-10-2026, 12.10.26,
 * 12 Oct 2026, 12-Oct-26, Oct 12, 2026 and (with no year) 12 Oct or 12-10.
 */
function parseDate_(v, today) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : iso_(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    if (v < 30000 || v > 80000) return null; // not a plausible sheet date serial
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return iso_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  var s = String(v).trim().toLowerCase();
  var m, y, mo, day;
  var month = function (name) { return MONTHS_.indexOf(name.slice(0, 3)) + 1; };
  if ((m = s.match(/(?:^|\D)(\d{4})[-\/. ](\d{1,2})[-\/. ](\d{1,2})(?!\d)/))) {
    y = +m[1]; mo = +m[2]; day = +m[3];
  } else if ((m = s.match(/(?:^|\D)(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2}|\d{4})(?!\d)/))) {
    y = +m[3]; mo = CONFIG.DATE_ORDER === 'MDY' ? +m[1] : +m[2]; day = CONFIG.DATE_ORDER === 'MDY' ? +m[2] : +m[1];
  } else if ((m = s.match(/(?:^|[^a-z0-9])(\d{1,2})(?:st|nd|rd|th)?[-\/. ,]*([a-z]{3,9})\.?(?:[-\/. ,]*(\d{4}|\d{2}))?(?![a-z0-9])/)) && month(m[2])) {
    day = +m[1]; mo = month(m[2]); y = m[3] ? +m[3] : null;
  } else if ((m = s.match(/(?:^|[^a-z])([a-z]{3,9})\.?[-\/. ]*(\d{1,2})(?:st|nd|rd|th)?(?:[-\/. ,]+(\d{4}|\d{2}))?(?!\d)/)) && month(m[1])) {
    mo = month(m[1]); day = +m[2]; y = m[3] ? +m[3] : null;
  } else if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})$/))) {
    mo = CONFIG.DATE_ORDER === 'MDY' ? +m[1] : +m[2]; day = CONFIG.DATE_ORDER === 'MDY' ? +m[2] : +m[1]; y = null;
  } else {
    return null;
  }
  if (y === null) {
    // No year in the name: assume the most recent such date that isn't in the future.
    var now = today || new Date();
    y = now.getFullYear();
    if (new Date(y, mo - 1, day) > now) y--;
  } else if (y < 100) {
    y += 2000;
  }
  var check = new Date(y, mo - 1, day);
  if (mo < 1 || mo > 12 || check.getMonth() !== mo - 1 || check.getDate() !== day) return null;
  return iso_(y, mo, day);
}

function iso_(y, m, d) {
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function norm_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function indexByName_(list, name) {
  var key = norm_(name);
  for (var i = 0; i < list.length; i++) if (norm_(list[i].name) === key) return i;
  return -1;
}
