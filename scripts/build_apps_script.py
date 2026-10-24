"""Bundle the dashboard into apps-script/Dashboard.html, to be served by the Apps Script itself.

Usage:
    python scripts/build_apps_script.py

Inlines assets/styles.css and assets/app.js into index.html and drops the local-only
config.js / data.js scripts. Paste the output into an HTML file named "Dashboard" in the
Apps Script project; it is then served at <web app URL>?view=dashboard and reads the sheet
through google.script.run, so access stays limited to whoever the deployment allows.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps-script" / "Dashboard.html"


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "styles.css").read_text(encoding="utf-8")
    js = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    replacements = {
        '<link rel="stylesheet" href="assets/styles.css">': f"<style>\n{css}</style>",
        '  <script src="assets/config.js"></script>\n': "",
        '  <script src="assets/data.js"></script>\n': "",
        '<script src="assets/app.js"></script>': "<script>\n" + js.replace("</script", "<\\/script") + "</script>",
    }
    for old, new in replacements.items():
        if old not in html:
            raise SystemExit(f"index.html no longer contains {old.strip()!r}; update {Path(__file__).name}")
        html = html.replace(old, new)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
