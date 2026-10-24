(() => {
  const D = window.CRIME_DATA;
  if (!D) {
    document.querySelector("main").innerHTML =
      '<p class="card" style="grid-column:1/-1">No data loaded. Run <code>python scripts/extract_data.py "&lt;week .xlsx&gt;" "&lt;week label&gt;"</code> to create <code>assets/data.js</code>, then reload.</p>';
    return;
  }
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const WEEK_LABELS = ["24 Aug", "31 Aug", "7 Sep", "14 Sep", "21 Sep", "28 Sep", "5 Oct", "12 Oct"];

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

  // ---------- Mock data (deterministic, seeded) ----------
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
  const rand = mulberry32(20261012);
  function pickWeighted(weights, r = rand) {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }

  const DAY_WEIGHT = [1.0, 0.95, 0.9, 1.0, 1.1, 1.25, 0.85];
  D.districts.forEach((d) => {
    d.total = d.counts.reduce((a, b) => a + b, 0);
    d.daily = d.counts.map((c) => {
      const days = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < c; i++) days[pickWeighted(DAY_WEIGHT)]++;
      return days;
    });
    d.lastWeek = d.counts.map((c) =>
      Math.max(0, Math.round(c * (0.75 + rand() * 0.5)) + (rand() < 0.12 ? 1 : 0)));
  });
  // Per-group multipliers for the six weeks before last week (relative to this week).
  const WEEK_FACTORS = Array.from({ length: 6 }, (_, w) =>
    GROUPS.map(() => 0.82 + w * 0.02 + rand() * 0.22));

  // ---------- Helpers ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (n) => n.toLocaleString("en-US");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const el = (id) => document.getElementById(id);

  function aggregate(districts) {
    const heads = D.heads.map((_, h) => sum(districts.map((d) => d.counts[h])));
    const lastHeads = D.heads.map((_, h) => sum(districts.map((d) => d.lastWeek[h])));
    const dailyHeads = D.heads.map((_, h) => DAYS.map((_, i) => sum(districts.map((d) => d.daily[h][i]))));
    return { districts, heads, lastHeads, dailyHeads, total: sum(heads), lastTotal: sum(lastHeads) };
  }
  const groupSum = (headVals, g) => sum(GROUPS[g].heads.map((h) => headVals[h]));

  // 8-week history for a set of heads: 6 mock weeks, mock last week, real this week.
  function history(agg, heads) {
    const weeks = WEEK_FACTORS.map((f) => Math.round(sum(heads.map((h) => agg.heads[h] * f[headGroup[h]]))));
    weeks.push(sum(heads.map((h) => agg.lastHeads[h])));
    weeks.push(sum(heads.map((h) => agg.heads[h])));
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
    const districts = region ? D.districts.filter((d) => d.region === region) : D.districts;
    const agg = aggregate(districts);
    const scope = region ? `${region} region` : "Punjab";
    const groupColors = GROUPS.map((g) => css(g.color));
    const surface = css("--surface");

    renderKpis(agg);
    document.querySelectorAll(".group-legend").forEach((node) => {
      node.innerHTML = GROUPS.map((g) => `<span class="key"><i style="background:var(${g.color})"></i>${g.name}</span>`).join("");
    });

    // Daily stacked bars
    chart("daily-chart", {
      type: "bar",
      data: {
        labels: DAYS.map((d, i) => `${d} ${12 + i}`),
        datasets: GROUPS.map((g, gi) => ({
          label: g.name,
          data: DAYS.map((_, i) => sum(g.heads.map((h) => agg.dailyHeads[h][i]))),
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
        scales: { x: axisX({ stacked: true }), y: axisY({ stacked: true }) },
        plugins: {
          tooltip: {
            callbacks: {
              footer: (items) => `Total: ${fmt(sum(items.map((i) => i.raw)))}`,
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
    const heads = D.heads.map((name, h) => ({ name, h, v: agg.heads[h] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    chart("heads-chart", {
      type: "bar",
      data: {
        labels: heads.map((x) => x.name),
        datasets: [{
          data: heads.map((x) => x.v),
          backgroundColor: heads.map((x) => groupColors[headGroup[x.h]]),
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
              title: (i) => D.headsFull[heads[i[0].dataIndex].h],
              label: (i) => ` ${fmt(i.raw)} cases · ${GROUPS[headGroup[heads[i.dataIndex].h]].name}`,
            },
          },
          endLabels: { values: heads.map((x) => fmt(x.v)) },
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

    // This week vs last week: regions (or districts inside one region)
    const units = region
      ? districts.map((d) => ({ name: d.name, now: d.total, last: sum(d.lastWeek) }))
      : [...new Set(D.districts.map((d) => d.region))].map((r) => {
          const ds = D.districts.filter((d) => d.region === r);
          return { name: r, now: sum(ds.map((d) => d.total)), last: sum(ds.map((d) => sum(d.lastWeek))) };
        });
    units.sort((a, b) => b.now - a.now);
    document.querySelector("#region-chart").closest(".card").querySelector("h2").textContent =
      region ? `This week vs last week, ${region} districts` : "This week vs last week, by region";
    chart("region-chart", {
      type: "bar",
      data: {
        labels: units.map((u) => u.name),
        datasets: [
          { label: "This week", data: units.map((u) => u.now), backgroundColor: css("--series-1"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.7 },
          { label: "Last week", data: units.map((u) => u.last), backgroundColor: css("--compare"), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.7 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: axisX({ ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } }), y: axisY() },
        plugins: {
          tooltip: {
            callbacks: {
              footer: (items) => {
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

    // 8-week trend
    const trend = history(agg, D.heads.map((_, h) => h));
    const c1 = css("--series-1");
    chart("trend-chart", {
      type: "line",
      data: {
        labels: WEEK_LABELS,
        datasets: [{
          label: "Total cases",
          data: trend,
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
          pointRadius: trend.map((_, i) => (i === trend.length - 1 ? 5 : 0)),
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
              title: (i) => `Week of ${i[0].label}`,
              label: (i) => ` ${fmt(i.raw)} cases${i.dataIndex === trend.length - 1 ? " (real)" : " (mock)"}`,
            },
          },
        },
      },
    });

    renderInsights(agg, scope, trend);
    renderHeatmap(agg);
    renderFeed(districts, region);
  }

  function sparkline(values, color) {
    const w = 120, h = 34, pad = 4;
    const min = Math.min(...values), max = Math.max(...values);
    const x = (i) => pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const lx = x(values.length - 1), ly = y(values[values.length - 1]);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${lx}" cy="${ly}" r="3" fill="${color}"/></svg>`;
  }

  function renderKpis(agg) {
    const all = D.heads.map((_, h) => h);
    const tiles = [
      { label: "Total cases", heads: all, color: "--series-1" },
      { label: "Vehicle theft", heads: [12], color: "--series-1" },
      { label: "Robbery & snatching", heads: GROUPS[1].heads, color: "--series-2" },
      { label: "Women & child crimes", heads: GROUPS[2].heads, color: "--series-3" },
      { label: "Murders", heads: [0], color: "--series-4" },
      { label: "Cattle theft", heads: [19], color: "--series-5" },
    ];
    el("kpis").innerHTML = tiles.map((t) => {
      const hist = history(agg, t.heads);
      const now = hist[hist.length - 1], last = hist[hist.length - 2];
      const diff = now - last;
      const raw = last ? (diff / last) * 100 : 0;
      const p = Math.abs(raw) < 1 ? Math.abs(raw).toFixed(1) : Math.round(Math.abs(raw));
      const delta = diff === 0
        ? `<span class="kpi-delta">No change vs last week</span>`
        : `<span class="kpi-delta"><b class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${p}%</b> vs last week (${fmt(last)})</span>`;
      return `<div class="kpi" style="--accent:var(${t.color})">
        <div class="kpi-label">${t.label}</div>
        <div class="kpi-value">${fmt(now)}</div>
        ${delta}
        ${sparkline(hist, css(t.color))}
      </div>`;
    }).join("");
  }

  function renderInsights(agg, scope, trend) {
    const items = [];
    const topHead = D.heads.map((n, h) => ({ n, v: agg.heads[h] })).sort((a, b) => b.v - a.v)[0];
    items.push(["--series-1", "%", `<strong>${topHead.n}</strong> is the biggest crime head in ${scope}: <strong>${fmt(topHead.v)}</strong> cases, ${pct(topHead.v, agg.total)}% of the week's total.`]);

    const ranked = [...agg.districts].sort((a, b) => b.total - a.total);
    if (ranked.length > 1) {
      const [a, b] = ranked;
      items.push(["--series-2", "1", `<strong>${a.name}</strong> recorded the most cases (<strong>${fmt(a.total)}</strong>, ${pct(a.total, agg.total)}%), ${(a.total / b.total).toFixed(1)}× the next district, ${b.name} (${fmt(b.total)}).`]);
    }

    const murders = agg.heads[0];
    const none = agg.districts.filter((d) => d.counts[0] === 0).length;
    items.push(["--series-4", "!", `<strong>${fmt(murders)} murders</strong> this week; ${none} of ${agg.districts.length} districts reported none.`]);

    const wc = groupSum(agg.heads, 2);
    items.push(["--series-3", "W", `<strong>${fmt(wc)}</strong> crimes against women and children, including <strong>${fmt(agg.heads[10])}</strong> child sexual abuse and <strong>${fmt(agg.heads[11])}</strong> rape/sodomy of minors.`]);

    const movers = agg.districts.map((d) => ({ d, diff: d.total - sum(d.lastWeek) })).sort((a, b) => b.diff - a.diff);
    if (movers[0] && movers[0].diff > 0) {
      items.push(["--series-5", "▲", `Biggest week-on-week rise: <strong>${movers[0].d.name}</strong>, up ${fmt(movers[0].diff)} cases. <em>(vs mock last week)</em>`]);
    }

    const daily = DAYS.map((_, i) => sum(agg.dailyHeads.map((hd) => hd[i])));
    const peak = daily.indexOf(Math.max(...daily));
    items.push(["--series-1", "◷", `<strong>${DAY_NAMES[peak]}</strong> was the busiest day with ${fmt(daily[peak])} cases; the 8-week average is ${fmt(Math.round(sum(trend) / trend.length))} cases a week. <em>(mock)</em>`]);

    el("insights").innerHTML = items.map(([c, ico, text]) =>
      `<li><span class="ico" style="background:var(${c})" aria-hidden="true">${ico}</span><p>${text}</p></li>`).join("");
  }

  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function renderHeatmap(agg) {
    const cols = D.heads.map((n, h) => h).filter((h) => sum(D.districts.map((d) => d.counts[h])) > 0);
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
      `<thead><tr><th></th>${cols.map((h) => `<th title="${D.headsFull[h]}"><span>${D.heads[h]}</span></th>`).join("")}<th><span>Total</span></th></tr></thead>
      <tbody>
        <tr class="total"><th>All shown</th>${cols.map((h) => `<td>${fmt(agg.heads[h])}</td>`).join("")}<td>${fmt(agg.total)}</td></tr>
        ${rows.map((d) => `<tr><th title="${d.urdu} · ${d.region}">${d.name}</th>${cols.map((h) => cell(d.counts[h], `${d.name} · ${D.heads[h]}`)).join("")}<td><b>${fmt(d.total)}</b></td></tr>`).join("")}
      </tbody>`;
    el("scale-max").textContent = fmt(max);
  }

  function renderFeed(districts, region) {
    const r = mulberry32(hash(region || "all"));
    const TYPES = [
      { verb: "FIR registered", color: "--series-1" },
      { verb: "Accused arrested", color: "--series-3" },
      { verb: "Property recovered", color: "--series-4" },
      { verb: "Challan submitted", color: "--series-5" },
      { verb: "Gang busted", color: "--series-2" },
    ];
    const events = [];
    let minutes = 6 * 24 * 60 + 23 * 60 + 40; // Sun 23:40, counting back
    for (let i = 0; i < 16; i++) {
      const d = districts[pickWeighted(districts.map((x) => x.total || 0.1), r)];
      const h = pickWeighted(d.counts.map((c) => c || 0.01), r);
      const t = TYPES[pickWeighted([5, 3, 2, 1.5, 0.6], r)];
      const what = t.verb === "Property recovered"
        ? (h === 12 ? "Stolen vehicle recovered" : h === 19 ? "Stolen cattle recovered" : "Stolen property recovered")
        : `${t.verb} · ${D.heads[h]}`;
      const day = Math.floor(minutes / 1440), hh = Math.floor((minutes % 1440) / 60), mm = minutes % 60;
      events.push({ what, where: `${d.name}, ${d.region} region`, when: `${DAYS[day]} ${12 + day} Oct, ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, color: t.color });
      minutes -= 20 + Math.floor(r() * 260);
    }
    el("feed").innerHTML = events.map((e) =>
      `<li><span class="dot" style="background:var(${e.color})" aria-hidden="true"></span>
        <div><div class="what">${e.what}</div><div class="meta">${e.where} · ${e.when}</div></div></li>`).join("");
  }

  // ---------- Wire up ----------
  el("week-label").textContent = D.week;
  el("source-file").textContent = D.source;
  const regionSelect = el("region-filter");
  [...new Set(D.districts.map((d) => d.region))].sort().forEach((r) => regionSelect.add(new Option(r, r)));
  try { regionSelect.value = localStorage.getItem("region") || ""; } catch (e) {}
  regionSelect.addEventListener("change", () => {
    try { localStorage.setItem("region", regionSelect.value); } catch (e) {}
    render();
  });

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
})();
