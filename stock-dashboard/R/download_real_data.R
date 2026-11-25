library(quantmod)

symbols <- c(
  TCS = "TCS.NS",
  INFY = "INFY.NS",
  RELIANCE = "RELIANCE.NS",
  HDFCBANK = "HDFCBANK.NS"
)
years <- 2
raw_folder <- file.path("data", "raw")

dir.create(raw_folder, showWarnings = FALSE, recursive = TRUE)

for (name in names(symbols)) {
  cat("Downloading", name, "\n")

  prices <- getSymbols(
    symbols[[name]],
    src = "yahoo",
    from = Sys.Date() - 365 * years,
    auto.assign = FALSE
  )

  table <- data.frame(
    Date = index(prices),
    Open = as.numeric(Op(prices)),
    High = as.numeric(Hi(prices)),
    Low = as.numeric(Lo(prices)),
    Close = as.numeric(Cl(prices)),
    Volume = as.numeric(Vo(prices))
  )
  table <- table[complete.cases(table), ]

  write.csv(table, file.path(raw_folder, paste0(name, ".csv")), row.names = FALSE)
  Sys.sleep(1)
}

unlink(file.path(raw_folder, "SAMPLE_DATA.txt"))
cat("Finished. Now run: Rscript R/analysis.R\n")
