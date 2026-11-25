library(jsonlite)

symbols <- c(
  TCS = "TCS.BSE",
  INFY = "INFY.BSE",
  RELIANCE = "RELIANCE.BSE",
  HDFCBANK = "HDFCBANK.BSE"
)
raw_folder <- file.path("data", "raw")
sample_marker <- file.path(raw_folder, "SAMPLE_DATA.txt")
api_key <- Sys.getenv("ALPHAVANTAGE_KEY")

if (api_key == "") {
  stop("Set the ALPHAVANTAGE_KEY environment variable first.")
}

dir.create(raw_folder, showWarnings = FALSE, recursive = TRUE)
using_sample <- file.exists(sample_marker)

fetch_prices <- function(symbol) {
  url <- paste0(
    "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY",
    "&symbol=", symbol, "&outputsize=compact&apikey=", api_key
  )

  for (attempt in 1:3) {
    reply <- tryCatch(fromJSON(url), error = function(e) NULL)
    series <- if (is.null(reply)) NULL else reply[["Time Series (Daily)"]]

    if (!is.null(series)) {
      return(data.frame(
        Date = as.Date(names(series)),
        Close = as.numeric(sapply(series, function(day) day[["4. close"]]))
      ))
    }

    cat("  attempt", attempt, "failed\n")
    Sys.sleep(20)
  }

  NULL
}

saved <- 0

for (name in names(symbols)) {
  cat("Downloading", name, "\n")
  fresh <- fetch_prices(symbols[[name]])

  if (is.null(fresh)) {
    cat("  skipped, keeping the old file\n")
  } else {
    file <- file.path(raw_folder, paste0(name, ".csv"))

    if (file.exists(file) && !using_sample) {
      old <- read.csv(file)[, c("Date", "Close")]
      old$Date <- as.Date(old$Date)
      fresh <- rbind(fresh, old[!old$Date %in% fresh$Date, ])
    }

    fresh <- fresh[order(fresh$Date), ]
    write.csv(fresh, file, row.names = FALSE)
    saved <- saved + 1
  }

  Sys.sleep(15)
}

if (saved == 0) {
  stop("No stock could be downloaded.")
}

if (using_sample && saved == length(symbols)) {
  unlink(sample_marker)
}

cat("Saved", saved, "of", length(symbols), "stocks.\n")
