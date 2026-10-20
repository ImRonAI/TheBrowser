> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Finance Search

> Retrieve structured financial and market data in the Agent API.

## Overview

`finance_search` lets the model pull structured financial and market data for public companies, ETFs, and related instruments. The model decides which fields to fetch based on your prompt.

Use it when one answer needs more than one type of financial data, such as valuation, earnings, and context for the same company or list of companies.

### Capabilities

| Data area | What it includes |
| - | - |
| Company basics | Quotes, profiles, peers, and market metadata |
| Financials | Income statement, balance sheet, cash flow (quarterly and annual), key ratios |
| Valuation and pricing | Current/near-real-time pricing, 1-minute to 1-month OHLCV ranges, pre-market and after-hours data |
| Earnings | Last earnings call transcript, report filings, beat/miss history, guidance discussion |
| Segment and KPI tracking | Revenue/profit by segment, geography, ARPU, subscriber counts, GMV, and other operating metrics |
| Analyst coverage | Forward revenue and EPS estimates, cover count, historical estimate changes |
| Market activity | Top gainers, top losers, and most active symbols |
| Ownership and corporate actions | Insider activity, ticker-level metadata, splits, and related market events |
| ETF and index details | Top constituents, shares, weights, and market values |

## Coverage

`finance_search` coverage depends on the symbol, exchange, asset class, geography, and source data availability.

| Coverage area | Current guidance |
| - | - |
| **Ticker and symbol coverage** | Publicly traded companies, ETFs, and related instruments when a supported symbol can be resolved. |
| **Asset classes** | Public equities and ETFs. |

<Warning>
  Market data may be delayed, incomplete, or unavailable for some symbols. `finance_search` is for informational use only and does not provide investment, legal, tax, or financial advice.
</Warning>

## Quickstart

Add `finance_search` to the `tools` array. When you use `model` or `models` without a preset, set `max_steps` to at least 3. If you omit it, the direct-model default is 1 step, which does not leave enough room to initialize and run `finance_search`.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="What's NVIDIA trading at right now, and what is its current P/E?",
      tools=[
          {"type": "web_search"},
          {"type": "finance_search"}
      ],
      max_steps=3
  )

  for item in response.output:
      if item.type == "message":
          print(item.content[0].text)
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "What is NVIDIA trading at right now, and what is its current P/E?",
      "tools": [
        {"type": "web_search"},
        {"type": "finance_search"}
      ],
      "max_steps": 3
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "background": false,
    "completed_at": 1777644610,
    "created_at": 1777644610,
    "error": null,
    "frequency_penalty": 0,
    "id": "resp_d0476d0f-872d-492a-907e-1daa48eb9e32",
    "incomplete_details": null,
    "instructions": null,
    "max_output_tokens": 8192,
    "max_tool_calls": null,
    "metadata": {},
    "model": "openai/gpt-5.6-sol",
    "object": "response",
    "output": [
      {
        "categories": ["quote"],
        "results": [
          {
            "category": "quote",
            "content": "## NVDA Quote\nQuote field guide: `price` is the latest quote/current price...\n| symbol | name | timestamp | market_status | price | currency | change | changesPercentage | marketCap | pe | eps | volume | dayLow | dayHigh | yearLow | yearHigh | previousClose | open |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| NVDA | NVIDIA Corporation | 2026-05-01 14:10:07 UTC | open | 200.23 | USD | 0.66 | 0.33 | 4,866,492,706,948 | 40.86 | 4.90 | 28,725,330 | 199.15 | 203 | 110.82 | 216.83 | 199.57 | 201.28 |",
            "sources": [
              "https://www.perplexity.ai/finance/NVDA/historical-data",
              "https://www.perplexity.ai/finance/NVDA"
            ],
            "tickers": ["NVDA"]
          }
        ],
        "tickers": ["NVDA"],
        "type": "finance_results"
      },
      {
        "content": [
          {
            "annotations": [],
            "logprobs": [],
            "text": "NVIDIA (NVDA) is currently trading at **$200.23** per share, and its current P/E ratio is **40.86**.",
            "type": "output_text"
          }
        ],
        "id": "msg_b188058f-8225-4642-90e6-da7112f96b69",
        "role": "assistant",
        "status": "completed",
        "type": "message"
      }
    ],
    "parallel_tool_calls": true,
    "presence_penalty": 0,
    "previous_response_id": null,
    "prompt_cache_key": null,
    "reasoning": null,
    "safety_identifier": null,
    "service_tier": "default",
    "status": "completed",
    "store": true,
    "temperature": 1,
    "text": {
      "format": {
        "type": "text"
      }
    },
    "tool_choice": "auto",
    "tools": [
      {
        "type": "finance_search"
      }
    ],
    "top_logprobs": 0,
    "top_p": 1,
    "truncation": "disabled",
    "usage": {
      "cost": {
        "currency": "USD",
        "input_cost": 0.03028,
        "output_cost": 0.00126,
        "tool_calls_cost": 0.005,
        "total_cost": 0.03654
      },
      "input_tokens": 7570,
      "input_tokens_details": {
        "cached_tokens": 0
      },
      "output_tokens": 63,
      "output_tokens_details": {
        "reasoning_tokens": 0
      },
      "tool_calls_details": {
        "finance_search": {
          "invocation": 1
        }
      },
      "total_tokens": 7633
    },
    "user": null
  }
  ```
</Accordion>

## Example Prompts

* **Full company brief:** "Give me a complete NVIDIA snapshot: valuation, segment revenue for the latest quarter, and management's latest commentary on margins guidance."
* **Compare companies in one request:** "Compare Apple, Microsoft, and Alphabet on revenue growth, operating margin, and forward P/E for the latest fiscal year."
* **Earnings + reaction context:** "Summarize Tesla's last earnings call, include actual vs consensus, and describe how the stock and analyst targets moved after publication."

## Prompt Guidance

`finance_search` works best when the prompt states the outcome, not the data shape.

* Start with the business question first, then include the company or ticker.
* Add time windows when relevant (`latest quarter`, `fiscal year to date`, `last 30 days`).
* Let the tool decide which specific report fields to retrieve.

## Recommended Configurations

Start with the configuration that matches the shape of the finance question.

| Configuration | Best for | Latency | Quality | Cost |
| - | - | - | - | - |
| Live Market Data and Quotes | Real-time prices, quotes, and latest figures | Fast | Good | Low |
| Single-Company Historical Lookups | Basic historical financials for one company or ticker | Balanced | High | Medium |
| Multi-Step Financial Research | Cross-company comparisons and complex financial analysis | Thorough | Highest | High |

### Live Market Data and Quotes

Use this for time-sensitive answers that depend on real-time prices, quotes, or the latest market figures. It is the cheapest and fastest option while maintaining strong quality for live data lookups.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="What is Apple's most recent annual revenue, and what segments contributed most to year-over-year growth?",
      tools=[{"type": "finance_search"}],
      max_steps=3,
      max_output_tokens=1024
  )

  for item in response.output:
      if item.type == "message":
          print(item.content[0].text)
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "What is Apple\u0027s most recent annual revenue, and what segments contributed most to year-over-year growth?",
      "tools": [{"type": "finance_search"}],
      "max_steps": 3,
      "max_output_tokens": 1024
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "4a4fa036-b206-44db-91d1-e0d7cf8f8b1e",
    "results": [
      {
        "snippet": "It has also built out its subscription services to include music and video streaming, video games, fitness and cloud storage.\nThis segment alone generated $53 billion revenue in 2020, making it Apple’s second largest segment.\n...\n## Apple Key Statistics\n- Apple generated $390.8 billion revenue in 2024, 51% came from iPhone sales\n- Apple Services is the second largest division, responsible for 24% of revenue in 2024\n- 232 million iPhones, 52 million iPads and 22 million Mac and MacBook units were sold in 2024\n- Apple’s home and wearables division declined by 6.5% in 2024\n- It sold 66 million AirPods and 39 million Apple Watches in 2024\n- Apple Music has 95 million subscribers, Apple TV+ has 30 million\n…\n...\nApple revenue increased dramatically in the 2010s, from $65 billion at the start of the decade to $274 billion by the end.\nRevenues increased by 1.9% in 2024.\n...\nApple has always been most successful in the United States, its home country.\nAmericas is responsible for 42% of all revenue generation and approximately 35% of that is from the US alone.\n...\n## Apple Revenue by Product\niPhone continues to be the main revenue generator, but its percentage has decreased in the past five years.\nServices has seen the highest percentage increase over the past five years.\n...\niPhone is Apple’s most valuable product and has, since 2008, been its main source of revenue.\nEven though Apple has diversified its product line with Watch, AirPods and services, iPhone is still responsible for 51% of its revenue.\n...\nApple generated $37 billion revenue from this segment in 2024.\nWe estimate AirPods is a $10 billion business on its own, with Apple Watch also potentially contributing between $14 billion to $18 billion a year.",
        "title": "Apple Statistics (2026) - Business of Apps",
        "url": "https://www.businessofapps.com/data/apple-statistics/",
        "date": "2026-02-26",
        "last_updated": "2025-09-02"
      },
      {
        "snippet": "",
        "title": "Investor Relations - Apple",
        "url": "https://investor.apple.com/investor-relations/default.aspx",
        "date": null,
        "last_updated": "2026-04-17"
      },
      {
        "snippet": "In fiscal year 2025, Apple's revenue by segment (products & services) are as follows:\n**iPad:**$28.02 B **iPhone:**$209.59 B **Mac:**$33.71 B **Service:**$109.16 B **Wearables, Home and Accessories:**$35.69 B\nLearn more about Apple’s Revenue by Geography\n...\nIn fiscal year 2023, Apple's revenue by segment is as follows:\n**iPad**generated $28.30 B in revenue, representing 7.38% of its total revenue.\n**iPhone**generated $200.58 B in revenue, representing 52.33% of its total revenue.\n**Mac**generated $29.36 B in revenue, representing 7.66% of its total revenue.\n**Service**generated $85.20 B in revenue, representing 22.23% of its total revenue.\n**Wearables, Home and Accessories**generated $39.85 B in revenue, representing 10.4% of its total revenue.\nThe\n**biggest segment**for Apple is the iPhone, which represents 52.33% of its total revenue.\nThe\n...\nIn fiscal year 2024, Apple's revenue by segment is as follows:\n**iPad**generated $26.69 B in revenue, representing 6.83% of its total revenue.\n**iPhone**generated $201.18 B in revenue, representing 51.45% of its total revenue.\n**Mac**generated $29.98 B in revenue, representing 7.67% of its total revenue.\n**Service**generated $96.17 B in revenue, representing 24.59% of its total revenue.\n**Wearables, Home and Accessories**generated $37.01 B in revenue, representing 9.46% of its total revenue.\n...\nIn fiscal year 2025, Apple's revenue by segment is as follows:\n**iPad**generated $28.02 B in revenue, representing 6.73% of its total revenue.\n**iPhone**generated $209.59 B in revenue, representing 50.36% of its total revenue.\n**Mac**generated $33.71 B in revenue, representing 8.1% of its total revenue.\n**Service**generated $109.16 B in revenue, representing 26.23% of its total revenue.\n**Wearables, Home and Accessories**generated $35.69 B in revenue, representing 8.58% of its total revenue.\nThe\n**biggest segment**for Apple is the iPhone, which represents 50.36% of its total revenue.\nThe\n**smallest segment**for Apple is the iPad, which represents 6.73% of its total revenue.\n...\nIn fiscal year 2025, the iPhone generated the most revenue ($209.59 B), and the iPad generated the least revenue ($28.02 B).\n## Apple's Revenue Growth Drivers\nThe above chart shows growth drivers and a year-over-year comparison of different segments' revenue.\n**iPad**revenue increased 4.98% ($1.33 B) from $26.69 B (in 2024) to $28.02 B (in 2025).\n**iPhone**revenue increased 4.18% ($8.40 B) from $201.18 B (in 2024) to $209.59 B (in 2025).\n**Mac**revenue increased 12.42% ($3.72 B) from $29.98 B (in 2024) to $33.71 B (in 2025).\n**Service**revenue increased 13.51% ($12.99 B) from $96.17 B (in 2024) to $109.16 B (in 2025).\n**Wearables, Home and Accessories**revenue decreased -3.56% ($1.32 B) from $37.01 B (in 2024) to $35.69 B (in 2025).",
        "title": "Apple Revenue Breakdown By Segment | Bullfincher",
        "url": "http://bullfincher.io/companies/apple/revenue-by-segment",
        "date": "2025-01-01",
        "last_updated": "2026-04-30"
      },
      {
        "snippet": "This brings the company's revenue in the last twelve months to $451.44B, up 12.76% year-over-year.\nIn the fiscal year ending September 27, 2025, Apple had annual revenue of $416.16B with 6.43% growth.",
        "title": "Apple (AAPL) Revenue 2005-2026 - Stock Analysis",
        "url": "https://stockanalysis.com/stocks/aapl/revenue/",
        "date": "2005-09-29",
        "last_updated": "2026-05-26"
      },
      {
        "snippet": "## Revenue in 2026 (TTM): $451.44 Billion USD\nAccording to **Apple**'s latest financial reports the company's current revenue (TTM ) is **$451.44 Billion USD**.\nIn 2025 the company made a revenue of **$435.61 Billion USD** an increase over the revenue in the year 2024 that were of **$395.76 Billion USD**.",
        "title": "Apple (AAPL) - Revenue - Companies Market Cap",
        "url": "https://companiesmarketcap.com/apple/revenue/",
        "date": null,
        "last_updated": "2026-05-26"
      },
      {
        "snippet": "## History\n|Date|iPhone|Services|Wearables, Home and Accessories|iPad|Mac|\n|--|--|--|--|--|--|\n|Dec 31, 2025|225.72B|112.83B|35.43B|28.53B|33.11B|\n|Sep 30, 2025|209.59B|109.16B|35.69B|28.02B|33.71B|",
        "title": "Apple (AAPL) Revenue by Segment",
        "url": "https://stockanalysis.com/stocks/aapl/metrics/revenue-by-segment/",
        "date": "2021-03-31",
        "last_updated": "2026-03-11"
      },
      {
        "snippet": "Apple’s iPhone sales accounted for around 55 percent of the company’s overall revenue in the first quarter of fiscal year 2025, the largest share of all Apple products.\nOver the years, services as well as wearables, home and accessories have made a growing contribution to Apple’s net sales.\n...\nIn the first quarter of financial year 2025, Apple’s global revenue reached around 124 billion U.S. dollars.\nThe Americas are Apple’s largest regional market and contributed to around 42 percent of the firm’s sales in that quarter.",
        "title": "Apple sales revenue share by product 2012-2025 | Statista",
        "url": "https://www.statista.com/statistics/382260/segments-share-revenue-of-apple/",
        "date": "2025-02-20",
        "last_updated": "2025-02-26"
      },
      {
        "snippet": "The Company posted quarterly revenue of $94.0 billion, up 10 percent year over year, and quarterly diluted earnings per share of $1.57, up 12 percent year over year.\n“Today Apple is proud to report a June quarter revenue record with double-digit growth in iPhone, Mac and Services and growth around the world, in every geographic segment,” said Tim Cook, Apple’s CEO.",
        "title": "Apple reports third quarter results",
        "url": "https://www.apple.com/newsroom/2025/07/apple-reports-third-quarter-results/",
        "date": "2025-07-31",
        "last_updated": "2026-03-29"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

### Single-Company Historical Lookups

Use this for a single company's historical figures or basic questions that benefit from both structured finance data and web context. GPT-5.5 is strong at simple web search and token-efficient for historical lookups.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="What was Microsoft's total revenue in its most recently completed fiscal year, and how did it compare with the prior fiscal year according to Microsoft's annual report?",
      tools=[
          {"type": "web_search"},
          {"type": "finance_search"},
          {"type": "fetch_url"}
      ],
      max_steps=5,
      max_output_tokens=2048,
      reasoning={"effort": "low"}
  )

  for item in response.output:
      if item.type == "message":
          print(item.content[0].text)
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    --data @- <<'JSON'
  {
      "model": "openai/gpt-5.6-sol",
      "input": "What was Microsoft's revenue in its most recently completed fiscal year and the prior fiscal year, according to Microsoft's 10-K?",
      "tools": [
        {"type": "web_search"},
        {"type": "finance_search"},
        {"type": "fetch_url"}
      ],
      "max_steps": 5,
      "max_output_tokens": 2048,
      "reasoning": {"effort": "low"}
  }
  JSON
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "resp_1be7ab7e-0dda-4949-9578-1462f9557a6b",
    "object": "response",
    "model": "openai/gpt-5.6-sol",
    "status": "completed",
    "created_at": 1777645563,
    "completed_at": 1777645563,
    "output": [
      {
        "type": "finance_results",
        "categories": ["financials"],
        "tickers": ["MSFT"],
        "results": [
          {
            "category": "financials",
            "tickers": ["MSFT"],
            "content": "## MSFT FY 2024\n| date | period | income_statement_total_revenues |\n| --- | --- | --- |\n| 2024-06-30 | 2024 FY | 245,122,000,000 |",
            "sources": [
              "https://www.perplexity.ai/finance/MSFT/financials?period=annual&category=INCOME_STATEMENT&fromYear=2024&toYear=2024"
            ]
          }
        ]
      },
      {
        "type": "finance_results",
        "categories": ["financials"],
        "tickers": ["MSFT"],
        "results": [
          {
            "category": "financials",
            "tickers": ["MSFT"],
            "content": "## MSFT FY 2025\n| date | period | income_statement_total_revenues |\n| --- | --- | --- |\n| 2025-06-30 | 2025 FY | 281,724,000,000 |",
            "sources": [
              "https://www.perplexity.ai/finance/MSFT/financials?period=annual&category=INCOME_STATEMENT&fromYear=2025&toYear=2025"
            ]
          }
        ]
      },
      {
        "type": "message",
        "id": "msg_99ccfbfd-bce8-4b9b-b412-b01ef45c7842",
        "role": "assistant",
        "status": "completed",
        "content": [
          {
            "type": "output_text",
            "text": "Microsoft's revenue in its last completed fiscal year, **FY2025 ended June 30, 2025**, was **$281.724 billion**.\n\nCompared with the prior year, **FY2024 revenue was $245.122 billion**, so Microsoft revenue increased by:\n\n- **$36.602 billion**\n- **About 14.9% year over year**",
            "annotations": [],
            "logprobs": []
          }
        ]
      }
    ],
    "tools": [
      {"type": "web_search"},
      {"type": "fetch_url"},
      {"type": "finance_search"}
    ],
    "max_output_tokens": 8192,
    "tool_choice": "auto",
    "parallel_tool_calls": true,
    "usage": {
      "input_tokens": 12522,
      "input_tokens_details": {
        "cached_tokens": 3840,
        "cache_read_input_tokens": 3840
      },
      "output_tokens": 500,
      "total_tokens": 13022,
      "cost": {
        "currency": "USD",
        "input_cost": 0.03473,
        "cache_read_cost": 0.00154,
        "output_cost": 0.01,
        "tool_calls_cost": 0.01,
        "total_cost": 0.05627
      },
      "tool_calls_details": {
        "finance_search": {
          "invocation": 2
        }
      }
    }
  }
  ```
</Accordion>

### Multi-Step Financial Research

Use this for cross-company comparisons, longer historical investigations, and analysis that needs several tool calls across financial statements, filings, transcripts, and web sources. Opus performs best on complex multi-step reasoning when paired with the full tool suite.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="anthropic/claude-opus-4-7",
      input="Compare Apple, Microsoft, and Alphabet on revenue growth and operating margin trends over the last three fiscal years using their 10-K filings.",
      tools=[
          {"type": "web_search"},
          {"type": "finance_search"},
          {"type": "fetch_url"}
      ],
      max_steps=10,
      max_output_tokens=4096
  )

  for item in response.output:
      if item.type == "message":
          print(item.content[0].text)
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "anthropic/claude-opus-4-7",
      "input": "Compare Apple, Microsoft, and Alphabet on revenue growth and operating margin trends over the last three fiscal years using their 10-K filings.",
      "tools": [
        {"type": "web_search"},
        {"type": "finance_search"},
        {"type": "fetch_url"}
      ],
      "max_steps": 10,
      "max_output_tokens": 4096
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "fd226107-fb5a-4f0d-a9da-0db62b67ec60",
    "results": [
      {
        "snippet": "",
        "title": "Microsoft Annual Report 2025",
        "url": "https://www.microsoft.com/investor/reports/ar25/index.html",
        "date": "2020-06-30",
        "last_updated": "2026-05-18"
      },
      {
        "snippet": "",
        "title": "10-K - SEC.gov",
        "url": "https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.htm",
        "date": "2009-05-15",
        "last_updated": "2025-07-11"
      },
      {
        "snippet": "",
        "title": "Investor Relations - Apple",
        "url": "https://investor.apple.com/investor-relations/default.aspx",
        "date": null,
        "last_updated": "2026-04-17"
      },
      {
        "snippet": "| | |Sep 27, 2025|Sep 28, 2024|Sep 30, 2023|Sep 24, 2022|Sep 25, 2021|Sep 26, 2020|\n...\n| |Return on Sales|Return on Sales|Return on Sales|Return on Sales|Return on Sales|Return on Sales|Return on Sales|\n| |Gross profit margin|46.91%|46.21%|44.13%|43.31%|41.78%|38.23%|\n| |Operating profit margin|31.97%|31.51%|29.82%|30.29%|29.78%|24.15%|\n| |Net profit margin|26.92%|23.97%|25.31%|25.31%|25.88%|20.91%|\n...\n- **Gross Profit Margin**\nThe gross profit margin has shown a consistent upward trend over the observed periods.\nStarting at 38.23% in 2020, it increased steadily each year, reaching 46.91% by 2025.\nThis progression indicates an improving efficiency in production or a favorable pricing strategy, resulting in higher profitability at the gross level.\n- **Operating Profit Margin**\nThe operating profit margin has generally improved from 24.15% in 2020 to 31.97% in 2025.\nThere was a notable increase through 2021 and 2022, followed by a slight dip in 2023, and then a recovery and growth in the subsequent years.\nThis pattern suggests effective cost management and operational efficiency enhancements, despite minor fluctuations.\n- **Net Profit Margin**\nThe net profit margin experienced growth from 20.91% in 2020 to a peak of 25.88% in 2021.\nIt stabilized around that level in 2022 and 2023, then dipped slightly to 23.97% in 2024 before rising again to 26.92% in 2025.\nThis indicates overall strong profitability, though fluctuations may reflect changes in non-operating expenses, taxes, or other factors affecting net income.\n...\nBased on: 10-K (reporting date: 2025-09-27), 10-K (reporting date: 2024-09-28), 10-K (reporting date: 2023-09-30), 10-K (reporting date: 2022-09-24), 10-K (reporting date: 2021-09-25), 10-K (reporting date: 2020-09-26).\n...\n- **Net Sales**\nNet sales demonstrated a consistent upward trend over the analyzed periods, increasing from 274.5 billion US dollars in 2020 to 416.2 billion US dollars in 2025.\nAlthough there was a slight decline observed in 2023 compared to 2022, the overall trajectory remained positive, indicating growth in revenue generation.\n- **Gross Margin**\nGross margin values rose steadily from 104.96 billion US dollars in 2020 to 195.2 billion US dollars projected for 2025.\nThe upward movement in gross margin generally coincides with the increase in net sales, reflecting enhanced profitability at the gross level.\n- **Gross Profit Margin Percentage**\nThe gross profit margin percentage showed consistent improvement across the periods, increasing from 38.23% in 2020 to an estimated 46.91% in 2025.\nThis suggests that the company has improved its operational efficiency or pricing power, enabling it to retain a higher portion of sales revenue as gross profit.\n- **Analysis Summary**\nOverall, the data indicate robust growth in sales accompanied by an expanding gross margin both in absolute terms and as a percentage of sales.\nThe improvement in gross profit margin percentage highlights potentially improved cost control or favorable product mix effects.\nThe slight dip in sales noted for one year did not disrupt the general positive trend.\nThe financial metrics suggest strengthening profitability and efficiency over the observed periods.\n...\n- **Net Sales**\nThere is a consistent upward trend in net sales over the observed periods.\nStarting from 274,515 million USD in 2020, net sales increased significantly to 365,817 million USD in 2021, followed by steady growth reaching 416,161 million USD in 2025.\nThis indicates strong revenue growth and expanding market presence or product demand over the years.\n...\nOperating income has shown an overall increase from 66,288 million USD in 2020 to 133,050 million USD in 2025.\nThere was a substantial increase between 2020 and 2021, more than doubling from the previous year.\nAlthough there was a slight decline between 2022 and 2023, operating income resumed an increasing pattern thereafter.\n...\n- **Operating Profit Margin**\nThe operating profit margin has exhibited improvement throughout the period.\nBeginning at 24.15% in 2020, it rose sharply to nearly 30% in 2021 and maintained levels above 29% in subsequent years.\nBy 2025, it reached approximately 32%, indicating enhanced efficiency in managing operating expenses relative to sales and stronger profit generation capabilities.\n- **Overall Analysis**\nThe financial data demonstrates robust growth in revenue and profitability over the six-year period.\nThe rise in net sales, combined with increasing operating income and improving operating profit margin, reflects a positive operational performance.\nAlthough a minor dip in operating income occurred in 2023, the overall trajectory points to effective cost management and a solid business model that supports sustained profit growth.\n...\n- **Net Income**\nThe net income exhibits an overall upward trend over the analyzed periods, starting at 57,411 million USD in 2020 and reaching 112,010 million USD by 2025.\nThere was a significant increase from 2020 to 2021, followed by more moderate growth through 2022.\nA slight decline is observed in 2023 and 2024, yet the figure rebounds strongly in 2025, reflecting improved profitability or operational efficiency in the latest period.\n- **Net Sales**\nNet sales have shown consistent growth across the years, increasing from 274,515 million USD in 2020 to 416,161 million USD in 2025.\nThe growth pace was markedly strong between 2020 and 2022, followed by a minor decline in 2023.\nSales recovered in 2024 and continued to rise in 2025, indicating resilient demand and market expansion despite some fluctuations.\n- **Net Profit Margin**\nThe net profit margin has remained relatively stable with some variations.\nIt increased sharply from 20.91% in 2020 to 25.88% in 2021, stayed around 25.3% in 2022 and 2023, then decreased slightly to 23.97% in 2024.",
        "title": "Apple Inc. (NASDAQ:AAPL) | Analysis of Profitability Ratios",
        "url": "https://www.stock-analysis-on.net/NASDAQ/Company/Apple-Inc/Ratios/Profitability",
        "date": "2025-09-27",
        "last_updated": "2026-05-25"
      },
      {
        "snippet": "In the fiscal year 2024, Alphabet's revenue was 348.16 billion U.S. dollars.\nComparatively, in the fiscal year of 2023, hardware-focused Apple's 383.29 billion U.S. dollar revenue was almost double the amount of Microsoft's 211.92 billion U.S. dollars.",
        "title": "Google revenue comparison Apple Microsoft 2024 | Statista",
        "url": "https://www.statista.com/statistics/234529/comparison-of-apple-and-google-revenues/",
        "date": "2025-02-05",
        "last_updated": "2025-04-02"
      },
      {
        "snippet": "",
        "title": "aapl-20230930 - SEC.gov",
        "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
        "date": "2023-09-30",
        "last_updated": "2026-02-24"
      },
      {
        "snippet": "Nvidia printed a 17x EPS increase across two fiscal years.\nMeta's efficiency reset nearly tripled earnings.\nAmazon turned a year of net losses into $5.53 EPS.\nMeanwhile Apple ground out 5% total EPS growth across the same stretch.\n...\nNote: Nvidia's fiscal year ends in January.\nFY2023 = Feb 2022–Jan 2023; FY2024 = Feb 2023–Jan 2024; FY2025 = Feb 2024–Jan 2025.\nAll others are calendar year.\n|Company|EPS 2022|EPS 2023|EPS 2024|2-Yr Change|\n|--|--|--|--|--|\n|NVDANvidia|$1.74*|$12.96*|$29.76*|+17.1x|\n|METAMeta|$8.59|$14.87|$23.86|+2.8x|\n|AMZNAmazon|–$0.27|$2.90|$5.53|Flipped|\n|GOOGLAlphabet|$4.56|$5.80|$8.04|+76%|\n|MSFTMicrosoft|$9.65|$11.45|$12.41|+29%|\n|AAPLApple|$6.11|$6.13|$6.42|+5%|\n*Nvidia fiscal year.\nFY2023 ends Jan 2023; FY2024 ends Jan 2024; FY2025 ends Jan 2025.\nSources: SEC 10-K filings, Bloomberg.\n## Revenue Growth: Who Is Actually Getting Bigger\n|Company|Revenue 2022|Revenue 2024|2-Yr Growth|\n|--|--|--|--|\n|NVDA|$26.9B*|$130.5B*|+385%|\n|AMZN|$514B|$638B|+24%|\n|MSFT|$198B|$245B|+24%|\n|GOOGL|$282B|$350B|+24%|\n|META|$116B|$164B|+41%|\n|AAPL|$394B|$391B|–1%|\n*Nvidia FY2023 (ends Jan 2023) and FY2025 (ends Jan 2025).\nApple revenue declined slightly due to China headwinds and iPhone mix.\n...\nMeta\nYear of Efficiency: headcount cut from 87K to 67K in 2023, then held flat while revenue accelerated.\nAI-driven ad targeting lifted CPMs.\nOperating margins expanded from 20% to 41%.\nAmazon\nAWS margin expansion drove the swing from loss to $5.53 EPS.\nAWS operating income grew from $22.8B in 2022 to $39.8B in 2024.\n...\nMicrosoft\nAzure AI revenue integration (Copilot, OpenAI partnership) added ~$4B in incremental revenue by 2024.\nSteady compounding on cloud re-signed contracts.\nEPS grew reliably but without a step-change.\nAlphabet\n2022 was an advertising recession year.\nThe 2023–2024 recovery combined with YouTube growth and Google Cloud crossing $11B quarterly revenue drove EPS nearly doubling from the 2022 trough.\nApple\nChina revenue headwinds, iPhone ASP plateauing, and lack of a generative AI hardware catalyst kept growth muted.\nServices grew to 24% of revenue but couldn&apos;t offset hardware stagnation.\n...\nEPS can be gamed with buybacks.\nOperating margin expansion is harder to fake — it reflects real structural improvement.\nMETAMeta operating margin\nEfficiency reset + AI ad targeting\n20% (2022)→41% (2024)\nNVDANvidia gross margin\nAI GPU premium pricing power\n56% (FY2023)→75%+ (FY2025)\nAMZNAmazon operating margin\nAWS mix shift + fulfillment restructuring\n2% (2022)→10% (2024)\nMSFTMicrosoft operating margin\nSteady; Copilot uplift still building\n42% (FY2022)→44% (FY2024)\nGOOGLAlphabet operating margin\nAd market recovery + cloud scale benefits\n26% (2022)→32% (2024)\nAAPLApple operating margin\nServices mix improving but hardware drag remains\n30% (FY2022)→31% (FY2024)\n...\n*Data sourced from SEC 10-K filings and Bloomberg consensus.\nNvidia fiscal years noted separately.\nOriginally published in the Trace Cohen newsletter.*",
        "title": "AAPL MSFT GOOGL AMZN NVDA META: EPS & Revenue Growth ...",
        "url": "https://valueaddvc.com/blog/apple-google-microsoft-meta-amazon-nvidia-comparing-eps-and-revenue-growth",
        "date": "2026-05-08",
        "last_updated": "2026-05-19"
      },
      {
        "snippet": "",
        "title": "[PDF] Orbis Corporates Research - Moody's",
        "url": "https://www.moodys.com/web/en/us/insights/resources/us-tech-firm-10-year-analysis-orbis-research.pdf",
        "date": null,
        "last_updated": "2026-04-23"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

## Parameters

| Parameter | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"finance_search"`. |

## Response Shape

When `finance_search` runs, the response can include `finance_results` output items before the final assistant message. Each `finance_results` item includes the requested finance categories, ticker symbols, structured content, and source URLs when available. The final `usage` object includes token counts, cost details, and `tool_calls_details.finance_search.invocation` when tool-call usage is reported.

```json theme={null}
{
  "output": [
    {
      "type": "finance_results",
      "categories": ["quote"],
      "tickers": ["NVDA"],
      "results": [
        {
          "category": "quote",
          "tickers": ["NVDA"],
          "content": "Structured quote data returned by the finance search tool.",
          "sources": [
            "https://www.perplexity.ai/finance/NVDA"
          ]
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "The answer generated from finance data."
        }
      ]
    }
  ],
  "usage": {
    "tool_calls_details": {
      "finance_search": {
        "invocation": 1
      }
    }
  }
}
```

## Pricing

`finance_search` is billed at **\$5 per 1,000 invocations**. Model token usage is billed separately according to Agent API token pricing.

<Note>
  Pricing follows the same pattern as other tool calls: pay for invocations plus model tokens. See [Pricing](/docs/getting-started/pricing).
</Note>

## Limits / Quotas

`finance_search` uses the same Agent API request flow as other tools. Limits depend on your account tier, request configuration, and the number of tool invocations needed to answer the prompt. See [Rate Limits & Usage Tiers](/docs/admin/rate-limits-usage-tiers#agent-api-rate-limits) for tier-based request limits.

| Limit area | What to expect |
| - | - |
| **API rate limits** | Agent API rate limits apply to requests that use `finance_search`. |
| **Tool invocations** | Each time the model calls `finance_search`, it counts as one billable tool invocation. Multi-company or multi-step prompts may require more than one invocation. |
| **Step limits** | With a direct model, set `max_steps` to at least 3 so `finance_search` can initialize and run. Use a higher value for multi-step requests that combine it with tools such as `web_search` and `fetch_url`. |
| **Output limits** | Large comparisons, long transcripts, and multi-year financial tables can hit `max_output_tokens` or response truncation settings. |
| **Coverage limits** | Some symbols, exchanges, regions, asset classes, or fields may be unavailable depending on source coverage and data freshness. |

## Next Steps

<CardGroup cols={2}>
  <Card title="Web Search" icon="world-search" href="/docs/agent-api/tools/web-search">
    Search the web for source-grounded context.
  </Card>

  <Card title="Fetch URL Content" icon="file-text" href="/docs/agent-api/tools/fetch-url-content">
    Fetch full content from known URLs.
  </Card>

  <Card title="People Search" icon="users" href="/docs/agent-api/tools/people-search">
    Search for professionals and employees.
  </Card>

  <Card title="Agent API Quickstart" icon="rocket" href="/docs/agent-api/quickstart">
    Get started with the Agent API.
  </Card>
</CardGroup>
