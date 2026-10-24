# Internal Dashboard

Crime diary dashboard for the 20 crime heads (Punjab, district-wise). It reads the daily
Google Sheet **20-Heads Crime Data_Daily Dairy** and sums it over the dates you pick.

- **Date range** (top bar, next to Region): pick any start and end date. Dates with no data are
  greyed out and can't be picked; a range that spans them just sums the days that have data.
  Presets: *Last 7 filled days*, *This week (Mon–Sun)*, *This month*, *All dates*. The subtitle
  shows the range and how many days in it have data.
- Every KPI, chart, the heatmap and the insights use the summed range. "Cases by day" shows real
  per-day totals (per week for ranges over 62 days). The comparison chart and the KPI deltas set the
  range against the **previous range of equal length**. Days after the latest data, such as the rest of
  *This month*, don't count towards that length. The weekly trend shows real Mon–Sun totals.
- **Case progress** and the **Activity** feed are still generated sample data, tagged *Mock*.
- Cards tagged *Live* come from the sheet. With no sheet connected, the page runs on generated mock
  daily data, shows a **Mock data** banner, and every card is tagged *Mock*.

No real figures are committed to this repo: `assets/config.js` (the sheet URL) and `assets/data.js`
(the weekly workbook) are gitignored.

## Run

```bash
python -m http.server 8765
```

Then open http://localhost:8765. With no `assets/config.js`, the page runs on mock data. The two 404s
for `config.js` / `data.js` in the console are expected.

## Connect the Google Sheet

The sheet is read by a small Google Apps Script web app (`apps-script/`) that runs as you, inside
your Google account. Don't make the sheet public, share it with "anyone with the link", or use the
gviz/CSV export URLs: this is police crime data.

### 1. Add the script to the sheet

1. Open **20-Heads Crime Data_Daily Dairy** → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** (gear icon) → tick *Show "appsscript.json" manifest file in editor*, then
   replace `appsscript.json` with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Check the `CONFIG` block at the top of `Code.gs` (layout, date order; see *Sheet layouts* below).
5. Pick `getDailyData` in the function list and press **Run** once to grant access. Functions
   ending in `_` are private and don't appear in that list. If Google says it *hasn't verified this
   app*, choose **Advanced → Go to (project name)**; that's normal for your own script. Then open
   **Executions** and check that it finished without errors.

### 2. Deploy with restricted access

**Deploy → New deployment → Select type: Web app**

- **Execute as:** *Me*
- **Who has access:** *Only myself*, or *Anyone within &lt;your Workspace domain&gt;*.
  **Never choose "Anyone".**

Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`). Opening it while signed in
shows the JSON. When the sheet changes you don't need to redeploy, but after editing `Code.gs` use
**Deploy → Manage deployments → Edit → New version** so the URL keeps working.

To also check the viewer's e-mail inside the script, list allowed addresses in
`CONFIG.ALLOWED_EMAILS`. This only works for accounts in the same Workspace domain.

### 3a. Recommended: open the dashboard from the script

A restricted web app only answers requests that carry your Google sign-in. Browsers usually block a
page on another address (such as `localhost`) from reading it, because of CORS and third-party
cookie rules. The dependable way to use restricted access is to let the script serve the dashboard
too:

```bash
python scripts/build_apps_script.py      # writes apps-script/Dashboard.html (gitignored)
```

In the Apps Script editor, add an HTML file named **`Dashboard`** (**+ → HTML**), paste in the contents
of `apps-script/Dashboard.html`, then deploy a new version. Open:

```
https://script.google.com/macros/s/…/exec?view=dashboard
```

The page then reads the sheet through `google.script.run`, as the signed-in user, with the same access
rule as the deployment. Re-run the build and paste again whenever the dashboard code changes.

### 3b. Or point a local copy at the URL

```bash
cp assets/config.example.js assets/config.js
# edit assets/config.js:  window.DASHBOARD_CONFIG = { dataUrl: "https://script.google.com/macros/s/…/exec" };
```

The page fetches the URL with your browser's Google sign-in. If the browser blocks this, or the fetch
fails for any other reason, the page falls back to mock data (or to `assets/data.js` if you have it)
and the banner shows the error. In that case use 3a.

## Sheet layouts

The script doesn't know the sheet's exact layout in advance, so it supports two. With
`CONFIG.LAYOUT = 'auto'` (the default), it decides per tab:

**(a) One tab per day.** The tab name is the date, e.g. `12-10-2026`, `12.10.26`, `12 Oct 2026`,
`12-Oct-26`, `2026-10-12` or `12 Oct` (with no year, it uses the most recent such date that isn't in the
future). All-number dates are read day-first. Set `CONFIG.DATE_ORDER = 'MDY'` if yours are month-first.
Each tab is laid out like the weekly report:

| Sr. No. | Region | District | (Urdu name) | Murder 302 PPC (Incl. All Types) | … 20 heads … | Total Cases |
|---|---|---|---|---|---|---|
| 1 | Lahore | Lahore | | 3 | … | 48 |
| 2 | Sheikhupura | Sheikhupura | | 0 | … | 6 |
| 3 | | Kasur | | 1 | … | 3 |
| | Punjab Total | | | … | … | … |

Title rows above the header are fine (the header is found within the first 30 rows). Region is only
needed on the first district of each region and is carried down. The `Punjab Total` row and
`Total Cases` column are ignored.

**(b) One long tab** with a `Date` column plus `Region`, `District` and the 20 head columns, one row per
district per day. Dates can be real date cells or text, and are carried down if only the first row of a
day has one. Set `CONFIG.LONG_TAB_NAME` to read only one tab.

In both layouts:

- **Head columns are matched by header text, not position**, so column order doesn't matter. The text
  is matched by keywords (`Murder 302 PPC (Incl. All Types)`, `Dacoity with Hurt`,
  `Vehicle Theft (381-A PPC)`, `Zina-bil-Jabr`, …). If a column isn't recognised, the JSON lists it
  under `warnings` (the dashboard also logs these to the browser console). Map it by its exact header
  text in `CONFIG.HEAD_OVERRIDES`, e.g. `{ 'Col X': 15 }`. Head indexes follow
  `SHORT_HEADS` in `scripts/extract_data.py`.
- **Blank means not reported.** A district row whose head cells are all empty is dropped, and a date
  with no non-blank rows (e.g. a tab copied from the template but not filled in yet) is greyed out in
  the date picker. `0` and `-` count as reported zeros.
- Tabs that are neither date-named nor contain a Date/District header (summaries, notes) are skipped.
  You can also list them in `CONFIG.SKIP_TABS`.

The web app returns:

```json
{ "heads": ["Murder", …], "headsFull": ["Murder 302 PPC (Incl. All Types)", …],
  "records": [ { "date": "2026-10-12", "districts": [ { "name": "Lahore", "region": "Lahore", "counts": [3, …20 numbers] } ] } ],
  "warnings": [], "source": "20-Heads Crime Data_Daily Dairy", "generated": "…" }
```

## Tests

The parser in `Code.gs` is plain JavaScript, so its parsing functions run under Node without Apps
Script, against fixture rows for both layouts (carried-down Region, total rows, blank days, header
matching):

```bash
node --test
```

## Offline: weekly workbook

The old weekly path still works without a sheet:

```bash
pip install openpyxl
python scripts/extract_data.py "path/to/12 to 18 Oct 2026.xlsx" "12 to 18 Oct 2026"
```

This writes `assets/data.js` (gitignored). When no live URL is configured, or the live fetch fails, the
dashboard loads it as a single one-week range. The date picker is disabled and there is no daily
breakdown.
