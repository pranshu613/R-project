library(jsonlite)

raw_folder <- "data/raw"
output_file <- "web/data.json"
trading_days <- 252
risk_free_rate <- 0.06

stock_names <- c(
  TCS = "Tata Consultancy Services",
  INFY = "Infosys",
  RELIANCE = "Reliance Industries",
  HDFCBANK = "HDFC Bank"
)

moving_average <- function(prices, days) {
  if (length(prices) < days) {
    return(rep(NA_real_, length(prices)))
  }
  as.numeric(stats::filter(prices, rep(1 / days, days), sides = 1))
}

read_prices <- function(file) {
  prices <- read.csv(file, stringsAsFactors = FALSE)

  if (!all(c("Date", "Close") %in% names(prices))) {
    stop(basename(file), " needs a Date column and a Close column")
  }

  prices$Date <- as.Date(prices$Date)
  prices <- prices[!is.na(prices$Date) & !is.na(prices$Close), ]
  prices[order(prices$Date), ]
}

analyse_stock <- function(symbol, prices) {
  close <- prices$Close
  last <- length(close)

  daily_return <- c(NA, diff(close) / head(close, -1))
  drawdown <- close / cummax(close) - 1
  volatility <- sd(daily_return, na.rm = TRUE) * sqrt(trading_days)
  yearly_return <- mean(daily_return, na.rm = TRUE) * trading_days
  year_ago <- max(1, last - trading_days)

  name <- symbol
  if (symbol %in% names(stock_names)) {
    name <- stock_names[[symbol]]
  }

  list(
    summary = list(
      symbol = symbol,
      name = name,
      latest_date = format(prices$Date[last]),
      latest_price = close[last],
      day_change_pct = daily_return[last] * 100,
      return_1y_pct = (close[last] / close[year_ago] - 1) * 100,
      volatility_pct = volatility * 100,
      max_drawdown_pct = min(drawdown) * 100,
      sharpe = (yearly_return - risk_free_rate) / volatility
    ),
    series = list(
      dates = format(prices$Date),
      close = close,
      ma20 = moving_average(close, 20),
      ma50 = moving_average(close, 50),
      drawdown_pct = drawdown * 100
    ),
    returns = data.frame(Date = prices$Date, value = daily_return)
  )
}

files <- list.files(raw_folder, pattern = "\\.csv$", full.names = TRUE, ignore.case = TRUE)
if (length(files) < 2) {
  stop("Put at least two CSV files in ", raw_folder)
}

results <- list()
for (file in files) {
  symbol <- toupper(tools::file_path_sans_ext(basename(file)))
  results[[symbol]] <- analyse_stock(symbol, read_prices(file))
  cat("Read", symbol, "\n")
}

summaries <- lapply(results, function(result) result$summary)
return_rank <- rank(-sapply(summaries, function(s) s$return_1y_pct), ties.method = "min")
sharpe_rank <- rank(-sapply(summaries, function(s) s$sharpe), ties.method = "min")

for (symbol in names(summaries)) {
  summaries[[symbol]]$rank_return <- as.integer(return_rank[[symbol]])
  summaries[[symbol]]$rank_sharpe <- as.integer(sharpe_rank[[symbol]])
}

return_tables <- lapply(names(results), function(symbol) {
  table <- results[[symbol]]$returns
  names(table) <- c("Date", symbol)
  table
})
all_returns <- Reduce(function(a, b) merge(a, b, by = "Date"), return_tables)
correlation <- cor(all_returns[, -1], use = "complete.obs")

if (file.exists(file.path(raw_folder, "SAMPLE_DATA.txt"))) {
  note <- "Sample data: the prices in data/raw are synthetic and for demonstration only."
} else {
  note <- "Prices from the CSV files in data/raw."
}

output <- list(
  meta = list(
    generated_at = format(Sys.time(), "%Y-%m-%d %H:%M"),
    note = note,
    risk_free_rate = risk_free_rate,
    trading_days = trading_days
  ),
  stocks = unname(summaries),
  series = lapply(results, function(result) result$series),
  correlation = list(
    symbols = colnames(correlation),
    matrix = unname(round(correlation, 4))
  )
)

dir.create(dirname(output_file), showWarnings = FALSE, recursive = TRUE)
write_json(output, output_file, auto_unbox = TRUE, digits = 4, na = "null")
cat("Done. Wrote", output_file, "\n")
