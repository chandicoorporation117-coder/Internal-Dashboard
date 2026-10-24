# Internal Dashboard

Weekly crime diary dashboard for the 20 crime heads (Punjab, district-wise).

- **Real data:** district × crime-head totals extracted from the weekly `.xlsx`.
- **Mock data:** daily split, previous weeks, case progress and the activity feed are
  generated (seeded, so they are stable between reloads). Each card is tagged *Real* or *Mock*.

## Run

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## Load a new week

```bash
pip install openpyxl
python scripts/extract_data.py "path/to/12 to 18 Oct 2026.xlsx" "12 to 18 Oct 2026"
```

This rewrites `assets/data.js`; reload the page. `assets/data.js` holds the real
figures and is gitignored, so generate it locally after cloning.
