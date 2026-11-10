# Shared brief for graph nodes

Review date: 2026-11-08. Workspace: /Users/tims-stuff/RonBrowserRebuild/workspace/coachella_lgbtqia_health/

Read 00_PROTOCOL.md before any other work. This brief does not add facts. It only states search targets, file rules, and QA rules.

## Hard rules

- Do not invent authors, affiliations, statistics, quotations, study findings, or citations.
- Every number must come from a page or PMID you opened or fetched in this run with a tool.
- If a fact is not retrieved, write "not found in sources retrieved" and list the queries tried.
- No citation may appear unless this run opened or fetched it. Record tool, query, and URL or PMID in the methods log.
- Do not treat Palm Springs as the whole Coachella Valley. Label every place as Palm Springs city, another named city, west valley, east valley, Coachella Valley, Riverside County, California, or another stated geography. If the source does not disaggregate, say so.
- Keep sexual orientation, sexual behavior, and gender identity distinct. Do not collapse transgender, nonbinary, and cisgender sexual-minority estimates. For every identity statistic, state how the source measured it (question wording if present).
- Same-sex couples or unmarried-partner households are not an LGBT population count. Label them as household structure.
- Census ACS does not, in standard tables, measure sexual orientation or gender identity. Do not infer an LGBT count from ACS without a source that does that inference, and label the method.
- Do not use social-media posts as prevalence.
- Do not name or out private individuals. Organizational names and public surveillance geographies are allowed.
- Do not invent dollar figures. If cost data were not retrieved, document the searches.
- Do not quote a sentence unless that sentence appeared in a tool result in this run. Prefer paraphrase.
- Retrieval date for webpages is 2026-11-08.
- Write files only with the editor tool, using absolute paths. Read files with editor or file_read.

## Place list

Palm Springs, Cathedral City, Rancho Mirage, Palm Desert, Indian Wells, La Quinta, Desert Hot Springs, Thousand Palms, Bermuda Dunes, Indio, Coachella, Thermal, Mecca, Oasis, North Shore, and nearby unincorporated communities. West-valley versus east-valley patterns must be separated whenever sources allow. Do not assume which cities are west or east unless a retrieved source classifies them; if you use a conventional split, label it as a label you applied and name the cities.

## Required health domains

Population size, age, race/ethnicity, income, insurance, housing. HIV and other STIs. Mental health and suicide. Substance use. Chronic disease and aging. Youth. Clinical access and culturally specific services. Social determinants: heat, housing, migration, agricultural labor, poverty, and discrimination. Strengths as well as vulnerabilities. Mechanisms, not labels alone.

## Required comparators

Los Angeles, San Francisco, San Diego, New York City, Chicago, Atlanta, Miami (Wilton Manors only if a source supports it), Seattle, and a national US benchmark. Use the same indicator, similar year, and similar denominator, or state that they are not comparable. Intra-valley comparisons are not a substitute for major-city comparisons. If a city cannot be found, log the failed queries. Omitting a city without a failed-search log is a must-fail.

## Evidence-table columns

indicator | group | place | year | estimate | interval or numerator/denominator | sample size | identity measurement | source | URL or PMID | comparability note

## APA 7

Journal: Author, A. A. (Year). Title. Journal, volume(issue), pages. PMID or DOI URL.
Report or webpage: Author or organization. (Year, Month Day if available). Title. Site or publisher. URL. Retrieved November 8, 2026, from URL.
No citation unless opened or fetched in this run.

## QA must-fail items

- A statistic with no retrieved URL or PMID
- A citation not opened or fetched in this run
- Palm Springs treated as the entire valley
- Sexual orientation and gender identity conflated without a measurement note
- A comparator city from the required list omitted without a documented failed search
- A strength or vulnerability with no mechanism
- A cost figure not present in a retrieved source
- Social-media posts used as prevalence
- Identity described only as risk, with no strengths section
- Individual people identified or outed

## Search-target names (queries, not facts)

HARC Coachella Valley; Riverside University Health System Public Health; CDPH; CDC NCHHSTP; CHIS; Williams Institute; Census ACS; DAP Health; Ryan White; PubMed; AIDSVu; CDC AtlasPlus; BRFSS SOGI; YRBS; California Healthy Kids Survey; Ending the HIV Epidemic; USPSTF.

## Tool rules

Use web_search, brave_web_search, exa_search, tavily_search, open_page, open_page_with_find, exa_get_contents, tavily_extract, pubmed_search, and pubmed_fetch_abstracts as assigned. A search snippet is not an opened source. Open the page or fetch the PMID before citing. If a tool fails, try one alternate tool, then record the failure. Cap yourself at the search limit in your role prompt, then write. Record every query and URL.

## Final response

Keep your final chat response under 800 words. State the file path written, search count, URLs opened or PMIDs fetched, and domains not found. Do not paste the whole dossier into the chat. The dossier file is the product.
