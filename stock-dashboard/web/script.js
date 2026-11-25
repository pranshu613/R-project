const $ = (selector) => document.querySelector(selector);

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeMoney = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const pages = ["overview", "detail", "compare", "calculator"];
const pageTitles = { overview: "Overview", detail: "Stock detail", compare: "Compare", calculator: "Calculator" };
const ranges = { "3M": 63, "6M": 126, "1Y": 252, All: Infinity };
const rangeWords = { "3M": "the last 3 months", "6M": "the last 6 months", "1Y": "the last year", All: "the whole period" };

const overviewColumns = [
  { key: "symbol", label: "Stock" },
  { key: "latest_price", label: "Price" },
  { key: "day_change_pct", label: "1 day" },
  { key: "return_1y_pct", label: "1 year" },
  { key: "volatility_pct", label: "Volatility" },
  { key: "max_drawdown_pct", label: "Worst drop" },
  { key: "sharpe", label: "Sharpe" },
  { key: "rank_return", label: "Rank" },
  { key: null, label: "Last 90 days" },
];

const state = {
  page: "overview",
  sortKey: "rank_return",
  sortDirection: 1,
  symbol: null,
  detailRange: "1Y",
  showAverage20: true,
  showAverage50: true,
  compareA: null,
  compareB: null,
  compareRange: "1Y",
  calcMode: "sip",
};

let data = null;
const stocksBySymbol = {};
const charts = {};


function toDate(text) {
  return new Date(text + "T00:00:00");
}

function readColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeHtml(text) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, (character) => replacements[character]);
}

function isMissing(value) {
  return value == null || !isFinite(value);
}

function formatNumber(value, digits = 1) {
  return value.toFixed(digits).replace("-", "−");
}

function percent(value) {
  return isMissing(value) ? "–" : formatNumber(value) + "%";
}

function signedPercent(value) {
  return (value > 0 ? "+" : "") + formatNumber(value) + "%";
}

function change(value) {
  if (isMissing(value)) return "–";
  const isUp = value >= 0;
  const arrow = isUp ? "▲" : "▼";
  const word = isUp ? " gain" : " loss";
  return `<span class="${isUp ? "up" : "down"}"><span aria-hidden="true">${arrow}</span> ${formatNumber(Math.abs(value))}%<span class="sr-only">${word}</span></span>`;
}

function shortMoney(value) {
  const trim = (number, digits) => String(parseFloat(number.toFixed(digits)));
  if (value >= 1e7) return "₹" + trim(value / 1e7, 2) + " Cr";
  if (value >= 1e5) return "₹" + trim(value / 1e5, 1) + " L";
  if (value >= 1e3) return "₹" + trim(value / 1e3, 0) + "K";
  return "₹" + Math.round(value);
}

function stockColor(symbol) {
  const index = data.stocks.findIndex((stock) => stock.symbol === symbol);
  return "--series-" + Math.min(index + 1, 8);
}

function firstIndexForRange(length, range) {
  if (ranges[range] === Infinity) return 0;
  return Math.max(0, length - 1 - ranges[range]);
}

function statBox(label, value, hint) {
  return `<div class="stat"><dt>${label}</dt><dd><span class="stat-value">${value}</span><span class="stat-hint">${hint}</span></dd></div>`;
}

function legendItem(label, color, lineStyle = "") {
  return `<span class="legend-item"><i class="swatch ${lineStyle}" style="--color:var(${color})"></i>${escapeHtml(label)}</span>`;
}

function makeTable(headers, rows) {
  const head = headers.map((header) => `<th scope="col">${header}</th>`).join("");
  const body = rows.map((row) => {
    const cells = row.slice(1).map((cell) => `<td>${cell}</td>`).join("");
    return `<tr><th scope="row">${row[0]}</th>${cells}</tr>`;
  }).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function makeLongTable(headers, rows) {
  const limit = 120;
  const note = rows.length > limit ? `<p>Showing the latest ${limit} of ${rows.length} days.</p>` : "";
  return makeTable(headers, rows.slice(0, limit)) + note;
}

function makeButtons(container, options, selected, onPick) {
  container.innerHTML = "";
  for (const option of options) {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(value === selected));
    button.addEventListener("click", () => {
      for (const other of container.children) {
        other.setAttribute("aria-pressed", String(other === button));
      }
      onPick(value);
    });
    container.appendChild(button);
  }
}

function fillSelect(select) {
  select.innerHTML = data.stocks
    .map((stock) => `<option value="${escapeHtml(stock.symbol)}">${escapeHtml(stock.symbol)} · ${escapeHtml(stock.name)}</option>`)
    .join("");
}


function tickValues(min, max, wanted) {
  const rough = (max - min) / wanted;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  const step = (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10) * power;

  const ticks = [];
  for (let n = Math.ceil(min / step); n * step <= max + step * 1e-9; n++) {
    ticks.push(n * step);
  }
  return ticks;
}

class LineChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.box = canvas.parentElement;
    this.tooltip = this.box.querySelector(".tooltip");
    this.options = null;
    this.hoverIndex = null;

    canvas.addEventListener("pointermove", (event) => this.onPointer(event));
    canvas.addEventListener("pointerdown", (event) => this.onPointer(event));
    canvas.addEventListener("pointerleave", () => {
      this.hoverIndex = null;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(this.box);
  }

  show(options) {
    this.options = options;
    this.hoverIndex = null;
    this.draw();
  }

  onPointer(event) {
    if (!this.options) return;
    const rect = this.canvas.getBoundingClientRect();
    const fraction = (event.clientX - rect.left - this.left) / this.plotWidth;
    const last = this.options.labels.length - 1;
    this.hoverIndex = Math.max(0, Math.min(last, Math.round(fraction * last)));
    this.draw();
  }

  xFor(index) {
    const last = this.options.labels.length - 1;
    return this.left + (index / last) * this.plotWidth;
  }

  yFor(value) {
    return this.top + (1 - (value - this.min) / (this.max - this.min)) * this.plotHeight;
  }

  draw() {
    if (!this.options) return;
    const width = Math.floor(this.box.clientWidth);
    if (width < 80) return;

    this.setUpCanvas(width);
    this.measure(width);
    this.drawGrid();
    this.drawBottomLabels();
    this.options.series.forEach((series) => this.drawLine(series));
    if (this.showEndLabels) this.drawEndLabels();

    if (this.hoverIndex === null) {
      this.tooltip.hidden = true;
    } else {
      this.drawHover(width);
    }
  }

  setUpCanvas(width) {
    const height = this.options.height || 300;
    const ratio = window.devicePixelRatio || 1;

    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.canvas.setAttribute("aria-label", this.options.description);

    this.ctx = this.canvas.getContext("2d");
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.height = height;
  }

  measure(width) {
    const options = this.options;
    this.showEndLabels = options.endLabels !== false && options.series.length <= 4;

    const rightPadding = options.rightPadding ?? (this.showEndLabels ? 88 : 16);
    this.left = 62;
    this.top = 12;
    this.plotWidth = width - this.left - rightPadding;
    this.plotHeight = this.height - this.top - 28;

    let lowest = Infinity;
    let highest = -Infinity;
    for (const series of options.series) {
      for (const value of series.values) {
        if (isMissing(value)) continue;
        lowest = Math.min(lowest, value);
        highest = Math.max(highest, value);
      }
    }

    const spread = highest - lowest || 2;
    this.min = options.min ?? lowest - spread * 0.08;
    this.max = options.max ?? highest + spread * 0.08;
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (const tick of tickValues(this.min, this.max, 5)) {
      const y = Math.round(this.yFor(tick)) + 0.5;
      ctx.strokeStyle = readColor("--line");
      ctx.beginPath();
      ctx.moveTo(this.left, y);
      ctx.lineTo(this.left + this.plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = readColor("--muted");
      ctx.fillText(this.options.formatValue(tick), this.left - 8, y);
    }
  }

  drawBottomLabels() {
    const ctx = this.ctx;
    const count = this.options.labels.length;
    const labelCount = Math.min(count, Math.max(2, Math.min(6, Math.floor(this.plotWidth / 110))));

    ctx.fillStyle = readColor("--muted");
    ctx.textBaseline = "top";

    for (let k = 0; k < labelCount; k++) {
      const index = Math.round((k * (count - 1)) / (labelCount - 1));
      ctx.textAlign = k === 0 ? "left" : k === labelCount - 1 ? "right" : "center";
      ctx.fillText(this.options.formatLabel(index), this.xFor(index), this.top + this.plotHeight + 8);
    }
  }

  drawLine(series) {
    const ctx = this.ctx;
    const color = readColor(series.color);

    if (series.fill) this.drawFill(series, color);

    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.setLineDash(series.dash || []);
    ctx.beginPath();

    let isDrawing = false;
    series.values.forEach((value, index) => {
      if (value == null) {
        isDrawing = false;
        return;
      }
      if (isDrawing) {
        ctx.lineTo(this.xFor(index), this.yFor(value));
      } else {
        ctx.moveTo(this.xFor(index), this.yFor(value));
      }
      isDrawing = true;
    });

    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawFill(series, color) {
    const ctx = this.ctx;
    const baseline = this.yFor(this.options.fillTo ?? this.min);
    const last = series.values.length - 1;

    ctx.beginPath();
    ctx.moveTo(this.xFor(0), baseline);
    series.values.forEach((value, index) => ctx.lineTo(this.xFor(index), this.yFor(value)));
    ctx.lineTo(this.xFor(last), baseline);
    ctx.closePath();

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawEndLabels() {
    const ctx = this.ctx;
    const labels = [];

    for (const series of this.options.series) {
      let last = series.values.length - 1;
      while (last >= 0 && series.values[last] == null) last--;
      if (last >= 0) {
        labels.push({ y: this.yFor(series.values[last]), text: series.shortName || series.name });
      }
    }

    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
    }

    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = readColor("--ink-soft");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const label of labels) {
      ctx.fillText(label.text, this.left + this.plotWidth + 8, label.y);
    }
  }

  drawHover(width) {
    const ctx = this.ctx;
    const index = this.hoverIndex;
    const x = this.xFor(index);

    ctx.lineWidth = 1;
    ctx.strokeStyle = readColor("--muted");
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, this.top);
    ctx.lineTo(Math.round(x) + 0.5, this.top + this.plotHeight);
    ctx.stroke();

    const rows = [];
    for (const series of this.options.series) {
      const value = series.values[index];
      if (value == null) continue;

      ctx.beginPath();
      ctx.arc(x, this.yFor(value), 5, 0, Math.PI * 2);
      ctx.fillStyle = readColor(series.color);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = readColor("--surface");
      ctx.stroke();

      const text = series.formatTip ? series.formatTip(value, index) : this.options.formatValue(value);
      rows.push({ name: series.name, color: series.color, text });
    }

    this.showTooltip(x, width, this.options.formatTitle(index), rows);
  }

  showTooltip(x, width, title, rows) {
    const rowsHtml = rows.map((row) => `
      <div class="tooltip-row">
        <span class="dot" style="--color:var(${row.color})"></span>
        <span>${escapeHtml(row.name)}</span>
        <strong>${escapeHtml(row.text)}</strong>
      </div>`).join("");

    this.tooltip.innerHTML = `<div class="tooltip-title">${escapeHtml(title)}</div>${rowsHtml}`;
    this.tooltip.hidden = false;

    const tooltipWidth = this.tooltip.offsetWidth;
    let left = x + 14;
    if (left + tooltipWidth > width - 4) left = x - tooltipWidth - 14;
    this.tooltip.style.left = Math.max(4, left) + "px";
  }
}

function drawSparkline(canvas, values, color) {
  const width = 96;
  const height = 28;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const lowest = Math.min(...values);
  const highest = Math.max(...values);

  ctx.strokeStyle = readColor(color);
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = 2 + (index / (values.length - 1)) * (width - 4);
    const y = 3 + (1 - (value - lowest) / (highest - lowest || 1)) * (height - 6);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}


function renderOverview() {
  const stocks = data.stocks;
  const best = stocks.find((stock) => stock.rank_return === 1);
  const bestSharpe = stocks.find((stock) => stock.rank_sharpe === 1);
  const bumpiest = stocks.reduce((a, b) => (b.volatility_pct > a.volatility_pct ? b : a));

  $("#overview-summary").textContent =
    `Over the last year ${best.symbol} returned ${signedPercent(best.return_1y_pct)}, the best of ${stocks.length} stocks. ` +
    `${bumpiest.symbol} had the bumpiest ride, swinging about ${percent(bumpiest.volatility_pct)} a year. ` +
    `For the risk taken, ${bestSharpe.symbol} did best, with a Sharpe ratio of ${bestSharpe.sharpe.toFixed(2)}.`;

  renderStockTable();
  renderHeatmap();
}

function renderStockTable() {
  const { sortKey, sortDirection } = state;

  $("#stock-table thead").innerHTML = "<tr>" + overviewColumns.map((column) => {
    if (!column.key) return `<th scope="col">${column.label}</th>`;
    const sort = column.key === sortKey ? (sortDirection > 0 ? "ascending" : "descending") : "none";
    return `<th scope="col" aria-sort="${sort}"><button type="button" data-sort="${column.key}">${column.label}</button></th>`;
  }).join("") + "</tr>";

  const sorted = [...data.stocks].sort((a, b) => {
    if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol) * sortDirection;
    return (a[sortKey] - b[sortKey]) * sortDirection;
  });

  $("#stock-table tbody").innerHTML = sorted.map((stock) => `
    <tr>
      <th scope="row">
        <div class="stock" style="--color:var(${stockColor(stock.symbol)})">
          <span class="dot" aria-hidden="true"></span>
          <div>
            <button type="button" data-open="${escapeHtml(stock.symbol)}">${escapeHtml(stock.symbol)}</button>
            <small>${escapeHtml(stock.name)}</small>
          </div>
        </div>
      </th>
      <td>${money.format(stock.latest_price)}</td>
      <td>${change(stock.day_change_pct)}</td>
      <td>${change(stock.return_1y_pct)}</td>
      <td>${percent(stock.volatility_pct)}</td>
      <td>${percent(stock.max_drawdown_pct)}</td>
      <td>${formatNumber(stock.sharpe, 2)}</td>
      <td>#${stock.rank_return}</td>
      <td><canvas class="sparkline" data-symbol="${escapeHtml(stock.symbol)}" aria-hidden="true"></canvas></td>
    </tr>`).join("");

  document.querySelectorAll(".sparkline").forEach((canvas) => {
    const symbol = canvas.dataset.symbol;
    drawSparkline(canvas, data.series[symbol].close.slice(-90), stockColor(symbol));
  });
}

function renderHeatmap() {
  const { symbols, matrix } = data.correlation;

  const header = "<thead><tr><td></td>" + symbols.map((symbol) => `<th scope="col">${escapeHtml(symbol)}</th>`).join("") + "</tr></thead>";

  const rows = symbols.map((rowSymbol, i) => {
    const cells = matrix[i].map((value, j) => {
      let background = "var(--line-soft)";
      if (i !== j) {
        const color = value >= 0 ? "--heat-up" : "--heat-down";
        background = `color-mix(in srgb, var(${color}) ${Math.round(Math.abs(value) * 70)}%, var(--surface))`;
      }
      return `<td style="background:${background}">${formatNumber(value, 2)}</td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(rowSymbol)}</th>${cells}</tr>`;
  }).join("");

  $("#heatmap").innerHTML = header + `<tbody>${rows}</tbody>`;
}


function renderDetail() {
  const stock = stocksBySymbol[state.symbol];
  const series = data.series[stock.symbol];
  const riskFree = Math.round(data.meta.risk_free_rate * 100);
  const color = stockColor(stock.symbol);

  $("#detail-select").value = stock.symbol;
  $("#detail-intro").textContent = `${stock.name}. Latest close on ${dayFormat.format(toDate(stock.latest_date))}.`;

  $("#detail-stats").innerHTML =
    statBox("Latest close", money.format(stock.latest_price), `1 day: ${change(stock.day_change_pct)}`) +
    statBox("1-year return", change(stock.return_1y_pct), "Price change over 252 trading days") +
    statBox("Volatility", percent(stock.volatility_pct), "Typical swing over a year") +
    statBox("Worst drop", percent(stock.max_drawdown_pct), "Deepest fall from a previous high") +
    statBox("Sharpe ratio", formatNumber(stock.sharpe, 2), `Return per unit of risk, with ${riskFree}% risk-free`);

  const first = firstIndexForRange(series.dates.length, state.detailRange);
  const dates = series.dates.slice(first);
  const close = series.close.slice(first);
  const average20 = series.ma20.slice(first);
  const average50 = series.ma50.slice(first);
  const drawdown = series.drawdown_pct.slice(first);

  $("#detail-legend").innerHTML =
    legendItem(`${stock.symbol} closing price`, color) +
    `<button type="button" class="legend-item" data-average="showAverage20" aria-pressed="${state.showAverage20}"><i class="swatch dashed" style="--color:var(--ink-soft)"></i>20-day average</button>` +
    `<button type="button" class="legend-item" data-average="showAverage50" aria-pressed="${state.showAverage50}"><i class="swatch dotted" style="--color:var(--muted)"></i>50-day average</button>`;

  const priceLines = [
    { name: stock.symbol, color, values: close, formatTip: (value) => money.format(value) },
  ];
  if (state.showAverage20) {
    priceLines.push({ name: "20-day average", shortName: "20-day", color: "--ink-soft", dash: [7, 4], values: average20, formatTip: (value) => money.format(value) });
  }
  if (state.showAverage50) {
    priceLines.push({ name: "50-day average", shortName: "50-day", color: "--muted", dash: [2, 3], values: average50, formatTip: (value) => money.format(value) });
  }

  const formatLabel = (index) => monthFormat.format(toDate(dates[index]));
  const formatTitle = (index) => dayFormat.format(toDate(dates[index]));

  charts.price.show({
    labels: dates,
    series: priceLines,
    height: 320,
    formatLabel,
    formatTitle,
    formatValue: (value) => wholeMoney.format(value),
    description: `${stock.symbol} closing price from ${formatTitle(0)} to ${formatTitle(dates.length - 1)}, from ${wholeMoney.format(close[0])} to ${wholeMoney.format(close[close.length - 1])}.`,
  });

  charts.drawdown.show({
    labels: dates,
    series: [{ name: "Below its peak", color, fill: true, values: drawdown, formatTip: (value) => percent(value) }],
    height: 160,
    max: 0,
    fillTo: 0,
    endLabels: false,
    rightPadding: 88,
    formatLabel,
    formatTitle,
    formatValue: (value) => formatNumber(value, 0) + "%",
    description: `How far ${stock.symbol} was below its highest price so far. The deepest fall in this period was ${percent(Math.min(...drawdown))}.`,
  });

  const rows = dates.map((date, i) => [
    date,
    money.format(close[i]),
    isMissing(average20[i]) ? "–" : money.format(average20[i]),
    isMissing(average50[i]) ? "–" : money.format(average50[i]),
  ]).reverse();
  $("#detail-table").innerHTML = makeLongTable(["Date", "Close", "20-day average", "50-day average"], rows);
}


function matchDates(seriesA, seriesB) {
  const pricesB = new Map(seriesB.dates.map((date, i) => [date, seriesB.close[i]]));
  const matched = { dates: [], a: [], b: [] };

  seriesA.dates.forEach((date, i) => {
    if (pricesB.has(date)) {
      matched.dates.push(date);
      matched.a.push(seriesA.close[i]);
      matched.b.push(pricesB.get(date));
    }
  });
  return matched;
}

function describeCorrelation(value) {
  if (value >= 0.7) return "move closely together";
  if (value >= 0.4) return "often move in the same direction";
  if (value >= 0.2) return "move together only slightly";
  if (value > -0.2) return "move almost independently";
  return "tend to move in opposite directions";
}

function renderCompare() {
  if (state.compareA === state.compareB) {
    state.compareB = data.stocks.find((stock) => stock.symbol !== state.compareA).symbol;
  }
  $("#compare-a").value = state.compareA;
  $("#compare-b").value = state.compareB;

  const stockA = stocksBySymbol[state.compareA];
  const stockB = stocksBySymbol[state.compareB];
  const matched = matchDates(data.series[stockA.symbol], data.series[stockB.symbol]);

  const first = firstIndexForRange(matched.dates.length, state.compareRange);
  const dates = matched.dates.slice(first);
  const pricesA = matched.a.slice(first);
  const pricesB = matched.b.slice(first);
  const indexedA = pricesA.map((price) => (price / pricesA[0]) * 100);
  const indexedB = pricesB.map((price) => (price / pricesB[0]) * 100);
  const lastOf = (list) => list[list.length - 1];
  const changeOf = (prices) => (lastOf(prices) / prices[0] - 1) * 100;

  $("#compare-intro").textContent =
    `Over ${rangeWords[state.compareRange]}, ${stockA.symbol} changed ${signedPercent(changeOf(pricesA))} and ${stockB.symbol} changed ${signedPercent(changeOf(pricesB))}.`;

  $("#compare-legend").innerHTML =
    legendItem(stockA.symbol, stockColor(stockA.symbol)) +
    legendItem(stockB.symbol, stockColor(stockB.symbol));

  const formatTitle = (index) => dayFormat.format(toDate(dates[index]));

  charts.compare.show({
    labels: dates,
    series: [
      { name: stockA.symbol, color: stockColor(stockA.symbol), values: indexedA, formatTip: (value, i) => `${value.toFixed(1)}  ·  ${money.format(pricesA[i])}` },
      { name: stockB.symbol, color: stockColor(stockB.symbol), values: indexedB, formatTip: (value, i) => `${value.toFixed(1)}  ·  ${money.format(pricesB[i])}` },
    ],
    height: 340,
    formatLabel: (index) => monthFormat.format(toDate(dates[index])),
    formatTitle,
    formatValue: (value) => value.toFixed(0),
    description: `${stockA.symbol} and ${stockB.symbol} compared, both starting at 100 on ${formatTitle(0)}. ${stockA.symbol} ended at ${lastOf(indexedA).toFixed(0)} and ${stockB.symbol} at ${lastOf(indexedB).toFixed(0)}.`,
  });

  const symbols = data.correlation.symbols;
  const correlation = data.correlation.matrix[symbols.indexOf(stockA.symbol)][symbols.indexOf(stockB.symbol)];
  $("#compare-note").textContent =
    `Both lines start at 100 on ${formatTitle(0)}, so a line at 120 means the price is up 20% since then. ` +
    `Their daily returns have a correlation of ${formatNumber(correlation, 2)}: they ${describeCorrelation(correlation)}.`;

  const dataRows = dates.map((date, i) => [date, money.format(pricesA[i]), money.format(pricesB[i])]).reverse();
  $("#compare-data").innerHTML = makeLongTable(["Date", `${escapeHtml(stockA.symbol)} close`, `${escapeHtml(stockB.symbol)} close`], dataRows);

  const measures = [
    ["Latest close", (stock) => money.format(stock.latest_price)],
    ["Change in this period", (stock) => change(stock === stockA ? changeOf(pricesA) : changeOf(pricesB))],
    ["1-year return", (stock) => change(stock.return_1y_pct)],
    ["Volatility", (stock) => percent(stock.volatility_pct)],
    ["Worst drop", (stock) => percent(stock.max_drawdown_pct)],
    ["Sharpe ratio", (stock) => formatNumber(stock.sharpe, 2)],
    ["Rank by 1-year return", (stock) => `#${stock.rank_return} of ${data.stocks.length}`],
  ];
  $("#compare-table").innerHTML = makeTable(
    ["Measure", escapeHtml(stockA.symbol), escapeHtml(stockB.symbol)],
    measures.map(([label, read]) => [label, read(stockA), read(stockB)])
  );
}


function renderCalculator() {
  const isSip = state.calcMode === "sip";
  $("#calc-amount-label").textContent = isSip ? "Monthly amount (₹)" : "Amount invested (₹)";

  if (!$("#calc-form").checkValidity()) {
    $("#calc-message").textContent = "Check the numbers: the amount must be at least ₹100, the return between 0 and 40, and the time a whole number of years from 1 to 40.";
    return;
  }
  $("#calc-message").textContent = "";

  const amount = Number($("#calc-amount").value);
  const rate = Number($("#calc-rate").value);
  const years = Number($("#calc-years").value);

  const labels = [];
  const invested = [];
  const value = [];

  for (let year = 0; year <= years; year++) {
    labels.push(year);

    if (isSip) {
      const months = year * 12;
      const monthlyRate = rate / 1200;
      invested.push(amount * months);

      if (months === 0) {
        value.push(0);
      } else if (monthlyRate === 0) {
        value.push(amount * months);
      } else {
        const growth = (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
        value.push(amount * growth * (1 + monthlyRate));
      }
    } else {
      invested.push(amount);
      value.push(amount * Math.pow(1 + rate / 100, year));
    }
  }

  const finalInvested = invested[years];
  const finalValue = value[years];
  const investedHint = isSip ? `${wholeMoney.format(amount)} a month for ${years} years` : "One-time amount";

  $("#calc-stats").innerHTML =
    statBox("Amount invested", wholeMoney.format(finalInvested), investedHint) +
    statBox("Estimated returns", wholeMoney.format(finalValue - finalInvested), `At ${rate}% a year`) +
    statBox("Total value", wholeMoney.format(finalValue), `${(finalValue / finalInvested).toFixed(2)}× the amount invested`);

  $("#calc-legend").innerHTML =
    legendItem("Amount invested", "--ink-soft", "dashed") +
    legendItem("Total value", "--series-1");

  charts.calc.show({
    labels,
    series: [
      { name: "Amount invested", shortName: "Invested", color: "--ink-soft", dash: [7, 4], values: invested, formatTip: (v) => wholeMoney.format(v) },
      { name: "Total value", shortName: "Value", color: "--series-1", values: value, formatTip: (v) => wholeMoney.format(v) },
    ],
    height: 320,
    formatLabel: (index) => (index === 0 ? "Start" : "Year " + index),
    formatTitle: (index) => (index === 0 ? "Start" : "End of year " + index),
    formatValue: shortMoney,
    description: `Growth over ${years} years. The amount invested reaches ${wholeMoney.format(finalInvested)} and the total value reaches ${wholeMoney.format(finalValue)}.`,
  });

  const rows = labels.map((year) => [year, wholeMoney.format(invested[year]), wholeMoney.format(value[year])]);
  $("#calc-data").innerHTML = makeTable(["Year", "Invested", "Total value"], rows);
}


function renderPage() {
  if (state.page === "overview") renderOverview();
  if (state.page === "detail") renderDetail();
  if (state.page === "compare") renderCompare();
  if (state.page === "calculator") renderCalculator();
}

function showPage() {
  const name = location.hash.slice(1);
  state.page = pages.includes(name) ? name : "overview";

  for (const page of pages) {
    $("#page-" + page).hidden = page !== state.page;
  }

  document.querySelectorAll(".nav a").forEach((link) => {
    if (link.dataset.page === state.page) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  document.title = `${pageTitles[state.page]} · Closing Bell`;
  renderPage();
  window.scrollTo(0, 0);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-button").textContent = theme === "dark" ? "Switch to light" : "Switch to dark";
}

function setUpTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {}

  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  $("#theme-button").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    if (data) renderPage();
  });
}

function showLoadError(error) {
  pages.forEach((page) => { $("#page-" + page).hidden = true; });

  const openedFromFile = location.protocol === "file:";
  const fileTip = openedFromFile
    ? "<li>This page was opened straight from a file, and browsers block that. In VS Code, right-click <code>web/index.html</code> and choose <b>Open with Live Server</b>.</li>"
    : "";

  $("#error").innerHTML =
    `<strong>Could not load data.json.</strong> ${escapeHtml(error.message)}<ul>${fileTip}` +
    "<li>Run <code>Rscript R/analysis.R</code> from the project's top folder. It creates <code>web/data.json</code>.</li>" +
    "<li>Check that <code>data.json</code> sits in the same folder as <code>index.html</code>.</li></ul>";
  $("#error").hidden = false;
}

function setUpControls() {
  $("#stock-table thead").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sort]");
    if (!button) return;

    const key = button.dataset.sort;
    if (state.sortKey === key) {
      state.sortDirection *= -1;
    } else {
      state.sortKey = key;
      state.sortDirection = key === "symbol" || key === "rank_return" ? 1 : -1;
    }
    renderStockTable();
  });

  $("#stock-table tbody").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-open]");
    if (!button) return;

    state.symbol = button.dataset.open;
    location.hash = "#detail";
  });

  fillSelect($("#detail-select"));
  $("#detail-select").addEventListener("change", (event) => {
    state.symbol = event.target.value;
    renderDetail();
  });
  makeButtons($("#detail-ranges"), Object.keys(ranges), state.detailRange, (range) => {
    state.detailRange = range;
    renderDetail();
  });
  $("#detail-legend").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-average]");
    if (!button) return;

    const key = button.dataset.average;
    state[key] = !state[key];
    renderDetail();
  });

  fillSelect($("#compare-a"));
  fillSelect($("#compare-b"));
  $("#compare-a").addEventListener("change", (event) => {
    state.compareA = event.target.value;
    renderCompare();
  });
  $("#compare-b").addEventListener("change", (event) => {
    state.compareB = event.target.value;
    renderCompare();
  });
  makeButtons($("#compare-ranges"), Object.keys(ranges), state.compareRange, (range) => {
    state.compareRange = range;
    renderCompare();
  });

  const calcModes = [{ value: "sip", label: "Monthly SIP" }, { value: "lump", label: "One-time" }];
  makeButtons($("#calc-mode"), calcModes, state.calcMode, (mode) => {
    state.calcMode = mode;
    renderCalculator();
  });
  $("#calc-form").addEventListener("input", renderCalculator);
  $("#calc-form").addEventListener("submit", (event) => event.preventDefault());
}

async function start() {
  setUpTheme();

  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("The server answered " + response.status + ".");
    data = await response.json();
    if (!data.stocks || data.stocks.length < 2) throw new Error("The file needs at least two stocks.");
  } catch (error) {
    showLoadError(error);
    return;
  }

  data.stocks.forEach((stock) => {
    stocksBySymbol[stock.symbol] = stock;
  });

  const ranked = [...data.stocks].sort((a, b) => a.rank_return - b.rank_return);
  state.symbol = ranked[0].symbol;
  state.compareA = ranked[0].symbol;
  state.compareB = ranked[1].symbol;

  charts.price = new LineChart($("#price-chart"));
  charts.drawdown = new LineChart($("#drawdown-chart"));
  charts.compare = new LineChart($("#compare-chart"));
  charts.calc = new LineChart($("#calc-chart"));

  setUpControls();

  if (data.meta.note) {
    $("#notice").textContent = data.meta.note;
    $("#notice").hidden = false;
  }
  $("#footer").textContent = `Numbers calculated in R and saved to data.json on ${data.meta.generated_at}.`;

  window.addEventListener("hashchange", showPage);
  showPage();
}

start();
