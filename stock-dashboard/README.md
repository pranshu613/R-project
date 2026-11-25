# Closing Bell: a stock analysis dashboard

**R** does the maths. **HTML, CSS and JavaScript** show the results.
There is no other language and no other tool.

```
data/raw/*.csv ──► R/analysis.R ──► web/data.json ──► web/script.js ──► web/index.html
 (prices)          (R calculates)    (the bridge)      (JS draws)        (+ style.css)
```

The only link between R and the web page is one file, `web/data.json`. R writes it, JavaScript reads it.

> **The prices that come with this project are synthetic demo data**, not real market prices. The page says so at the top. See "Use real prices" below to replace them.

## Folder layout

```
stock-dashboard/
├── R/
│   ├── analysis.R             ← the R program (reads CSVs, writes data.json)
│   └── download_real_data.R   ← optional: downloads real prices from Yahoo Finance
├── data/raw/
│   ├── TCS.csv, INFY.csv, RELIANCE.csv, HDFCBANK.csv   ← one CSV per stock
│   └── SAMPLE_DATA.txt        ← marker: "this is demo data" (delete it with real data)
└── web/
    ├── index.html             ← page structure
    ├── style.css              ← looks (light and dark theme)
    ├── script.js              ← loads data.json, fills the page, draws the charts
    └── data.json              ← made by R
```

## Set it up in VS Code

1. **Install R** from <https://cran.r-project.org> (skip if you already have it).
2. **Install the R package** once. Open R and run:
   ```r
   install.packages("jsonlite")
   ```
3. **Open the project folder in VS Code**: File → Open Folder → choose `stock-dashboard`.
   VS Code will suggest two extensions. Install them:
   - **R** (REditorSupport) for editing R files
   - **Live Server** (Ritwick Dey) for opening the web page
4. **Run the R program.** Open a terminal in VS Code (Terminal → New Terminal) and type:
   ```
   Rscript R/analysis.R
   ```
   You should see each stock listed, then `Done. Wrote web/data.json`.
   Run it from the top folder (`stock-dashboard`), because the paths inside the script are relative to it.
5. **Open the page.** Right-click `web/index.html` → **Open with Live Server**.

A ready-made `web/data.json` is already included, so step 5 works even before you run R. Running step 4 replaces it with R's own output.

### Why Live Server?

The page loads `data.json` with `fetch()`, and browsers refuse to do that when you double-click an HTML file. A tiny local server fixes it. If you prefer to stay in R:

```r
install.packages("servr")
servr::httd("web")
```

## How the pieces connect

| Step | Where | What happens |
|---|---|---|
| 1 | `R/analysis.R` | Reads each CSV, then calculates daily returns, 20 and 50 day averages, volatility, worst drop, Sharpe ratio, ranks and correlations |
| 2 | `R/analysis.R` (last lines) | `write_json(output, "web/data.json")` saves it all |
| 3 | `web/script.js` → `start()` | `fetch("data.json")` loads the file |
| 4 | `web/script.js` → `renderOverview()` etc. | Fills the tables, stat boxes and summary sentence |
| 5 | `web/script.js` → `class LineChart` | Draws the charts on the `<canvas>` elements in `index.html` |
| 6 | `web/style.css` | Colours, layout and the dark theme |

`index.html` holds empty containers with ids (for example `id="detail-stats"`). `script.js` finds them by id with `$("#detail-stats")` and fills them in.

The code has almost no comments on purpose. Function names say what they do, so reading `script.js` from top to bottom works: helpers first, then `LineChart`, then one `render...` function per page, then `start()` at the very end.

## What the page shows

- **Overview**: a sortable table (click a column heading), a sentence summarising the year, and a correlation grid.
- **Stock detail**: price chart with 20 and 50 day averages (click the legend to switch them), a drop-from-peak chart, and a table view of the data. Hover a chart to read exact values.
- **Compare**: two stocks rebased to 100 so you can see which grew more, plus a side-by-side table.
- **Calculator**: SIP and one-time investment growth. This part is pure JavaScript and does not use R.

## Use real prices

**Option A: let R download them** (needs internet and one package):

```r
install.packages("quantmod")
```
```
Rscript R/download_real_data.R
Rscript R/analysis.R
```
Edit the `symbols` list at the top of `download_real_data.R` to pick your stocks. Yahoo Finance sometimes limits requests; wait a minute and retry if it fails.

**Option B: download by hand.**
1. On <https://finance.yahoo.com>, open a stock (for example `TCS.NS`), go to **Historical Data**, set the period, and click **Download**.
2. Save the file in `data/raw/` named after the stock, for example `TCS.csv`. The file name becomes the stock's symbol on the page.
3. The CSV needs the columns `Date` and `Close`. Yahoo's files already have them.
4. Delete `data/raw/SAMPLE_DATA.txt`, then run `Rscript R/analysis.R`.

Add at least two stocks; the correlation grid and compare page need them. Add friendly names in `stock_names` at the top of `analysis.R`; any stock not listed there shows its symbol.

## Ideas for next steps

- Add a new measure in R (for example beta against an index), write it into `data.json`, and show it as another column in `script.js` (`overviewColumns`).
- Add an RSI or Bollinger band calculation in R and a new toggle in the legend.
- Add a portfolio page: the user enters quantities, JS multiplies by `latest_price`.
- Change the colours in the `:root` block of `style.css`.

## If something goes wrong

| Problem | Fix |
|---|---|
| Page shows "Could not load data.json" | Open it with Live Server, not by double-clicking. Check that `web/data.json` exists. |
| `Rscript` not found | Add R to your PATH, or run the script from the R console with `source("R/analysis.R")` after `setwd()` to the project folder. |
| `there is no package called 'jsonlite'` | Run `install.packages("jsonlite")` in R. |
| `cannot open file 'data/raw'` or similar | You are not in the top folder. `cd` into `stock-dashboard` first. |
| `needs the columns 'Date' and 'Close'` | Check the CSV header row; Yahoo files use exactly those names. |
| Page shows old numbers | Run `Rscript R/analysis.R` again, then refresh the page. |
