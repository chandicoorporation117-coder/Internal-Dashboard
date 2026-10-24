(() => {
  // Same order as SHORT_HEADS in scripts/extract_data.py and HEADS in apps-script/Code.gs.
  const HEADS = [
    "Murder", "Dacoity", "Dacoity w/ Hurt", "Dacoity w/ Murder", "Dacoity w/ Rape",
    "Robbery", "Robbery w/ Hurt", "Robbery w/ Murder", "Robbery w/ Rape",
    "Snatching", "Child Sexual Abuse", "Rape/Sodomy (Minor)", "Vehicle Theft",
    "Burglary", "Acid Attack", "Rape", "Gang Rape", "Fatal Road Accidents",
    "Religious Cases", "Cattle Theft",
  ];
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Crime heads grouped into five families. Colors are fixed per group (never by rank).
  const GROUPS = [
    { name: "Property", heads: [12, 13, 19], color: "--series-1" },
    { name: "Street crime", heads: [5, 6, 7, 8, 9], color: "--series-2" },
    { name: "Women & child", heads: [10, 11, 14, 15, 16], color: "--series-3" },
    { name: "Violent", heads: [0, 1, 2, 3, 4], color: "--series-4" },
    { name: "Other", heads: [17, 18], color: "--series-5" },
  ];
  const headGroup = [];
  GROUPS.forEach((g, gi) => g.heads.forEach((h) => (headGroup[h] = gi)));

  // ---------- Seeded random (mock parts) ----------
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  function pickWeighted(weights, r) {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }

  // ---------- Dates (ISO "YYYY-MM-DD" strings, calendar arithmetic in UTC) ----------
  const DAY_MS = 864e5;
  const pad2 = (n) => String(n).padStart(2, "0");
  const toISO = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);
  const dayDiff = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
  const weekday = (iso) => (new Date(toUTC(iso)).getUTCDay() + 6) % 7; // Mon = 0
  const weekStart = (iso) => addDays(iso, -weekday(iso));
  const monthStart = (iso) => iso.slice(0, 8) + "01";
  const monthEnd = (iso) => addDays(fromUTC(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 1)), -1);
  const now = new Date();
  const TODAY = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const fmtDate = (iso, year = true) => `${+iso.slice(8)} ${MONTHS[+iso.slice(5, 7) - 1]}${year ? " " + iso.slice(0, 4) : ""}`;
  function rangeLabel(from, to) {
    if (from === to) return fmtDate(from);
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
    return `${sameMonth ? +from.slice(8) : fmtDate(from, !sameYear)} – ${fmtDate(to)}`;
  }
  const datesBetween = (from, to) => Array.from({ length: dayDiff(from, to) + 1 }, (_, i) => addDays(from, i));

  // ---------- Mock daily dataset (same shape as the Apps Script response) ----------
  // Sample district list for the mock only; live data brings its own districts and regions.
  const MOCK_REGIONS = {
    "Lahore": ["Lahore"],
    "Sheikhupura": ["Sheikhupura", "Kasur", "Nankana Sahib"],
    "Gujranwala": ["Gujranwala", "Sialkot", "Narowal", "Hafizabad"],
    "Gujrat": ["Gujrat", "Mandi Bahauddin", "Wazirabad"],
    "Rawalpindi": ["Rawalpindi", "Attock", "Jhelum", "Chakwal", "Talagang"],
    "Sargodha": ["Sargodha", "Khushab", "Mianwali", "Bhakkar"],
    "Faisalabad": ["Faisalabad", "Jhang", "Toba Tek Singh", "Chiniot"],
    "Multan": ["Multan", "Khanewal", "Lodhran", "Vehari"],
    "Sahiwal": ["Sahiwal", "Okara", "Pakpattan"],
    "D.G. Khan": ["D.G. Khan", "Muzaffargarh", "Layyah", "Rajanpur", "Kot Addu"],
    "Bahawalpur": ["Bahawalpur", "Bahawalnagar", "Rahim Yar Khan"],
  };
  // Rough Punjab-wide cases per week for each head, only to make the mock look plausible.
  const MOCK_WEEKLY = [60, 14, 3, 1, 0.3, 300, 40, 5, 0.5, 900, 40, 30, 1800, 500, 1, 100, 10, 80, 8, 150];
  const MOCK_DAY_WEIGHT = [1.0, 0.95, 0.9, 1.0, 1.1, 1.25, 0.85];
  const MOCK_BIG = { Lahore: 10, Faisalabad: 3.5, Rawalpindi: 3, Gujranwala: 2.6, Multan: 2.6 };

  function mockDaily() {
    const r = mulberry32(20261012);
    const districts = Object.entries(MOCK_REGIONS).flatMap(([region, names]) =>
      names.map((name) => ({ name, region, w: MOCK_BIG[name] || 0.6 + r() * 0.9 })));
    const totalW = districts.reduce((a, d) => a + d.w, 0);
    const poisson = (mean, rr) => {
      const l = Math.exp(-mean); let k = 0, p = 1;
      do { k++; p *= rr(); } while (p > l);
      return k - 1;
    };
    const first = addDays(TODAY, -95);
    const records = datesBetween(first, TODAY).map((date) => {
      const rr = mulberry32(hash(date));
      // Leave some days blank so the picker has something to grey out: today (not entered yet),
      // four days ago, and roughly one day in ten.
      if (date === TODAY || date === addDays(TODAY, -4) || hash("blank" + date) % 10 === 0) {
        // One flavour sends rows with empty cells, the other no rows at all; both count as blank.
        return { date, districts: hash(date) % 2 ? [] : districts.map((d) => ({ name: d.name, region: d.region, counts: HEADS.map(() => null) })) };
      }
      const dayW = MOCK_DAY_WEIGHT[weekday(date)];
      const trend = 1 + 0.12 * Math.sin(toUTC(date) / (DAY_MS * 9));
      return {
        date,
        districts: districts.filter(() => rr() > 0.03).map((d) => ({ // ~3% of districts not reported
          name: d.name,
          region: d.region,
          counts: MOCK_WEEKLY.map((wk) => {
            const mean = (wk / 7) * (d.w / totalW) * dayW * trend;
            return mean > 25 ? Math.round(mean + (rr() - 0.5) * Math.sqrt(mean) * 2) : poisson(mean, rr);
          }),
        })),
      };
    });
    return { source: "generated sample", heads: HEADS, headsFull: HEADS, records };
  }

  // ---------- Loading ----------
  function callAppsScript() {
    return new Promise((resolve, reject) =>
      google.script.run.withSuccessHandler((s) => resolve(JSON.parse(s))).withFailureHandler(reject).getDailyData());
  }
  async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { credentials: "include", signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  // The weekly workbook (assets/data.js) has no dates; anchor it on the week's first day if the label says.
  function weekStartFromLabel(label) {
    const m = String(label || "").toLowerCase().match(/(\d{1,2})\s*(?:([a-z]{3,9})\s*)?(?:to|-|–)\s*\d{1,2}\s+([a-z]{3,9})\s+(\d{4})/);
    if (!m) return TODAY;
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === (m[2] || m[3]).slice(0, 3));
    if (mon < 0) return TODAY;
    let year = +m[4];
    if (m[2] && mon > MONTHS.findIndex((x) => x.toLowerCase() === m[3].slice(0, 3))) year--;
    return toISO(year, mon + 1, +m[1]);
  }

  async function loadData() {
    const cfg = window.DASHBOARD_CONFIG || {};
    let problem = "";
    const inAppsScript = window.google && google.script && google.script.run;
    if (inAppsScript || cfg.dataUrl) {
      try {
        const raw = inAppsScript ? await callAppsScript() : await fetchJson(cfg.dataUrl);
        if (raw && raw.error) throw new Error(raw.error);
        const model = buildModel(Array.isArray(raw) ? { records: raw } : raw, "live");
        if (!model.filled.length) throw new Error("the sheet returned no filled days");
        if (raw.warnings && raw.warnings.length) console.warn("Sheet parser warnings:\n" + raw.warnings.join("\n"));
        model.warnings = (raw.warnings || []).length;
        return model;
      } catch (e) {
        problem = `Couldn't load the Google Sheet (${e.message || e}).`;
        console.error("Live data failed:", e);
      }
    }
    const W = window.CRIME_DATA;
    if (W && Array.isArray(W.districts)) {
      const model = buildModel({
        source: W.source, headsFull: W.headsFull,
        records: [{ date: weekStartFromLabel(W.week), districts: W.districts }],
      }, "weekly");
      model.week = W.week;
      model.problem = problem;
      return model;
    }
    const model = buildModel(mockDaily(), "mock");
    model.problem = problem || "No data source is configured (assets/config.js has no dataUrl).";
    return model;
  }

  // records -> { districts: [{ key, name, region, urdu }], days: Map(date -> Map(key -> counts)), filled: [dates] }
  function buildModel(raw, mode) {
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const meta = new Map();
    const days = new Map();
    const records = [...(raw.records || [])].filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    records.forEach((rec) => {
      // A date is "filled" only if at least one district row has a value in it; blank rows don't count.
      const rows = (rec.districts || []).filter((d) => d && d.name && Array.isArray(d.counts) &&
        d.counts.some((v) => v !== null && v !== undefined && v !== "" && !isNaN(v)));
      if (!rows.length) return;
      const byKey = days.get(rec.date) || new Map();
      rows.forEach((d) => {
        const key = norm(d.name);
        const m = meta.get(key);
        if (!m) meta.set(key, { key, name: String(d.name).trim(), region: d.region || "", urdu: d.urdu || "" });
        else if (d.region) m.region = d.region; // keep the latest non-empty region
        byKey.set(key, HEADS.map((_, h) => Math.max(0, Math.round(+d.counts[h] || 0))));
      });
      days.set(rec.date, byKey);
    });
    const districts = [...meta.values()];
    districts.forEach((d) => { if (!d.region) d.region = "Unassigned"; });
    const headsFull = HEADS.map((h, i) => (raw.headsFull && raw.headsFull[i]) || h);
    return { mode, source: raw.source || "", headsFull, districts, days, filled: [...days.keys()].sort() };
  }

  // ---------- Helpers ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (n) => n.toLocaleString("en-US");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const groupSum = (headVals, g) => sum(GROUPS[g].heads.map((h) => headVals[h]));
  const zeros = () => HEADS.map(() => 0);
  const addInto = (acc, counts) => { for (let h = 0; h < acc.length; h++) acc[h] += counts[h]; return acc; };

  let M = null; // the loaded model
  const state = { from: null, to: null };

  // Per-day head totals for a set of districts (keys), for every filled date.
  function perDayTotals(keys) {
    const out = new Map();
    M.filled.forEach((date) => {
      const acc = zeros();
      const day = M.days.get(date);
      keys.forEach((k) => { const c = day.get(k); if (c) addInto(acc, c); });
      out.set(date, acc);
    });
    return out;
  }
  const filledIn = (from, to) => M.filled.filter((d) => d >= from && d <= to);
  // Districts with counts summed over [from, to].
  function districtsOver(list, from, to) {
    const dates = filledIn(from, to);
    return list.map((m) => {
      const counts = zeros();
      dates.forEach((date) => { const c = M.days.get(date).get(m.key); if (c) addInto(counts, c); });
      return { ...m, counts, total: sum(counts) };
    });
  }
  function headsOver(perDay, from, to) {
    const acc = zeros();
    filledIn(from, to).forEach((d) => addInto(acc, perDay.get(d)));
    return acc;
  }
  // The equal-length range just before [from, to]. Days after the latest data (e.g. the rest of
  // "This month") don't count towards the length, so a part-filled range isn't compared to a full one.
  const previousRange = (from, to) => {
    const last = M.filled[M.filled.length - 1];
    if (to > last) to = from > last ? from : last;
    const len = dayDiff(from, to) + 1;
    return { from: addDays(from, -len), to: addDays(from, -1), len };
  };

  // Weekly (Mon–Sun) totals for the 12 weeks up to the range end. null = week with no filled day.
  function weeklyTrend(perDay, to) {
    const lastWeek = weekStart(to);
    const firstData = M.filled[0];
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const ws = addDays(lastWeek, -7 * i);
      if (addDays(ws, 6) < firstData) continue;
      const dates = filledIn(ws, addDays(ws, 6));
      const heads = dates.length ? headsOver(perDay, ws, addDays(ws, 6)) : null;
      weeks.push({ start: ws, days: dates.length, heads });
    }
    return weeks;
  }

  // ---------- Chart.js setup ----------
  const charts = [];
  function chart(id, config) {
    charts.push(new Chart(el(id), config));
  }

  // Draws a value at the end of each horizontal bar (stack).
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(c, _args, opts) {
      if (!opts || !opts.values) return;
      const metas = c.getSortedVisibleDatasetMetas();
      const last = metas[metas.length - 1];
      const { ctx } = c;
      ctx.save();
      ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillStyle = css("--ink-2");
      ctx.textBaseline = "middle";
      last.data.forEach((bar, i) => ctx.fillText(opts.values[i], bar.x + 6, bar.y));
      ctx.restore();
    },
  };
  // Total in the middle of a doughnut.
  const centerText = {
    id: "centerText",
    afterDraw(c, _args, opts) {
      if (!opts || !opts.value) return;
      const { ctx, chartArea: a } = c;
      const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = css("--ink");
      ctx.font = "650 26px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(opts.value, x, y + 2);
      ctx.fillStyle = css("--muted");
      ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.fillText(opts.label, x, y + 22);
      ctx.restore();
    },
  };

  function applyDefaults() {
    Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--grid");
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.display = false;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: css("--surface"),
      titleColor: css("--ink"),
      bodyColor: css("--ink-2"),
      borderColor: css("--border"),
      borderWidth: 1,
      padding: 10,
      boxPadding: 4,
      usePointStyle: true,
      titleFont: { weight: "600" },
    });
  }
  const axisX = (extra = {}) => ({ grid: { display: false }, border: { color: css("--axis") }, ...extra });
  const axisY = (extra = {}) => ({ grid: { color: css("--grid") }, border: { display: false }, beginAtZero: true, ...extra });

  // ---------- Render ----------
  function render() {
    charts.splice(0).forEach((c) => c.destroy());
    applyDefaults();

    const region = el("region-filter").value;
    const { from, to } = state;
    const scoped = region ? M.districts.filter((d) => d.region === region) : M.districts;
    const perDay = perDayTotals(scoped.map((d) => d.key));
    const prev = previousRange(from, to);
    const rangeDates = filledIn(from, to);
    const prevDates = filledIn(prev.from, prev.to);
    const districts = districtsOver(scoped, from, to);
    const prevDistricts = districtsOver(scoped, prev.from, prev.to);
    const heads = headsOver(perDay, from, to);
    const agg = {
      districts, heads, total: sum(heads), days: rangeDates.length,
      prevHeads: headsOver(perDay, prev.from, prev.to), prevDays: prevDates.length, prev,
      prevByKey: new Map(prevDistricts.map((d) => [d.key, d.total])),
    };
    const weekly = M.mode === "weekly";
    const trend = weeklyTrend(perDay, to);
    const scope = region ? `${region} region` : "Punjab";
    const groupColors = GROUPS.map((g) => css(g.color));
    const surface = css("--surface");

    el("range-sub").textContent = weekly
      ? `Week ${M.week}`
      : `${rangeLabel(from, to)} · ${agg.days} ${agg.days === 1 ? "day" : "days"} with data`;
    renderKpis(agg, trend);
    document.querySelectorAll(".group-legend").forEach((node) => {
      node.innerHTML = GROUPS.map((g) => `<span class="key"><i style="background:var(${g.color})"></i>${g.name}</span>`).join("");
    });

    // Cases by day (by week for long ranges); days without data are left empty.
    const byWeek = dayDiff(from, to) + 1 > 62;
    const buckets = weekly
      ? [{ label: M.week, dates: rangeDates }]
      : byWeek
        ? [...new Set(datesBetween(from, to).map(weekStart))].map((ws) => ({
            label: fmtDate(ws, false), title: `Week of ${fmtDate(ws)}`,
            dates: filledIn(ws < from ? from : ws, addDays(ws, 6) > to ? to : addDays(ws, 6)),
          }))
        : datesBetween(from, to).map((d) => ({
            label: dayDiff(from, to) < 14 ? `${DAYS[weekday(d)]} ${+d.slice(8)}` : fmtDate(d, false),
            title: `${DAY_NAMES[weekday(d)]} ${fmtDate(d)}`,
            dates: M.days.has(d) ? [d] : [],
          }));
    const bucketHeads = buckets.map((b) => (b.dates.length ? b.dates.reduce((acc, d) => addInto(acc, perDay.get(d)), zeros()) : null));
    document.querySelector("#daily-chart").closest(".card").querySelector("h2").textContent =
      weekly ? "Cases this week" : byWeek ? "Cases by week" : "Cases by day";
    chart("daily-chart", {
      type: "bar",
      data: {
        labels: buckets.map((b) => b.label),
        datasets: GROUPS.map((g, gi) => ({
          label: g.name,
          data: bucketHeads.map((bh) => (bh ? groupSum(bh, gi) : null)),
          backgroundColor: groupColors[gi],
          borderColor: surface,
          borderWidth: { top: 2 },
          borderSkipped: "bottom",
          borderRadius: gi === GROUPS.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
          maxBarThickness: 48,
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: axisX({ stacked: true, ticks: { color: (c) => (bucketHeads[c.index] ? css("--muted") : css("--axis")) } }),
          y: axisY({ stacked: true }),
        },
        plugins: {
          tooltip: {
            filter: (i) => i.raw != null,
            callbacks: {
              title: (items) => buckets[items[0].dataIndex].title || items[0].label,
              footer: (items) => {
                const b = buckets[items[0].dataIndex];
                return `Total: ${fmt(sum(items.map((i) => i.raw)))}${byWeek ? ` · ${b.dates.length} days with data` : ""}`;
              },
            },
          },
        },
      },
    });

    // Group share doughnut
    const groupTotals = GROUPS.map((_, gi) => groupSum(agg.heads, gi));
    chart("group-chart", {
      type: "doughnut",
      data: {
        labels: GROUPS.map((g) => g.name),
        datasets: [{ data: groupTotals, backgroundColor: groupColors, borderColor: surface, borderWidth: 2, hoverOffset: 6 }],
      },
      options: {
        cutout: "64%",
        layout: { padding: 8 },
        plugins: {
          legend: {
            display: true, position: "bottom",
            labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 10, color: css("--ink-2"), padding: 12 },
          },
          tooltip: { callbacks: { label: (i) => ` ${i.label}: ${fmt(i.raw)} (${pct(i.raw, agg.total)}%)` } },
          centerText: { value: fmt(agg.total), label: "cases" },
        },
      },
      plugins: [centerText],
    });

    // Crime heads ranked (only heads with cases)
    const ranked = HEADS.map((name, h) => ({ name, h, v: agg.heads[h] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    chart("heads-chart", {
      type: "bar",
      data: {
        labels: ranked.map((x) => x.name),
        datasets: [{
          data: ranked.map((x) => x.v),
          backgroundColor: ranked.map((x) => groupColors[headGroup[x.h]]),
          borderRadius: 4, borderSkipped: "start", barPercentage: 0.8, categoryPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: "y",
        layout: { padding: { right: 36 } },
        scales: { x: axisY(), y: axisX({ ticks: { color: css("--ink-2") } }) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (i) => M.headsFull[ranked[i[0].dataIndex].h],
              label: (i) => ` ${fmt(i.raw)} cases · ${GROUPS[headGroup[ranked[i.dataIndex].h]].name}`,
            },
          },
          endLabels: { values: ranked.map((x) => fmt(x.v)) },
        },
      },
      plugins: [endLabels],
    });

    // Top districts, stacked by group
    const top = [...districts].sort((a, b) => b.total - a.total).slice(0, 10);
    chart("district-chart", {
      type: "bar",
      data: {
        labels: top.map((d) => d.name),
        datasets: GROUPS.map((g, gi) => ({
          label: g.name,
          data: top.map((d) => groupSum(d.counts, gi)),
          backgroundColor: groupColors[gi],
          borderColor: surface,
          borderWidth: { right: 2 },
          borderSkipped: "left",
          borderRadius: gi === GROUPS.length - 1 ? { topRight: 4, bottomRight: 4 } : 0,
          barPercentage: 0.8, categoryPercentage: 0.9,
        })),
      },
      options: {
        indexAxis: "y",
        layout: { padding: { right: 36 } },
        interaction: { mode: "index", intersect: false, axis: "y" },
        scales: { x: axisY({ stacked: true }), y: axisX({ stacked: true, ticks: { color: css("--ink-2") } }) },
        plugins: {
          tooltip: {
            filter: (i) => i.raw > 0,
            callbacks: { footer: (items) => `Total: ${fmt(top[items[0].dataIndex].total)}` },
          },
          endLabels: { values: top.map((d) => fmt(d.total)) },
        },
      },
      plugins: [endLabels],
    });

    // This range vs the previous range of equal length: regions (or districts inside one region)
    const units = region
      ? districts.map((d) => ({ name: d.name, now: d.total, last: agg.prevByKey.get(d.key) || 0 }))
      : [...new Set(M.districts.map((d) => d.region))].map((r) => {
          const ds = districts.filter((d) => d.region === r);
          return { name: r, now: sum(ds.map((d) => d.total)), last: sum(ds.map((d) => agg.prevByKey.get(d.key) || 0)) };
        });
    units.sort((a, b) => b.now - a.now);
    const hasPrev = agg.prevDays > 0;
    const prevName = weekly ? "Last week" : `Previous ${prev.len} ${prev.len === 1 ? "day" : "days"}`;
    const nowName = weekly ? "This week" : "This range";
    document.querySelector("#region-chart").closest(".card").querySelector("h2").textContent =
      `${nowName} vs ${prevName.toLowerCase()}, ${region ? `${region} districts` : "by region"}`;
    el("compare-legend").innerHTML =
      `<span class="key"><i style="background:var(--series-1)"></i>${nowName} (${rangeLabel(from, to)})</span>` +
      (hasPrev
        ? `<span class="key"><i style="background:var(--compare)"></i>${prevName} (${rangeLabel(prev.from, prev.to)}, ${agg.prevDays} with data)</span>`
        : `<span class="key muted">No data for ${rangeLabel(prev.from, prev.to)}</span>`);
    chart("region-chart", {
      type: "bar",
      data: {
        labels: units.map((u) => u.name),
        datasets: [
          { label: nowName, data: units.map((u) => u.now), backgroundColor: css("--series-1"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.7 },
          ...(hasPrev ? [{ label: prevName, data: units.map((u) => u.last), backgroundColor: css("--compare"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.7 }] : []),
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: axisX({ ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } }), y: axisY() },
        plugins: {
          tooltip: {
            callbacks: {
              footer: (items) => {
                if (!hasPrev) return "";
                const u = units[items[0].dataIndex];
                const diff = u.now - u.last;
                return `Change: ${diff > 0 ? "▲ +" : diff < 0 ? "▼ " : ""}${fmt(diff)} (${u.last ? Math.round((diff / u.last) * 100) : 0}%)`;
              },
            },
          },
        },
      },
    });

    // Case progress (mock funnel)
    const stages = [
      ["FIRs registered", 1],
      ["Under investigation", 0.91],
      ["Accused arrested", 0.53],
      ["Challan submitted", 0.31],
    ].map(([name, r]) => ({ name, v: Math.round(agg.total * r) }));
    chart("funnel-chart", {
      type: "bar",
      data: {
        labels: stages.map((s) => s.name),
        datasets: [{
          data: stages.map((s) => s.v),
          backgroundColor: ["--seq-1", "--seq-2", "--seq-3", "--seq-4"].map(css),
          borderRadius: 4, borderSkipped: "start", barPercentage: 0.85, categoryPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: "y",
        layout: { padding: { right: 84 } },
        scales: { x: axisY({ ticks: { display: false }, grid: { display: false } }), y: axisX({ ticks: { color: css("--ink-2") } }) },
        plugins: {
          tooltip: { callbacks: { label: (i) => ` ${fmt(i.raw)} (${pct(i.raw, agg.total)}% of FIRs)` } },
          endLabels: { values: stages.map((s) => `${fmt(s.v)} · ${pct(s.v, agg.total)}%`) },
        },
      },
      plugins: [endLabels],
    });

    // Weekly trend (real totals; weeks touching the selected range get a marker)
    const trendVals = trend.map((w) => (w.heads ? sum(w.heads) : null));
    const inRange = trend.map((w) => w.start <= to && addDays(w.start, 6) >= from);
    // A week that runs past the latest data isn't finished yet: dash the line into it.
    const unfinished = trend.map((w) => addDays(w.start, 6) > M.filled[M.filled.length - 1]);
    const c1 = css("--series-1");
    chart("trend-chart", {
      type: "line",
      data: {
        labels: trend.map((w) => fmtDate(w.start, false)),
        datasets: [{
          label: "Total cases",
          data: trendVals,
          borderColor: c1,
          backgroundColor: (ctx) => {
            const { chartArea: a, ctx: g } = ctx.chart;
            if (!a) return "transparent";
            const grad = g.createLinearGradient(0, a.top, 0, a.bottom);
            grad.addColorStop(0, c1 + "40");
            grad.addColorStop(1, c1 + "00");
            return grad;
          },
          fill: true,
          borderWidth: 2,
          tension: 0.3,
          segment: { borderDash: (c) => (unfinished[c.p1DataIndex] ? [5, 4] : undefined) },
          pointRadius: trend.map((_, i) => (inRange[i] || trend.length === 1 ? 4 : 0)),
          pointBackgroundColor: c1,
          pointBorderColor: surface,
          pointBorderWidth: 2,
          pointHoverRadius: 6,
        }],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: axisX(), y: axisY({ beginAtZero: false, grace: "10%" }) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (i) => (weekly ? `Week ${M.week}` : `Week of ${fmtDate(trend[i[0].dataIndex].start)}`),
              label: (i) => ` ${fmt(i.raw)} cases${weekly ? "" : ` · ${trend[i.dataIndex].days} of 7 days with data${unfinished[i.dataIndex] ? " (week not over)" : ""}`}`,
            },
          },
        },
      },
    });

    renderInsights(agg, scope, rangeDates, perDay, weekly);
    renderHeatmap(agg, from, to);
    renderFeed(districts, region, rangeDates);
  }

  function sparkline(values, color) {
    const w = 120, h = 34, pad = 4;
    if (values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
    const min = Math.min(...values), max = Math.max(...values);
    const x = (i) => pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const lx = x(values.length - 1), ly = y(values[values.length - 1]);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${lx}" cy="${ly}" r="3" fill="${color}"/></svg>`;
  }

  function renderKpis(agg, trend) {
    const all = HEADS.map((_, h) => h);
    const tiles = [
      { label: "Total cases", heads: all, color: "--series-1" },
      { label: "Vehicle theft", heads: [12], color: "--series-1" },
      { label: "Robbery & snatching", heads: GROUPS[1].heads, color: "--series-2" },
      { label: "Women & child crimes", heads: GROUPS[2].heads, color: "--series-3" },
      { label: "Murders", heads: [0], color: "--series-4" },
      { label: "Cattle theft", heads: [19], color: "--series-5" },
    ];
    const vs = M.mode === "weekly" ? "last week" : "previous range";
    el("kpis").innerHTML = tiles.map((t) => {
      const now = sum(t.heads.map((h) => agg.heads[h]));
      const last = sum(t.heads.map((h) => agg.prevHeads[h]));
      const diff = now - last;
      const raw = last ? (diff / last) * 100 : 0;
      const p = Math.abs(raw) < 1 ? Math.abs(raw).toFixed(1) : Math.round(Math.abs(raw));
      const delta = !agg.prevDays
        ? `<span class="kpi-delta">No data for the ${vs}</span>`
        : diff === 0
          ? `<span class="kpi-delta">No change vs ${vs}</span>`
          : `<span class="kpi-delta"><b class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${p}%</b> vs ${vs} (${fmt(last)})</span>`;
      const hist = trend.filter((w) => w.heads).map((w) => sum(t.heads.map((h) => w.heads[h])));
      return `<div class="kpi" style="--accent:var(${t.color})">
        <div class="kpi-label">${t.label}</div>
        <div class="kpi-value">${fmt(now)}</div>
        ${delta}
        ${sparkline(hist, css(t.color))}
      </div>`;
    }).join("");
  }

  function renderInsights(agg, scope, rangeDates, perDay, weekly) {
    const items = [];
    const period = weekly ? "this week" : "this range";
    const topHead = HEADS.map((n, h) => ({ n, v: agg.heads[h] })).sort((a, b) => b.v - a.v)[0];
    items.push(["--series-1", "%", `<strong>${topHead.n}</strong> is the biggest crime head in ${esc(scope)}: <strong>${fmt(topHead.v)}</strong> cases, ${pct(topHead.v, agg.total)}% of ${period}'s total.`]);

    const ranked = [...agg.districts].sort((a, b) => b.total - a.total);
    if (ranked.length > 1 && ranked[1].total > 0) {
      const [a, b] = ranked;
      items.push(["--series-2", "1", `<strong>${esc(a.name)}</strong> recorded the most cases (<strong>${fmt(a.total)}</strong>, ${pct(a.total, agg.total)}%), ${(a.total / b.total).toFixed(1)}× the next district, ${esc(b.name)} (${fmt(b.total)}).`]);
    }

    const murders = agg.heads[0];
    const none = agg.districts.filter((d) => d.counts[0] === 0).length;
    items.push(["--series-4", "!", `<strong>${fmt(murders)} murders</strong> ${period}; ${none} of ${agg.districts.length} districts reported none.`]);

    const wc = groupSum(agg.heads, 2);
    items.push(["--series-3", "W", `<strong>${fmt(wc)}</strong> crimes against women and children, including <strong>${fmt(agg.heads[10])}</strong> child sexual abuse and <strong>${fmt(agg.heads[11])}</strong> rape/sodomy of minors.`]);

    if (agg.prevDays) {
      const movers = agg.districts.map((d) => ({ d, diff: d.total - (agg.prevByKey.get(d.key) || 0) })).sort((a, b) => b.diff - a.diff);
      if (movers[0] && movers[0].diff > 0) {
        items.push(["--series-5", "▲", `Biggest rise vs the previous ${agg.prev.len} days: <strong>${esc(movers[0].d.name)}</strong>, up ${fmt(movers[0].diff)} cases.`]);
      }
    }

    if (!weekly && rangeDates.length) {
      const daily = rangeDates.map((d) => sum(perDay.get(d)));
      const peak = daily.indexOf(Math.max(...daily));
      const blanks = dayDiff(state.from, state.to) + 1 - rangeDates.length;
      items.push(["--series-1", "◷", `<strong>${DAY_NAMES[weekday(rangeDates[peak])]} ${fmtDate(rangeDates[peak])}</strong> was the busiest day with ${fmt(daily[peak])} cases; the average is ${fmt(Math.round(sum(daily) / daily.length))} cases a day over ${rangeDates.length} ${rangeDates.length === 1 ? "day" : "days"} with data${blanks ? ` (${blanks} without data skipped)` : ""}.`]);
    }

    el("insights").innerHTML = items.map(([c, ico, text]) =>
      `<li><span class="ico" style="background:var(${c})" aria-hidden="true">${ico}</span><p>${text}</p></li>`).join("");
  }

  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function renderHeatmap(agg, from, to) {
    // Columns: heads with any case anywhere in Punjab over the range, so they don't jump when the region changes.
    const punjab = districtsOver(M.districts, from, to);
    const cols = HEADS.map((n, h) => h).filter((h) => sum(punjab.map((d) => d.counts[h])) > 0);
    const rows = [...agg.districts].sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.flatMap((d) => cols.map((h) => d.counts[h])));
    const steps = ["--seq-0", "--seq-1", "--seq-2", "--seq-3", "--seq-4"].map(css);
    const cell = (v, title) => {
      if (!v) return `<td class="zero" title="${title}: 0">·</td>`;
      const i = Math.min(steps.length - 1, Math.floor((Math.sqrt(v) / Math.sqrt(max)) * steps.length));
      const ink = luminance(steps[i]) > 0.35 ? "#0b0b0b" : "#ffffff";
      return `<td style="background:${steps[i]};color:${ink}" title="${title}: ${v}">${v}</td>`;
    };
    el("heatmap").innerHTML =
      `<thead><tr><th></th>${cols.map((h) => `<th title="${esc(M.headsFull[h])}"><span>${HEADS[h]}</span></th>`).join("")}<th><span>Total</span></th></tr></thead>
      <tbody>
        <tr class="total"><th>All shown</th>${cols.map((h) => `<td>${fmt(agg.heads[h])}</td>`).join("")}<td>${fmt(agg.total)}</td></tr>
        ${rows.map((d) => `<tr><th title="${esc([d.urdu, d.region].filter(Boolean).join(" · "))}">${esc(d.name)}</th>${cols.map((h) => cell(d.counts[h], `${esc(d.name)} · ${HEADS[h]}`)).join("")}<td><b>${fmt(d.total)}</b></td></tr>`).join("")}
      </tbody>`;
    el("scale-max").textContent = fmt(max);
  }

  function renderFeed(districts, region, rangeDates) {
    const r = mulberry32(hash((region || "all") + state.to));
    const TYPES = [
      { verb: "FIR registered", color: "--series-1" },
      { verb: "Accused arrested", color: "--series-3" },
      { verb: "Property recovered", color: "--series-4" },
      { verb: "Challan submitted", color: "--series-5" },
      { verb: "Gang busted", color: "--series-2" },
    ];
    const dates = rangeDates.length ? rangeDates.slice(-7) : [state.to];
    const events = [];
    let minutes = dates.length * 1440 - 20; // counting back from the last day, 23:40
    for (let i = 0; i < 16 && minutes > 0; i++) {
      const d = districts[pickWeighted(districts.map((x) => x.total || 0.1), r)];
      const h = pickWeighted(d.counts.map((c) => c || 0.01), r);
      const t = TYPES[pickWeighted([5, 3, 2, 1.5, 0.6], r)];
      const what = t.verb === "Property recovered"
        ? (h === 12 ? "Stolen vehicle recovered" : h === 19 ? "Stolen cattle recovered" : "Stolen property recovered")
        : `${t.verb} · ${HEADS[h]}`;
      const day = dates[Math.floor(minutes / 1440)], hh = Math.floor((minutes % 1440) / 60), mm = minutes % 60;
      events.push({ what, where: `${d.name}, ${d.region} region`, when: `${DAYS[weekday(day)]} ${fmtDate(day, false)}, ${pad2(hh)}:${pad2(mm)}`, color: t.color });
      minutes -= 20 + Math.floor(r() * 260);
    }
    el("feed").innerHTML = events.map((e) =>
      `<li><span class="dot" style="background:var(${e.color})" aria-hidden="true"></span>
        <div><div class="what">${esc(e.what)}</div><div class="meta">${esc(e.where)} · ${e.when}</div></div></li>`).join("");
  }

  // ---------- Date range picker ----------
  // Only dates with data can be picked; a range may span blank dates, which simply add nothing.
  const picker = { open: false, month: null, anchor: null, hover: null };

  function presets() {
    const last = M.filled[M.filled.length - 1];
    const seven = M.filled.slice(-7);
    return [
      { label: "Last 7 filled days", from: seven[0], to: last },
      { label: "This week (Mon–Sun)", from: weekStart(TODAY), to: addDays(weekStart(TODAY), 6) },
      { label: "This month", from: monthStart(TODAY), to: monthEnd(TODAY) },
      { label: "All dates", from: M.filled[0], to: last },
    ].map((p) => ({ ...p, days: filledIn(p.from, p.to).length }));
  }

  function setRange(from, to) {
    if (from > to) [from, to] = [to, from];
    state.from = from; state.to = to;
    el("range-label").textContent = rangeLabel(from, to);
    try { localStorage.setItem("range", JSON.stringify({ from, to })); } catch (e) {}
    render();
  }

  function renderPicker() {
    el("range-presets").innerHTML = presets().map((p, i) =>
      `<button type="button" data-preset="${i}" ${p.days ? "" : "disabled"} class="${p.from === state.from && p.to === state.to ? "on" : ""}">
        ${p.label}<small>${p.days ? `${p.days} ${p.days === 1 ? "day" : "days"} with data` : "No data"}</small></button>`).join("");

    const m = picker.month;
    el("cal-title").textContent = `${MONTH_NAMES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
    el("cal-prev").disabled = m <= monthStart(M.filled[0]);
    el("cal-next").disabled = m >= monthStart(M.filled[M.filled.length - 1]);

    let lo = state.from, hi = state.to;
    if (picker.anchor) {
      const other = picker.hover || picker.anchor;
      [lo, hi] = picker.anchor < other ? [picker.anchor, other] : [other, picker.anchor];
    }
    const cells = DAYS.map((d) => `<span class="dow">${d.slice(0, 2)}</span>`);
    for (let i = 0; i < weekday(m); i++) cells.push("<span></span>");
    datesBetween(m, monthEnd(m)).forEach((d) => {
      const filled = M.days.has(d);
      const cls = [
        d >= lo && d <= hi ? "in" : "",
        d === lo ? "start" : "",
        d === hi ? "end" : "",
        d === TODAY ? "today" : "",
      ].filter(Boolean).join(" ");
      cells.push(`<button type="button" class="day ${cls}" data-date="${d}" ${filled ? "" : "disabled"}
        aria-label="${DAY_NAMES[weekday(d)]} ${fmtDate(d)}${filled ? "" : ", no data"}"
        title="${filled ? "" : "No data for this date"}">${+d.slice(8)}</button>`);
    });
    el("cal-grid").innerHTML = cells.join("");
    el("cal-hint").textContent = picker.anchor
      ? `From ${fmtDate(picker.anchor)} — pick the end date`
      : "Pick a start date. Greyed-out dates have no data.";
  }

  function openPicker(open) {
    picker.open = open;
    picker.anchor = null; picker.hover = null;
    el("range-pop").hidden = !open;
    el("range-btn").setAttribute("aria-expanded", String(open));
    if (open) {
      picker.month = monthStart(state.to);
      renderPicker();
      const target = el("cal-grid").querySelector(".day.end:not([disabled])") || el("cal-grid").querySelector(".day:not([disabled])");
      if (target) target.focus();
    }
  }

  function initPicker() {
    if (M.mode === "weekly") {
      // The weekly workbook is a single range; nothing to choose.
      el("range-btn").disabled = true;
      el("range-btn").title = "The weekly workbook covers one week; connect the daily sheet for date ranges";
      el("range-label").textContent = M.week;
      return;
    }
    el("range-btn").addEventListener("click", () => openPicker(!picker.open));
    el("cal-prev").addEventListener("click", () => {
      picker.month = monthStart(addDays(picker.month, -1)); renderPicker();
    });
    el("cal-next").addEventListener("click", () => {
      picker.month = addDays(monthEnd(picker.month), 1); renderPicker();
    });
    el("range-presets").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-preset]");
      if (!b || b.disabled) return;
      const p = presets()[+b.dataset.preset];
      openPicker(false);
      setRange(p.from, p.to);
    });
    el("cal-grid").addEventListener("click", (e) => {
      const b = e.target.closest("button.day");
      if (!b || b.disabled) return;
      const d = b.dataset.date;
      if (!picker.anchor) {
        picker.anchor = d;
        renderPicker();
        const again = el("cal-grid").querySelector(`[data-date="${d}"]`);
        if (again) again.focus();
      } else {
        const a = picker.anchor;
        openPicker(false);
        setRange(a, d);
        el("range-btn").focus();
      }
    });
    el("cal-grid").addEventListener("mouseover", (e) => {
      const b = e.target.closest("button.day");
      if (!picker.anchor || !b || b.dataset.date === picker.hover) return;
      picker.hover = b.dataset.date;
      el("cal-grid").querySelectorAll("button.day").forEach((n) => {
        const d = n.dataset.date;
        const [lo, hi] = picker.anchor < picker.hover ? [picker.anchor, picker.hover] : [picker.hover, picker.anchor];
        n.classList.toggle("in", d >= lo && d <= hi);
        n.classList.toggle("start", d === lo);
        n.classList.toggle("end", d === hi);
      });
    });
    document.addEventListener("click", (e) => {
      // composedPath, not closest(): the clicked day may already have been replaced by a re-render.
      if (picker.open && !e.composedPath().includes(document.querySelector(".range-picker"))) openPicker(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && picker.open) { openPicker(false); el("range-btn").focus(); }
    });
  }

  // ---------- Status line, banner and Real/Mock pills ----------
  function renderStatus() {
    const pill = { live: ["pill-real", "Live"], weekly: ["pill-real", "Real"], mock: ["pill-mock", "Mock"] }[M.mode];
    document.querySelectorAll('.pill[data-src="data"]').forEach((p) => {
      p.className = `pill ${pill[0]}`;
      p.textContent = pill[1];
    });
    const banner = el("data-banner");
    if (M.mode === "mock") {
      banner.hidden = false;
      banner.className = "banner banner-mock";
      banner.innerHTML = `<strong>Mock data</strong> ${esc(M.problem)} Every figure on this page is generated sample data; dates with no data are left blank on purpose. See the README to connect the daily sheet.`;
    } else if (M.problem) {
      banner.hidden = false;
      banner.className = "banner banner-warn";
      banner.innerHTML = `<strong>Offline copy</strong> ${esc(M.problem)} Showing the weekly workbook from <code>assets/data.js</code> instead.`;
    } else {
      banner.hidden = true;
    }
    const src = esc(M.source || "the daily sheet");
    el("notice").innerHTML = M.mode === "live"
      ? `<span class="pill pill-real">Live</span> daily district &amp; crime-head figures from <code>${src}</code>, summed over the dates you pick.${M.warnings ? ` The sheet reader reported ${M.warnings} warning${M.warnings === 1 ? "" : "s"} (see the browser console).` : ""}
         <span class="pill pill-mock">Mock</span> case progress and the activity feed are sample data.`
      : M.mode === "weekly"
        ? `<span class="pill pill-real">Real</span> district &amp; crime-head totals for one week from <code>${src}</code>; no daily breakdown or earlier weeks.
           <span class="pill pill-mock">Mock</span> case progress and the activity feed are sample data.`
        : `<span class="pill pill-mock">Mock</span> all figures are generated sample data.`;
  }

  // ---------- Wire up ----------
  function init(model) {
    M = model;
    renderStatus();

    const regionSelect = el("region-filter");
    [...new Set(M.districts.map((d) => d.region))].sort().forEach((r) => regionSelect.add(new Option(r, r)));
    try { regionSelect.value = localStorage.getItem("region") || ""; } catch (e) {}
    if (regionSelect.selectedIndex < 0) regionSelect.value = "";
    regionSelect.addEventListener("change", () => {
      try { localStorage.setItem("region", regionSelect.value); } catch (e) {}
      render();
    });

    // Start from the remembered range if it still has data, else the last 7 filled days.
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("range") || "null"); } catch (e) {}
    const valid = (r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && filledIn(r.from, r.to).length;
    const start = M.mode === "weekly" ? { from: M.filled[0], to: M.filled[0] } : valid(saved) ? saved : presets()[0];
    state.from = start.from; state.to = start.to;
    el("range-label").textContent = rangeLabel(state.from, state.to);
    initPicker();

    el("theme-toggle").addEventListener("click", () => {
      const root = document.documentElement;
      const isDark = root.dataset.theme
        ? root.dataset.theme === "dark"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = isDark ? "light" : "dark";
      try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
      render();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

    render();
  }

  loadData().then(init).catch((e) => {
    console.error(e);
    document.querySelector("main").innerHTML =
      `<p class="card" style="grid-column:1/-1">The dashboard failed to start: ${esc(e.message || e)}</p>`;
  });
})();
