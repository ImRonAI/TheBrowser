# Comparators: Coachella Valley LGBTQIA+ population health

Review date: 2026-11-08.

This dossier extracts comparator inputs. It does not compute numeric gaps, rankings of difference, or rates that a source did not publish. Palm Springs is not treated as the Coachella Valley. Sexual orientation, sexual behavior, and gender identity are kept distinct, and each identity statistic states how the source measured it.

Common surveillance year for the city comparison is 2023, because that is the year for which this run parsed a single CDC metropolitan statistical area (MSA) workbook covering every required city plus a national total. California Department of Public Health (CDPH) 2023 and 2024 county rows, and Riverside University Health System–Public Health (RUHS-PH) 2022–2024 local rows, are extracted separately and are not treated as interchangeable with the CDC MSA rates.

## Methods log

Tools and queries in this run. A search snippet was not treated as an opened source. Numbers below come from files downloaded and parsed, or from pages opened with a page tool.

| Tool | Query or URL | Result used |
| --- | --- | --- |
| web_search | CDC HIV Surveillance Report 2023 diagnoses rates metropolitan statistical areas per 100,000 | Located CDC Stacks tables, not cited from the snippet |
| web_search | CDPH California HIV Surveillance Report Riverside County new diagnoses rate prevalence | Located the 2024 CDPH PDF |
| web_search | AIDSVu HIV diagnosis rate prevalence Riverside County Los Angeles San Diego 2022 OR 2023 | AIDSVu profile numbers were not opened as full pages and are not cited |
| web_search | Williams Institute LGBT adult population percentage Los Angeles San Francisco San Diego New York Chicago Atlanta Miami Seattle | Located the MSA brief |
| web_search | Coachella Valley HIV diagnoses rate HARC OR DAP Health OR Riverside University Health System LGBTQ | Located RUHS-PH slide reports |
| web_search | site:cdc.gov Diagnoses, Deaths, and Prevalence of HIV … 2023 Table 18 | Located https://stacks.cdc.gov/view/cdc/177772 and the Excel download |
| web_search | AIDSVu Riverside County HIV prevalence rate new diagnoses 2023 site:aidsvu.org | News pages only; city profiles not opened; AIDSVu rates not cited |
| web_search | LGBT Adults in Large US Metropolitan Areas PDF Williams | Publication page later opened |
| web_search | Riverside University Health System HIV epidemiology report 2024 Coachella Valley PDF | Located media/6416 and related PDFs |
| web_search | Williams Institute Adult LGBT Population in the United States December 2023 PDF BRFSS 5.5% | Located the December 2023 PDF |
| web_search | HARC Coachella Valley LGBTQ population percentage OR identify as survey | No opened probability-survey estimate of the valley LGBT share |
| web_search | HARC sexual orientation Coachella Valley percent gay lesbian bisexual 2022 OR 2025 | No opened valley-wide sexual-orientation prevalence |
| web_search | Wilton Manors HIV prevalence OR LGBT population percentage Broward OR Miami-Dade | City demographics page later opened; no city HIV rate retrieved |
| shell curl | https://stacks.cdc.gov/view/cdc/177772/cdc_177772_DS1.xlsx | Downloaded and parsed Table 16, Table 18, Table A3, Table 1a |
| shell curl -k | CDPH PDF after SSL certificate failure on ordinary curl and failed open_page | https://www.cdph.ca.gov/Programs/CID/DOA/CDPH%20Document%20Library/California-HIV-Surveillance-Report-2024.pdf parsed with pypdf |
| shell curl -k | https://ruhealth.org/media/6416 and https://www.ruhealth.org/media/6411 | November 2024 and November 2025 RUHS-PH slide reports parsed with pypdf |
| shell curl | https://williamsinstitute.law.ucla.edu/wp-content/uploads/MSA-LGBT-Ranking-Mar-2021.pdf | Parsed with pypdf |
| shell curl | https://williamsinstitute.law.ucla.edu/wp-content/uploads/LGBT-Adult-US-Pop-Dec-2023.pdf | Parsed with pypdf |
| shell curl | https://stacks.cdc.gov/view/cdc/162349/cdc_162349_DS1.pdf | NHBS Special Report 37 parsed with pypdf |
| open_page | https://williamsinstitute.law.ucla.edu/publications/lgbt-us-msa/ | Confirmed download link and March 2021 page date |
| open_page | https://escholarship.org/uc/item/84q0f822 | Landing page only; PDF text came from the Williams Institute file above |
| open_page | https://stacks.cdc.gov/view/cdc/177772 | Confirmed title and 2025-04-29 publication date |
| open_page | https://www.cdc.gov/hiv-data/nhss/hiv-diagnoses-deaths-prevalence.html | 2024 national release; MSA 2024 workbook not parsed |
| open_page | https://www.wiltonmanors.gov/92/Demographics | City page supporting a Miami-area LGBTQ place note; no HIV rate |
| open_page | CDPH PDF URL | Failed. Alternate was curl -k, recorded above |
| http_request | CDPH PDF | Failed: SSL verification cannot be disabled in this environment |

Failed or unused retrievals, recorded so they are not silent:

- CDC Table 18 and Table A3 do not contain a Coachella Valley row. The nearest CDC geographies are Riverside County (Table A3, persons aged 13 and older) and the Riverside–San Bernardino–Ontario MSA (Table 18).
- The Williams Institute MSA brief does not contain a Coachella Valley, Palm Springs, or Wilton Manors row. It does contain the Riverside–San Bernardino–Ontario MSA, which is not the valley.
- Queries for a HARC or other probability-survey estimate of the share of Coachella Valley adults who are LGBT or LGBTQ did not yield a page this run opened with that statistic. News descriptions of an LGBTQ respondent survey are not a population share and are not used as prevalence.
- NHBS 2023 does not include Miami or any Riverside County or Coachella Valley site.
- AIDSVu city-profile rates were seen only in search snippets. Those numbers are not cited.
- The 2024 CDC MSA workbook linked from the May 18, 2026 CDC page was not downloaded or parsed. The 2024 national statements on that page are cited only as a different-year national note.
- The Williams Institute 2010 Census Snapshot linked from the Wilton Manors page was not opened. The city’s “second gayest city” paraphrase is not extracted as a statistic.

## How to read the tables

Columns follow the protocol, with denominator definition kept separate from the interval column. “Not applicable” means the source did not publish that field. Group is the population the source actually measured, not an inferred LGBTQ group.

Geography labels used here:

- Coachella Valley means the RUHS-PH region of that name, not Palm Springs alone.
- Riverside County is the county, which includes the valley and large areas outside it.
- Riverside–San Bernardino–Ontario MSA includes San Bernardino County and is not the valley.
- CDC MSA and metropolitan-division names are copied from Table 18. They are not city-proper rates.
- CDPH local health jurisdiction rows are counties, except where a city health jurisdiction is explicitly named. Los Angeles County totals include Long Beach and Pasadena. This run does not substitute those city subsets for Los Angeles.

No west-versus-east label is applied. RUHS-PH names subregions and ZIP clusters. This dossier repeats those names. It does not reclassify them as west valley or east valley.

## Indicator 1. New HIV diagnoses and diagnosis rate

### 1A. CDC Table 18, 2023, common MSA series

Source: Centers for Disease Control and Prevention (2025). Table 18 in the Excel tables for *Diagnoses, deaths, and prevalence of HIV in the United States and 6 territories and freely associated states, 2023*. Diagnoses are by residence at HIV diagnosis. Rates are per 100,000 population. The table title does not restrict the age group. In the same workbook, Table 16’s all-ages total diagnosis rate is 11.6 and its persons-aged-13-and-older rate is 13.7. Table 18’s total diagnosis rate is 11.6. Table 18 is therefore not the same denominator as the aged-13-and-older series. Table 18’s total covers the 50 states, the District of Columbia, and Puerto Rico, not all six territories and freely associated states, and includes persons whose county of residence is unknown. Prevalence in this table uses preliminary 2023 death data reported to CDC as of December 2024. Indented rows are metropolitan divisions with population greater than 500,000. For San Francisco–Oakland–Berkeley, the footnote states that division diagnosis counts do not sum to the MSA total.

These rows are comparable to each other. They are not city-proper rates. They are not comparable, without a denominator note, to Table A3, to CDPH all-age county rates, or to RUHS-PH regional rates.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New HIV diagnoses, count | Persons with diagnosed HIV; not an LGBT identity group | Los Angeles–Long Beach–Anaheim, CA MSA | 2023 | 1,889 | Rate 14.8 per 100,000; rank 28 | Not applicable; census case surveillance | Residence at diagnosis; rate per 100,000 population; age not restricted in Table 18 | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity. Transmission category is not in this table | MSA, not the City of Los Angeles. Same table as other rows in this section |
| New HIV diagnoses, count | Same | Los Angeles–Long Beach–Glendale, CA metropolitan division | 2023 | 1,628 | Rate 16.8 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division inside the Los Angeles MSA, still not the city proper |
| New HIV diagnoses, count | Same | San Francisco–Oakland–Berkeley, CA MSA | 2023 | 606 | Rate 13.3 per 100,000; rank 36 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA includes East Bay. Footnote: division counts do not sum to the MSA total |
| New HIV diagnoses, count | Same | San Francisco–San Mateo–Redwood City, CA metropolitan division | 2023 | 262 | Rate 17.1 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division, not the City and County of San Francisco alone |
| New HIV diagnoses, count | Same | San Diego–Chula Vista–Carlsbad, CA MSA | 2023 | 389 | Rate 11.9 per 100,000; rank 45 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the City of San Diego alone. In this case the MSA is San Diego County |
| New HIV diagnoses, count | Same | New York–Newark–Jersey City, NY–NJ MSA | 2023 | 2,635 | Rate 13.5 per 100,000; rank 33 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Multi-state MSA as named in the workbook (NY–NJ), not New York City alone |
| New HIV diagnoses, count | Same | New York–Jersey City–White Plains, NY–NJ metropolitan division | 2023 | 2,031 | Rate 17.1 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Closer to the New York urban core than the full MSA; still not New York City alone |
| New HIV diagnoses, count | Same | Chicago–Naperville–Elgin, IL–IN–WI MSA | 2023 | 1,370 | Rate 14.8 per 100,000; rank 26 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Tri-state MSA, not the City of Chicago |
| New HIV diagnoses, count | Same | Chicago–Naperville–Schaumburg, IL metropolitan division | 2023 | 1,204 | Rate 17.0 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Illinois division, not the city proper |
| New HIV diagnoses, count | Same | Atlanta–Sandy Springs–Roswell, GA MSA | 2023 | 1,567 | Rate 24.8 per 100,000; rank 3 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the City of Atlanta |
| New HIV diagnoses, count | Same | Atlanta–Sandy Springs–Roswell, GA metropolitan division | 2023 | 1,353 | Rate 27.5 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division inside the Atlanta MSA |
| New HIV diagnoses, count | Same | Miami–Fort Lauderdale–Pompano Beach, FL MSA | 2023 | 1,845 | Rate 29.8 per 100,000; rank 2 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Tri-county-scale MSA, not the City of Miami and not Wilton Manors |
| New HIV diagnoses, count | Same | Miami–Miami Beach–Kendall, FL metropolitan division | 2023 | 1,026 | Rate 38.2 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Miami division, still broader than the City of Miami |
| New HIV diagnoses, count | Same | Fort Lauderdale–Pompano Beach–Sunrise, FL metropolitan division | 2023 | 553 | Rate 28.2 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Broward-area division. Wilton Manors is in Broward County; this row is not a Wilton Manors rate |
| New HIV diagnoses, count | Same | Seattle–Tacoma–Bellevue, WA MSA | 2023 | 268 | Rate 6.6 per 100,000; rank 90 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the City of Seattle |
| New HIV diagnoses, count | Same | Seattle–Bellevue–Kent, WA metropolitan division | 2023 | 176 | Rate 7.7 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Seattle division, not the city proper |
| New HIV diagnoses, count | Same | Riverside–San Bernardino–Ontario, CA MSA | 2023 | 595 | Rate 12.7 per 100,000; rank 41 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Not Coachella Valley and not Riverside County alone. Includes San Bernardino County |
| New HIV diagnoses, count | Same | Table 18 total: 50 states, District of Columbia, and Puerto Rico | 2023 | 39,239 | Rate 11.6 per 100,000 | Not applicable | Same; includes unknown county of residence | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | National benchmark inside this table. Not the six-territory total in Table 16 |

### 1B. CDC Table 16, 2023, area totals with an explicit age split

Same workbook. Rates per 100,000 population. These state and national rows are not substitutes for the cities. They show why an all-ages rate and an aged-13-and-older rate must not be compared as if they were the same indicator.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New HIV diagnoses | Persons aged 13 and older | United States and 6 territories and freely associated states | 2023 | 39,201 | Rate 13.7 per 100,000 | Not applicable | Residence at diagnosis; persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Not comparable to Table 18’s 11.6 all-population rate |
| New HIV diagnoses | All ages in the table’s total column | United States and 6 territories and freely associated states | 2023 | 39,258 | Rate 11.6 per 100,000; includes 57 diagnoses among children under 13 (rate 0.1) | Not applicable | All ages; rate per 100,000 population | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Matches the Table 18 total rate, not the aged-13-and-older rate |
| New HIV diagnoses | Persons aged 13 and older | United States only | 2023 | 38,850 | Rate 11.6 per 100,000 | Not applicable | Table 1a, United States; age restriction is not stated in the extracted table title. Male count 31,500, rate 19.0; female count 7,350, rate 4.3 | CDC NHSS Table 1a | https://stacks.cdc.gov/view/cdc/177772 | Sex in this table is the surveillance sex classification, not gender identity | United States only, so the numerator is smaller than Table 16. Do not treat the shared 11.6 rate as proof of an identical denominator |
| New HIV diagnoses | Persons aged 13 and older | California | 2023 | 4,918 | Rate 14.9 per 100,000 | Not applicable | Persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | State, not Riverside County or the valley. All-ages count in the same row is 4,921, rate 12.6 |
| New HIV diagnoses | Persons aged 13 and older | Florida | 2023 | 4,438 | Rate 22.7 per 100,000 | Not applicable | Persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | State, not Miami. All-ages count 4,444, rate 19.7 |
| New HIV diagnoses | Persons aged 13 and older | Georgia | 2023 | 2,359 | Rate 25.5 per 100,000 | Not applicable | Persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | State, not Atlanta. All-ages count 2,363, rate 21.4 |
| New HIV diagnoses | Persons aged 13 and older | Illinois | 2023 | 1,569 | Rate 14.7 per 100,000 | Not applicable | Persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | State, not Chicago. All-ages count 1,573, rate 12.5 |
| New HIV diagnoses | Persons aged 13 and older | New York | 2023 | 2,369 | Rate 14.1 per 100,000 | Not applicable | Persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | State, not New York City. All-ages count 2,370, rate 12.1 |
| New HIV diagnoses | Persons aged 13 and older | Washington | 2023 | 419 | Rate 6.3 per 100,000 | Not applicable | Persons aged 13 and older | CDC NHSS Table 16 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | State, not Seattle. All-ages count 419, rate 5.4 |

### 1C. CDC Table A3, 2023, Ending the HIV Epidemic counties, persons aged 13 and older

Same workbook. Data are residence at diagnosis, cases reported through December 2024, persons aged 13 and older, rate per 100,000. This series is comparable across the listed counties. It is not comparable to Table 18 without stating the age restriction. It does not report New York City as one place, Atlanta as one place, or Coachella Valley at all. The Table A3 total is the Ending the HIV Epidemic Phase I jurisdictions, not the United States.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New HIV diagnoses | Persons aged 13 and older | Los Angeles County, CA | 2023 | 1,627 | Rate 19.6 per 100,000 | Not applicable | County of residence at diagnosis; persons aged 13 and older | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County, not the City of Los Angeles. Not the Table 18 MSA rate of 14.8 |
| New HIV diagnoses | Persons aged 13 and older | San Francisco County, CA | 2023 | 185 | Rate 25.4 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County, not the Bay Area MSA rate of 13.3 |
| New HIV diagnoses | Persons aged 13 and older | San Diego County, CA | 2023 | 389 | Rate 13.9 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Same count as the Table 18 San Diego MSA (389) but a different rate (13.9 versus 11.9) because the age denominator differs |
| New HIV diagnoses | Persons aged 13 and older | Riverside County, CA | 2023 | 299 | Rate 14.3 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County, not Coachella Valley. Not the Inland Empire MSA |
| New HIV diagnoses | Persons aged 13 and older | Cook County, IL | 2023 | 1,075 | Rate 24.7 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County proxy for Chicago; includes suburbs. Not the Chicago MSA |
| New HIV diagnoses | Persons aged 13 and older | Fulton County, GA | 2023 | 445 | Rate 48.1 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | One Atlanta-area county, not the Atlanta MSA |
| New HIV diagnoses | Persons aged 13 and older | DeKalb County, GA | 2023 | 307 | Rate 48.0 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Second Atlanta-area county. Do not add to Fulton in this dossier |
| New HIV diagnoses | Persons aged 13 and older | Miami-Dade County, FL | 2023 | 1,024 | Rate 44.3 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County, not the City of Miami and not Wilton Manors |
| New HIV diagnoses | Persons aged 13 and older | Broward County, FL | 2023 | 552 | Rate 32.9 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County containing Wilton Manors. Not a Wilton Manors rate |
| New HIV diagnoses | Persons aged 13 and older | New York County, NY | 2023 | 297 | Rate 20.6 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Manhattan only. Not New York City |
| New HIV diagnoses | Persons aged 13 and older | Kings County, NY | 2023 | 470 | Rate 21.8 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Brooklyn only. Not New York City. Other boroughs were not extracted |
| New HIV diagnoses | Persons aged 13 and older | King County, WA | 2023 | 176 | Rate 9.0 per 100,000 | Not applicable | Same | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | County proxy for Seattle; not the city and not the Seattle MSA rate of 6.6 |
| New HIV diagnoses | Persons aged 13 and older | Ending the HIV Epidemic Phase I jurisdictions, total | 2023 | 18,183 | Rate 23.5 per 100,000 | Not applicable | Sum of Phase I jurisdictions, not the United States | CDC NHSS Table A3 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Not a national benchmark |

### 1D. CDPH, 2023 and 2024, California counties, all ages

California Department of Public Health, Office of AIDS, *California HIV Surveillance Report — 2024*, released June 2026. Data reported through December 31, 2025. Rates per 100,000 population. New-diagnosis age is age at diagnosis. The report includes all ages; it does not publish a separate aged-13-and-older county rate in the extracted tables. Los Angeles County includes Long Beach and Pasadena. These California rows are comparable to each other. They are not comparable to CDC Table 18 or Table A3 without a surveillance-system and denominator note. CDPH’s 2023 Riverside count (296) is close to CDC Table A3’s 299, but the rates are 12.1 and 14.3 because the denominators differ.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persons newly diagnosed with HIV | All ages; county of residence at diagnosis | Riverside County | 2023 | 296 | 5.9% of California diagnoses; rate 12.1 per 100,000 | Not applicable | Local health jurisdiction; rate per 100,000 population | CDPH Office of AIDS, Table 1c | https://www.cdph.ca.gov/Programs/CID/DOA/CDPH%20Document%20Library/California-HIV-Surveillance-Report-2024.pdf | Not identity. See gender note below if gender is used from this report | County, not the valley. Comparable to other CDPH 2023 county rows |
| Persons newly diagnosed with HIV | Same | Riverside County | 2024 | 297 | 6.5% of California diagnoses; rate 12.1 per 100,000 | Not applicable | Same | CDPH Table 1c | Same URL | Not identity | Same county series, later year. Not a CDC 2023 MSA rate |
| Persons newly diagnosed with HIV | Same | Los Angeles County | 2023 | 1,679 | 33.6%; rate 17.1 | Not applicable | Same; includes Long Beach and Pasadena | CDPH Table 1c | Same URL | Not identity | County, not the city. Not the CDC MSA rate |
| Persons newly diagnosed with HIV | Same | Los Angeles County | 2024 | 1,443 | 31.8%; rate 14.7 | Not applicable | Same | CDPH Table 1c | Same URL | Not identity | Same series, 2024 |
| Persons newly diagnosed with HIV | Same | San Francisco | 2023 | 188 | 3.8%; rate 22.4 | Not applicable | Local health jurisdiction | CDPH Table 1c | Same URL | Not identity | County/city health jurisdiction, not the Bay Area MSA |
| Persons newly diagnosed with HIV | Same | San Francisco | 2024 | 187 | 4.1%; rate 22.3 | Not applicable | Same | CDPH Table 1c | Same URL | Not identity | Same series, 2024 |
| Persons newly diagnosed with HIV | Same | San Diego County | 2023 | 396 | 7.9%; rate 12.0 | Not applicable | Same | CDPH Table 1c | Same URL | Not identity | County. CDC Table 18 count for the San Diego MSA in 2023 was 389; do not treat the counts as identical |
| Persons newly diagnosed with HIV | Same | San Diego County | 2024 | 421 | 9.3%; rate 12.8 | Not applicable | Same | CDPH Table 1c | Same URL | Not identity | Same series, 2024 |
| Persons newly diagnosed with HIV | Same | California | 2023 | 5,004 | Rate 12.8 per 100,000 | Not applicable | State | CDPH Table 1c | Same URL | Not identity | State benchmark for the CDPH series only |
| Persons newly diagnosed with HIV | Same | California | 2024 | 4,538 | Rate 11.6 per 100,000 | Not applicable | State | CDPH Table 1c | Same URL | Not identity | Same series, 2024. The identical 11.6 figure in CDC Table 18 is a different geography and year |

CDPH gender measurement, for any later use of this report: persons were classified as transgender if a case report form affirming transgender status was present by December 31, 2025; otherwise they were classified by sex at birth. Transmission category is behavior, not identity. The report states that gay, bisexual, and other men who have sex with men are placed in male-to-male sexual contact. That sentence mixes identity language with a behavioral category. This dossier does not use a CDPH transmission percentage as an LGBT prevalence.

### 1E. Coachella Valley and Riverside County local series

RUHS-PH, Epidemiology and Program Evaluation, *Epidemiology of HIV/AIDS in Riverside County, 2024* (November 2025), https://www.ruhealth.org/media/6411. HIV statistics are cases reported as of December 31, 2024, extracted from eHARS in the second quarter of 2025, unless otherwise noted. Rates are per 100,000 population. Population denominators are California Department of Finance Report P-3 (vintage 2020 release, July 2021) and U.S. Census Bureau 2017–2021 American Community Survey 5-year data via Esri Community Analyst. The report says regional boundaries were updated and comparisons with previous reports should be done with caution. Provisional 2024 numbers are labeled as provisional in the slides.

An earlier slide report, *Epidemiology of HIV in Riverside County, 2023* (November 2024), https://ruhealth.org/media/6416, also says boundaries were updated. Its 2023 valley rates are not used as the primary series because they do not match the later report’s 2023 valley rates. Both are extracted so the conflict is visible. Neither is a CDC rate.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persons newly diagnosed with HIV | Surveillance cases; not an LGBT sample | Coachella Valley region, Riverside County | 2023 | 92 | 30.7% of county new diagnoses; rate 13.2 per 100,000 | Not applicable | RUHS-PH region; rate per 100,000 population; November 2025 boundary vintage | RUHS-PH 2024 report, Table 1 | https://www.ruhealth.org/media/6411 | Not identity | Not comparable to CDC MSA rates. Not Palm Springs alone |
| Persons newly diagnosed with HIV | Same | Coachella Valley region | 2024 | 79 | 26.2%; rate 11.2 per 100,000 | Not applicable | Same; 2024 labeled provisional in the incidence slides | RUHS-PH 2024 report, Table 1 | https://www.ruhealth.org/media/6411 | Not identity | Latest local valley diagnosis row. Not a city comparator |
| Persons newly diagnosed with HIV | Same | Eastern Riverside County region | 2023 | 0 | Rate not calculated in the table (dash) | Not applicable | Same report’s eastern region, which is not the same as the Indio/Coachella ZIP cluster | RUHS-PH 2024 report, Table 1 | https://www.ruhealth.org/media/6411 | Not identity | Small count. The source separates this region from Coachella Valley |
| Persons newly diagnosed with HIV | Same | Eastern Riverside County region | 2024 | 2 | Rate 5.8 per 100,000 | Not applicable | Same | RUHS-PH 2024 report, Table 1 | https://www.ruhealth.org/media/6411 | Not identity | Count below the source’s caution threshold for some other small-cell rates |
| Persons newly diagnosed with HIV | Same | Riverside County | 2023 | 300 | Rate 11.5 per 100,000 | Not applicable | County; November 2025 report | RUHS-PH 2024 report, Table 1 | https://www.ruhealth.org/media/6411 | Not identity | Not the same as CDPH 296 / 12.1 or CDC Table A3 299 / 14.3 |
| Persons newly diagnosed with HIV | Same | Riverside County | 2024 | 302 | Rate 11.4 per 100,000 | Not applicable | County | RUHS-PH 2024 report, Table 1 | https://www.ruhealth.org/media/6411 | Not identity | A chart in the same report prints a 2024 county incidence rate of 11.5. The table rate is 11.4. Both are reported; they are not reconciled here |
| Persons newly diagnosed with HIV | Same | Coachella Valley region | 2023 | 98 | Rate 21.7 per 100,000 | Not applicable | November 2024 report’s region definition | RUHS-PH 2023 report, incidence-by-region slide | https://ruhealth.org/media/6416 | Not identity | Not interchangeable with the later report’s 2023 valley rate of 13.2. Source warns that boundary changes limit comparison with previous reports |
| Persons newly diagnosed with HIV | Same | Riverside County | 2023 | 305 | Rate 11.7 per 100,000; slide text also says provisional | Not applicable | November 2024 report | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Not interchangeable with the later report’s county count of 300 |

The November 2025 report’s summary states that in 2024, 63.7% of newly diagnosed HIV cases were among gay, bisexual, same-gender-loving, or male-to-male sexual contact. That phrase combines identity language with a behavioral transmission category. The same report’s Table 1, which separates the fields, shows 2024 male-to-male sexual contact as 150 of 302 new diagnoses (49.7%) and unknown risk as 120 of 302 (39.7%). Gender identity in that table, 2024: cisgender man 221 (73.2%), cisgender woman 29 (9.6%), transgender woman 10 (3.3%), transgender man 1 (0.3%), unknown 41 (13.6%). Sex assigned at birth, 2024: male 267 (88.4%, rate 20.4), female 35 (11.6%, rate 2.6). These are surveillance classifications, not a population survey of LGBTQ adults. They are not comparable to NHBS.

No CDC Coachella Valley diagnosis rate was found. Searches and table extracts are listed in the methods log.

### 1F. 2024 national CDC page, different year, not in the MSA table

Opened page: Centers for Disease Control and Prevention (2026, May 18), *HIV diagnoses, deaths, and prevalence*, https://www.cdc.gov/hiv-data/nhss/hiv-diagnoses-deaths-prevalence.html. The page states that in 2024, in the United States and 7 territories and freely associated states, among persons aged 13 and older, there were 38,793 HIV diagnoses, and that in 2024 in the United States the HIV diagnosis rate was 13.3 per 100,000. The 2024 MSA workbook linked from that page was not parsed. These 2024 national figures are not placed in the 2023 MSA comparison.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New HIV diagnoses | Persons aged 13 and older | United States and 7 territories and freely associated states | 2024 | 38,793 | Rate not stated for this exact geography in the opened prose | Not applicable | Page states diagnoses among persons aged 13 and older; data reported through December 2025 | CDC HIV diagnoses, deaths, and prevalence page | https://www.cdc.gov/hiv-data/nhss/hiv-diagnoses-deaths-prevalence.html | Not identity. The same page says male-to-male sexual contact accounted for 65% (25,129) of diagnoses. That is transmission behavior, not LGBT identity | Different year and a 7-territory geography. Not comparable to the 2023 Table 18 MSA rates |
| New HIV diagnosis rate | The page’s “United States” statement in the aged-13-and-older section | United States | 2024 | 13.3 per 100,000 | Numerator for this rate was not separately printed in the opened prose | Not applicable | Page says all rates are per 100,000 population. The surrounding section is persons aged 13 and older | Same CDC page | Same URL | Not identity | Not comparable to CDPH’s 2024 California all-age rate of 11.6 or to Table 18 |

## Indicator 2. People living with diagnosed HIV, prevalence

### 2A. CDC Table 18, year-end 2023, same MSA series as Indicator 1A

Prevalence is the number of persons living with diagnosed HIV at year-end 2023, based on the most recent known address. Rate per 100,000 population. Preliminary death data, as noted above. Same geography mismatches as Indicator 1A. Comparable within this table only.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persons living with diagnosed HIV | Diagnosed HIV, all stages in this table; not LGBT identity | Los Angeles–Long Beach–Anaheim, CA MSA | Year-end 2023 | 59,183 | Rate 462.4 per 100,000 | Not applicable | Most recent known address; per 100,000 population | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the city |
| Persons living with diagnosed HIV | Same | Los Angeles–Long Beach–Glendale, CA division | Year-end 2023 | 51,670 | Rate 534.7 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | San Francisco–Oakland–Berkeley, CA MSA | Year-end 2023 | 22,725 | Rate 497.6 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the city |
| Persons living with diagnosed HIV | Same | San Francisco–San Mateo–Redwood City, CA division | Year-end 2023 | 13,099 | Rate 853.2 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | San Diego–Chula Vista–Carlsbad, CA MSA | Year-end 2023 | 13,977 | Rate 427.4 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA |
| Persons living with diagnosed HIV | Same | New York–Newark–Jersey City, NY–NJ MSA | Year-end 2023 | 136,725 | Rate 701.2 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not New York City |
| Persons living with diagnosed HIV | Same | New York–Jersey City–White Plains, NY–NJ division | Year-end 2023 | 112,231 | Rate 946 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | Chicago–Naperville–Elgin, IL–IN–WI MSA | Year-end 2023 | 31,260 | Rate 337.5 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the city |
| Persons living with diagnosed HIV | Same | Chicago–Naperville–Schaumburg, IL division | Year-end 2023 | 28,390 | Rate 401.2 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | Atlanta–Sandy Springs–Roswell, GA MSA | Year-end 2023 | 42,794 | Rate 678.5 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the city |
| Persons living with diagnosed HIV | Same | Atlanta–Sandy Springs–Roswell, GA division | Year-end 2023 | 37,766 | Rate 768.6 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | Miami–Fort Lauderdale–Pompano Beach, FL MSA | Year-end 2023 | 58,161 | Rate 940.6 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the City of Miami |
| Persons living with diagnosed HIV | Same | Miami–Miami Beach–Kendall, FL division | Year-end 2023 | 28,531 | Rate 1,061.9 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | Fort Lauderdale–Pompano Beach–Sunrise, FL division | Year-end 2023 | 21,068 | Rate 1,073.5 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Broward-area division, not Wilton Manors |
| Persons living with diagnosed HIV | Same | Seattle–Tacoma–Bellevue, WA MSA | Year-end 2023 | 10,639 | Rate 263 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | MSA, not the city |
| Persons living with diagnosed HIV | Same | Seattle–Bellevue–Kent, WA division | Year-end 2023 | 7,527 | Rate 331.4 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Division |
| Persons living with diagnosed HIV | Same | Riverside–San Bernardino–Ontario, CA MSA | Year-end 2023 | 16,329 | Rate 348.3 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Not the valley and not Riverside County alone |
| Persons living with diagnosed HIV | Same | Table 18 total: 50 states, District of Columbia, and Puerto Rico | Year-end 2023 | 1,133,059 | Rate 335.1 per 100,000 | Not applicable | Same | CDC NHSS Table 18 | https://stacks.cdc.gov/view/cdc/177772 | Not identity | Benchmark inside this table only |

Table 16, same workbook, adds the age split for the broader national total. Persons aged 13 and older living with diagnosed HIV: 1,132,739, rate 394.5 per 100,000. All ages: 1,133,768, rate 334.9. The all-ages prevalence rate is close to, but not the same number as, Table 18’s 335.1. Do not treat them as one estimate.

### 2B. CDPH persons living with diagnosed HIV, 2023 and 2024

Current local health jurisdiction. Rate per 100,000 population. Age for living cases is age at the end of the calendar year. Comparable within CDPH. Not comparable to CDC Table 18.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persons living with diagnosed HIV | Diagnosed HIV | Riverside County | 2023 | 11,278 | 7.8% of California; rate 460.1 | Not applicable | Current residence; per 100,000 population | CDPH Table 2c | CDPH 2024 report URL above | Not identity | County, not the valley |
| Persons living with diagnosed HIV | Same | Riverside County | 2024 | 11,236 | 7.8%; rate 457.6 | Not applicable | Same | CDPH Table 2c | Same | Not identity | Same series, 2024 |
| Persons living with diagnosed HIV | Same | Los Angeles County | 2023 | 52,587 | 36.6%; rate 536.0 | Not applicable | Includes Long Beach and Pasadena | CDPH Table 2c | Same | Not identity | County, not the CDC MSA count of 59,183 |
| Persons living with diagnosed HIV | Same | Los Angeles County | 2024 | 52,731 | 36.6%; rate 536.8 | Not applicable | Same | CDPH Table 2c | Same | Not identity | 2024 |
| Persons living with diagnosed HIV | Same | San Francisco | 2023 | 11,625 | 8.1%; rate 1,386.8 | Not applicable | Local health jurisdiction | CDPH Table 2c | Same | Not identity | Not the Bay Area MSA rate of 497.6 |
| Persons living with diagnosed HIV | Same | San Francisco | 2024 | 11,595 | 8.1%; rate 1,385.0 | Not applicable | Same | CDPH Table 2c | Same | Not identity | 2024 |
| Persons living with diagnosed HIV | Same | San Diego County | 2023 | 14,462 | 10.1%; rate 439.6 | Not applicable | Same | CDPH Table 2c | Same | Not identity | Close to, but not the same as, CDC Table 18 San Diego MSA prevalence 13,977 / 427.4 |
| Persons living with diagnosed HIV | Same | San Diego County | 2024 | 14,307 | 9.9%; rate 433.9 | Not applicable | Same | CDPH Table 2c | Same | Not identity | 2024 |
| Persons living with diagnosed HIV | Same | California | 2023 | 143,792 | Rate 367.5 | Not applicable | State | CDPH Table 2c | Same | Not identity | State benchmark for this series |
| Persons living with diagnosed HIV | Same | California | 2024 | 143,918 | Rate 367.4 | Not applicable | State | CDPH Table 2c | Same | Not identity | 2024 |

CDPH Table 2d, 2024, is care continuum, not prevalence. It is extracted only as an alignable clinical-access indicator in section 4. It is not an LGBTQ-specific indicator.

### 2C. Coachella Valley prevalence, with Palm Springs separated

Primary series: RUHS-PH November 2025 report, Table 2. Rates per 100,000 population. The valley row is not Palm Springs.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persons living with diagnosed HIV | Diagnosed HIV, all stages | Coachella Valley region | 2023 | 7,289 | 64.5% of county PLWH; rate 1,045.8 per 100,000 | Not applicable | November 2025 region definition | RUHS-PH 2024 report, Table 2 | https://www.ruhealth.org/media/6411 | Not identity | Not comparable to CDC MSA prevalence. Not Palm Springs |
| Persons living with diagnosed HIV | Same | Coachella Valley region | 2024 | 7,227 | 63.3%; rate 1,027.1 | Not applicable | Same | RUHS-PH 2024 report, Table 2 | https://www.ruhealth.org/media/6411 | Not identity | Latest valley prevalence row |
| Persons living with diagnosed HIV | Same | Riverside County | 2023 | 11,306 | Rate 434.3 | Not applicable | County in the same table | RUHS-PH 2024 report, Table 2 | https://www.ruhealth.org/media/6411 | Not identity | Not CDPH’s 11,278 / 460.1 |
| Persons living with diagnosed HIV | Same | Riverside County | 2024 | 11,412 | Rate 432.5 | Not applicable | Same | RUHS-PH 2024 report, Table 2 | https://www.ruhealth.org/media/6411 | Not identity | Not CDPH’s 2024 county rate of 457.6 |
| Persons living with diagnosed HIV | Same | Eastern Riverside County region | 2023 | 37 | 0.3%; rate 150.9 | Not applicable | Separate region in the same table | RUHS-PH 2024 report, Table 2 | https://www.ruhealth.org/media/6411 | Not identity | Not the Coachella Valley row |
| Persons living with diagnosed HIV | Same | Eastern Riverside County region | 2024 | 38 | 0.3%; rate 111.0 | Not applicable | Same | RUHS-PH 2024 report, Table 2 | https://www.ruhealth.org/media/6411 | Not identity | Small count |
| Persons living with diagnosed HIV | Same | Coachella Valley region | 2023 | 7,619 | Regional chart rate 1,686.6 per 100,000 | Not applicable | November 2024 report region | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Conflicts with the later report’s 2023 valley count 7,289 and rate 1,045.8. Do not average |
| Persons living with diagnosed HIV | Same | Riverside County | 2023 | 11,792 | Rate 481.8 per 100,000 | Not applicable | November 2024 report | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Conflicts with the later report and with CDPH. Boundary and extract timing differ |

Named subregion prevalence inside the Coachella Valley, from the same reports. These are not a west/east classification. Palm Springs/North Palm Springs is one cluster. Indio/Coachella/Mecca/Thermal is another. The source’s own comparison, not a gap calculated here: the November 2025 report states that the Palm Springs/North Palm Springs prevalence rate of 7,666.0 per 100,000 is over 21 times the California 2023 overall rate of 355.0 per 100,000 that the report cites. The November 2024 report states that Palm Springs/North Palm Springs, 8,134.3 per 100,000, is over 22 times California 2022 overall, 355.6 per 100,000. Those California comparison rates are the local report’s citations of statewide figures available at the time, not the CDPH 2023 rate of 367.5 extracted above.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PLWH prevalence rate | Diagnosed HIV | Desert Hot Springs, Whitewater | 2024 | 1,107.2 per 100,000 | Count not printed on the extracted slide | Not applicable | ZIP cluster in the November 2025 report | RUHS-PH 2024 report, valley subregion slide | https://www.ruhealth.org/media/6411 | Not identity | Not the valley rate. Not comparable to city MSAs |
| PLWH prevalence rate | Same | Palm Springs/North Palm Springs | 2024 | 7,666.0 per 100,000 | Count not printed on the extracted slide | Not applicable | ZIP cluster; the report lists 92262–92264 and related ZIPs in the key | RUHS-PH 2024 report | https://www.ruhealth.org/media/6411 | Not identity | Palm Springs cluster only. Must not be used as the Coachella Valley rate |
| PLWH prevalence rate | Same | Cathedral City | 2024 | 2,739.2 per 100,000 | Count not printed | Not applicable | ZIP cluster | RUHS-PH 2024 report | https://www.ruhealth.org/media/6411 | Not identity | Named city cluster, not the valley |
| PLWH prevalence rate | Same | Rancho Mirage | 2024 | 2,991.0 per 100,000 | Count not printed | Not applicable | ZIP cluster | RUHS-PH 2024 report | https://www.ruhealth.org/media/6411 | Not identity | Named city cluster |
| PLWH prevalence rate | Same | Palm Desert/Thousand Palms/Indian Wells/La Quinta | 2024 | 519.1 per 100,000 | Count not printed | Not applicable | Combined ZIP cluster as named by the source | RUHS-PH 2024 report | https://www.ruhealth.org/media/6411 | Not identity | Source combines these places. This dossier does not split them |
| PLWH prevalence rate | Same | Indio/Coachella/Mecca/Thermal | 2024 | 211.7 per 100,000 | Count not printed | Not applicable | Combined ZIP cluster as named by the source | RUHS-PH 2024 report | https://www.ruhealth.org/media/6411 | Not identity | Source combines these places. Not labeled east valley by the source |
| PLWH prevalence rate | Same | Palm Springs/North Palm Springs | 2023 | 8,134.3 per 100,000 | Count not printed | Not applicable | November 2024 report cluster | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Different report year and boundary warning. Not the 2024 cluster rate |
| PLWH prevalence rate | Same | Indio/Coachella/Mecca/Thermal | 2023 | 205.3 per 100,000 | Count not printed | Not applicable | November 2024 report cluster | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Same caution |
| PLWH prevalence rate | Same | Desert Hot Springs, Whitewater | 2023 | 1,132.1 per 100,000 | Count not printed | Not applicable | November 2024 report | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Same caution |
| PLWH prevalence rate | Same | Cathedral City | 2023 | 2,882.8 per 100,000 | Count not printed | Not applicable | November 2024 report | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Same caution |
| PLWH prevalence rate | Same | Rancho Mirage | 2023 | 3,251.4 per 100,000 | Count not printed | Not applicable | November 2024 report | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Same caution |
| PLWH prevalence rate | Same | Palm Desert/Thousand Palms/Indian Wells/La Quinta | 2023 | 555.2 per 100,000 | Count not printed | Not applicable | November 2024 report | RUHS-PH 2023 report | https://ruhealth.org/media/6416 | Not identity | Same caution |

The November 2025 report also states that 7,227 people were reported living with HIV in the Coachella Valley; that 63.3% of county PLWH lived in that region; that the median age of persons living with HIV in the valley was 62 years, compared with 59 years in the rest of the county; and that 63.3% of people living with HIV in the valley were 60 or older, compared with 48.9% in the rest of Riverside County. The rest-of-county comparison is the source’s, not a gap computed here. It is age among people with diagnosed HIV, not the age of LGBTQ residents.

Gender identity among county PLWH in the November 2025 Table 2, 2024, is surveillance identity, not a population share: cisgender man 9,944 (87.1%), cisgender woman 800 (7.0%), transgender woman 61 (0.5%), transgender man 5 (0.04%), unknown 602 (5.3%). The table’s gender-identity count for transgender men in 2022 is printed as 555 (5.0%), which is inconsistent with the 2023 and 2024 transgender-man counts of 4 and 5. That 2022 cell is not used. Rates for transgender people are not calculated by the source because the transgender population denominator is uncertain. Sex assigned at birth is a separate field: 2024 male 10,527 (92.2%, rate 802.8), female 872 (7.6%, rate 65.7).

## Indicator 3. LGBT adult population share

Two methods were opened. They are not combined.

### 3A. Gallup Daily Tracking, Williams Institute MSA brief

Conron, Luhur, and Goldberg. Suggested citation date December 2020; Williams Institute publication page dated March 2021. PDF: https://williamsinstitute.law.ucla.edu/wp-content/uploads/MSA-LGBT-Ranking-Mar-2021.pdf. Publication page: https://williamsinstitute.law.ucla.edu/publications/lgbt-us-msa/.

Measurement: adults aged 18 and older. One Gallup item: “Do you, personally, identify as lesbian, gay, bisexual, or transgender?” Yes is classified as LGBT. No is non-LGBT. This single item combines sexual orientation and transgender status. It does not separate lesbian, gay, bisexual, and transgender adults, and it does not identify nonbinary adults who would not answer yes to that item. Estimates from other sexual-orientation or gender-identity measures may differ, as the brief states. Data are aggregated from June 1, 2012, through December 31, 2017. Percentages use Gallup post-stratification MSA weights. Counts apply the weighted percentage to the 2017 American Community Survey adult population aged 18 and older and round to the nearest 1,000. The printed range is the 95% confidence interval of the percentage applied to that population and then rounded. It is not a confidence interval reprinted as a percentage. MSAs were included if the aggregated Gallup sample had at least 200 LGBT-identified respondents. The MSA sample size itself is not printed. The brief does not report a United States percentage. A national Gallup figure is therefore not taken from this source.

These rows are comparable to each other. They are not comparable to the BRFSS estimates in section 3B. They are metro areas, not city proper, and not Coachella Valley. The Riverside–San Bernardino–Ontario row is the closest geography in this source. It is not a valley estimate.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LGBT adult share | Adults 18 and older who answered yes to the Gallup LGBT item | Los Angeles–Long Beach–Anaheim, CA Metro Area | Survey 2012–2017; population year 2017 | 5.1% | 523,000 adults; range 499,000 to 548,000 | At least 200 LGBT respondents required for inclusion; exact n not printed | Weighted percent of adults; count applied to 2017 ACS adults 18 and older | Conron, Luhur, & Goldberg, Tables 1–3 | https://williamsinstitute.law.ucla.edu/wp-content/uploads/MSA-LGBT-Ranking-Mar-2021.pdf | Single combined LGBT identity item, not separate orientation and gender identity | MSA, not the City of Los Angeles. Not comparable to BRFSS 2020–2021 |
| LGBT adult share | Same | San Francisco–Oakland–Berkeley, CA Metro Area | Same | 6.7% | 247,000; range 232,000 to 262,000 | Same inclusion rule; exact n not printed | Same | Same | Same URL | Same combined item | Bay Area MSA, not the City of San Francisco. Highest percentage among the 55 MSAs in the brief |
| LGBT adult share | Same | San Diego–Chula Vista–Carlsbad, CA Metro Area | Same | 4.5% | 115,000; range 105,000 to 126,000 | Same | Same | Same | Same URL | Same | MSA |
| LGBT adult share | Same | New York–Newark–Jersey City, NY–NJ–PA Metro Area | Same | 4.5% | 706,000; range 681,000 to 733,000 | Same | Same | Same | Same URL | Same | Multi-state MSA, not New York City. Largest LGBT adult count in the brief |
| LGBT adult share | Same | Chicago–Naperville–Elgin, IL–IN–WI Metro Area | Same | 4.1% | 298,000; range 280,000 to 316,000 | Same | Same | Same | Same URL | Same | Tri-state MSA, not the city |
| LGBT adult share | Same | Atlanta–Sandy Springs–Alpharetta, GA Metro Area | Same | 4.6% | 194,000; range 182,000 to 207,000 | Same | Same | Same | Same URL | Same | Brief aggregates earlier Atlanta MSA boundary names into one Atlanta area. Not the city |
| LGBT adult share | Same | Miami–Fort Lauderdale–Pompano Beach, FL Metro Area | Same | 4.5% | 214,000; range 199,000 to 230,000 | Same | Same | Same | Same URL | Same | MSA, not the City of Miami and not Wilton Manors |
| LGBT adult share | Same | Seattle–Tacoma–Bellevue, WA Metro Area | Same | 5.2% | 152,000; range 141,000 to 163,000 | Same | Same | Same | Same URL | Same | MSA, not the city |
| LGBT adult share | Same | Riverside–San Bernardino–Ontario, CA Metro Area | Same | 4.0% | 133,000; range 122,000 to 145,000 | Same | Same | Same | Same URL | Same | Not Coachella Valley. Includes San Bernardino County and the western Inland Empire |
| LGBT adult share | Same | United States | Same years | Not found in this brief | Not applicable | Not applicable | The brief does not print a national percentage | Same | Same URL | Same item, but no national estimate was published in the opened PDF | Failed within-source search. Do not borrow 5.5% from section 3B |

### 3B. BRFSS 2020–2021, Williams Institute national and state estimates

Flores and Conron (2023), *Adult LGBT population in the United States*. https://williamsinstitute.law.ucla.edu/wp-content/uploads/LGBT-Adult-US-Pop-Dec-2023.pdf. This is a different method and a different period from section 3A. It is the national benchmark for LGBT identity in this dossier, and it is not comparable to the MSA percentages.

Measurement, from the report: BRFSS optional SOGI module. Sexual orientation: “Which of the following best represents how you think of yourself?” Response options include “Gay or lesbian,” “Straight, that is, not gay,” “Bisexual,” “Something else,” and “I don’t know the answer,” or refusal. Transgender status: “Do you consider yourself to be transgender?” with “Yes,” “No,” and “Don’t know/not sure,” or refusal. Affirmative answers are followed by male-to-female, female-to-male, or gender nonconforming. Respondents asked the sexual-orientation item are coded LGB if they identify as lesbian, gay, or bisexual; “something else,” “don’t know,” and refusal are coded not LGB. Transgender yes is coded transgender; don’t know, not sure, and refusal are coded not transgender. A respondent who was LGB and/or transgender is classified as LGBT. The 5.5% figure therefore combines sexual orientation and gender identity. It is not a transgender-only share and not a cisgender sexual-minority share. Pooled 2020–2021 BRFSS; 37 states and Guam used the module once or twice (n = 484,477). Direct estimates are used where the module was fielded. Florida is marked as model-based in Table 1. California, Georgia, Illinois, New York, and Washington are not asterisked in Table 1, so they are direct estimates. The national interval below is the report’s Table A2b bound for all adults 18 and older.

No city or Coachella Valley estimate is in this report.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LGBT adult share | Adults 18 and older classified LGBT if LGB and/or transgender on the BRFSS SOGI module | United States | 2020–2021 | 5.5% | 13,942,200 adults; Table A2b percent bounds 5.2% to 6.6%; count bounds 13,094,710 to 16,564,598 | Module analytic pool n = 484,477 across participating states and Guam; national figure also uses model-based state estimates where the module was absent | Adults; direct estimates where available, model-based otherwise; counts rounded | Flores & Conron, 2023, Tables 1 and A2b | https://williamsinstitute.law.ucla.edu/wp-content/uploads/LGBT-Adult-US-Pop-Dec-2023.pdf | Separate orientation and transgender questions, then combined into LGBT. “Something else” is not counted as LGB | Not comparable to Gallup MSA percentages. Not a city rate |
| LGBT adult share | Same | California | 2020–2021 | 5.1% | 1,549,600 | State sample size not printed | Direct BRFSS estimate; adults | Flores & Conron, Table 1 | Same URL | Same | State, not the valley and not Los Angeles, San Francisco, or San Diego |
| LGBT adult share | Same | New York | 2020–2021 | 5.5% | 853,600 | Not printed | Direct estimate | Flores & Conron, Table 1 | Same URL | Same | State, not New York City |
| LGBT adult share | Same | Illinois | 2020–2021 | 4.5% | 446,600 | Not printed | Direct estimate | Flores & Conron, Table 1 | Same URL | Same | State, not Chicago |
| LGBT adult share | Same | Georgia | 2020–2021 | 5.1% | 402,900 | Not printed | Direct estimate | Flores & Conron, Table 1 | Same URL | Same | State, not Atlanta |
| LGBT adult share | Same | Washington | 2020–2021 | 6.9% | 398,700 | Not printed | Direct estimate | Flores & Conron, Table 1 | Same URL | Same | State, not Seattle |
| LGBT adult share | Same | Florida | 2020–2021 | 5.4% | 898,000 | Not printed | Model-based; asterisked in Table 1 | Flores & Conron, Table 1 | Same URL | Same | State, not Miami. Model-based, so not the same estimation step as the direct-estimate states |
| LGBT adult share by age | Adults in the age group | United States | 2020–2021 | 18–24: 15.2% (4,659,600); 25–34: 9.1% (4,085,300); 35–49: 4.1% (2,538,400); 50–64: 2.7% (1,734,700); 65 and older: 1.8% (924,300) | Table A1b percent bounds: 18–24, 14.3% to 18.0%; 25–34, 8.5% to 10.7%; 35–49, 3.9% to 5.1%; 50–64, 2.6% to 3.4%; 65 and older, 1.7% to 2.3% | Not printed by age in the extracted methods | Age-specific BRFSS classification, same LGBT rule | Flores & Conron, Table 5 and Table A1b | Same URL | Same combined LGBT rule | National only. Useful because valley HIV prevalence is concentrated at older ages, but these are not valley estimates and are not HIV rates |

Coachella Valley LGBT or LGBTQ adult population share: not found in sources opened. The Gallup MSA brief has no valley row. The BRFSS report has no sub-state row. HARC queries did not return an opened probability-survey percentage of valley adults who identify as lesbian, gay, bisexual, transgender, queer, intersex, or asexual. Same-sex couple households were not used as a substitute population count.

## Indicator 4. Alignable LGBTQ-related health indicator

The indicator that uses one method across several required cities is CDC National HIV Behavioral Surveillance among men who have sex with men, 2023, HIV Surveillance Special Report 37. https://stacks.cdc.gov/view/cdc/162349. Published September 2024.

This is not an LGBT identity prevalence and not an HIV diagnosis rate per 100,000. Eligibility in 2023: identified as a man, or were assigned male at birth and identified as nonbinary, and reported sex with a man in the 12 months before interview. Cisgender man means male sex at birth and man as gender. Transgender man means female sex at birth and man as gender. Nonbinary in the tables used here is limited to participants assigned male at birth. Recruitment was venue-based and virtual-space-based in 19 MSAs. Data are unweighted. No statistical tests were performed. Numbers under 12, and percentages based on them, are unreliable by the report’s rule. Each city’s interview goal was 500 eligible participants; several cities are far below that. HIV-positive means a reactive rapid test supported by a second rapid test, supplemental laboratory testing, or self-report of a previous positive result. PrEP use is self-reported use in the 12 months before interview among participants with a valid negative NHBS test who did not self-report a previous positive result. The report states that NHBS PrEP data are not CDC’s official PrEP indicator and should not be compared with it.

Participating areas include Los Angeles, San Francisco, San Diego, New York City, Chicago, Atlanta, and Seattle. Miami is not a 2023 NHBS project area. Riverside County and the Coachella Valley are not project areas. The 19-city total is a venue sample, not the United States.

HIV prevalence below is Table 3, full sample with a valid NHBS HIV test. PrEP use is Table 9b, HIV-negative participants.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HIV prevalence in the NHBS sample | MSM, including cisgender men, transgender men, and nonbinary participants assigned male at birth, with a valid HIV test | Los Angeles, CA | 2023 | 16.7% | 85 HIV-positive / 508 with a valid test | City total in Table 1: 519, of whom 11 had no valid test | Venue-based unweighted sample, not residents per 100,000 | CDC NHBS Special Report 37, Tables 1 and 3 | https://stacks.cdc.gov/view/cdc/162349 | Sexual behavior with a man in the past 12 months, plus gender as defined above. Not an LGBT population sample | Alignable to other NHBS cities in this table. Not alignable to diagnosis rates per 100,000 |
| HIV prevalence in the NHBS sample | Same | San Francisco, CA | 2023 | 22.2% | 106 / 477 | Table 1 total 488 | Same | Same | Same URL | Same | San Francisco division of the MSA, per the report’s MSA list |
| HIV prevalence in the NHBS sample | Same | San Diego, CA | 2023 | 14.2% | 46 / 325 | Table 1 total 355 | Same | Same | Same URL | Same | Same method |
| HIV prevalence in the NHBS sample | Same | New York City, NY | 2023 | 31.1% | 42 / 135 | Table 1 total 139 | Same | Same | Same URL | Same | Below the 500-interview goal. Still above the report’s under-12 caution for the positive count |
| HIV prevalence in the NHBS sample | Same | Chicago, IL | 2023 | 4.8% | 4 / 84 | Table 1 total 89 | Same | Same | Same URL | Same | Positive count is under 12. The report says this is unreliable. Do not compare it as a stable city prevalence |
| HIV prevalence in the NHBS sample | Same | Atlanta, GA | 2023 | 42.3% | 140 / 331 | Table 1 total 348 | Same | Same | Same URL | Same | Same method. Highest point estimate among the required cities in this table |
| HIV prevalence in the NHBS sample | Same | Seattle, WA | 2023 | 15.7% | 75 / 477 | Table 1 total 506 | Same | Same | Same URL | Same | Seattle division |
| HIV prevalence in the NHBS sample | Same | Miami | 2023 | Not found | Not applicable | Not applicable | Miami is not among the 19 project areas listed | Same report, project-area list | Same URL | Not measured | Failed search inside the opened report |
| HIV prevalence in the NHBS sample | Same | Coachella Valley and Riverside County | 2023 | Not found | Not applicable | Not applicable | Not a project area | Same | Same URL | Not measured | Failed search inside the opened report |
| HIV prevalence in the NHBS sample | Same | 19 U.S. cities combined | 2023 | 22.6% | 1,396 / 6,174 | Full interview sample 6,552, including 378 without a valid test | Unweighted pooled venue sample | CDC NHBS Table 3 | Same URL | Same | Not a United States population rate |
| PrEP use in the past 12 months | HIV-negative NHBS participants, self-report | Los Angeles, CA | 2023 | 49.2% | 208 / 423 | 423 HIV-negative participants | Same venue sample; not CDC’s official PrEP coverage indicator | CDC NHBS Table 9b | Same URL | Same behavior-and-gender eligibility | Alignable across NHBS cities only |
| PrEP use in the past 12 months | Same | San Francisco, CA | 2023 | 60.9% | 226 / 371 | 371 | Same | Same | Same URL | Same | Same |
| PrEP use in the past 12 months | Same | San Diego, CA | 2023 | 49.1% | 137 / 279 | 279 | Same | Same | Same URL | Same | Same |
| PrEP use in the past 12 months | Same | New York City, NY | 2023 | 69.9% | 65 / 93 | 93 | Same | Same | Same URL | Same | Small sample relative to the 500 goal |
| PrEP use in the past 12 months | Same | Chicago, IL | 2023 | 62.5% | 50 / 80 | 80 | Same | Same | Same URL | Same | Small sample |
| PrEP use in the past 12 months | Same | Atlanta, GA | 2023 | 44.5% | 85 / 191 | 191 | Same | Same | Same URL | Same | Same method |
| PrEP use in the past 12 months | Same | Seattle, WA | 2023 | 57.5% | 231 / 402 | 402 | Same | Same | Same URL | Same | Same method |
| PrEP use in the past 12 months | Same | 19 U.S. cities combined | 2023 | 45.3% | 2,166 / 4,778 | 4,778 HIV-negative participants | Same | CDC NHBS Table 9a | Same URL | Same | Not a national population rate. Report also says 93.2% of these HIV-negative participants had heard of PrEP (4,451 / 4,778) |
| PrEP use in the past 12 months | Same | Miami; Coachella Valley | 2023 | Not found | Not applicable | Not applicable | Not project areas | Same | Same URL | Not measured | Failed search |

Gender composition of the full 6,552-person sample, so transgender and nonbinary participants are not collapsed into cisgender MSM: cisgender man 6,007 (91.7%), transgender man 81 (1.2%), nonbinary assigned male at birth 464 (7.1%). Table 3 HIV prevalence for transgender men overall is 2 of 80 (2.5%); city cells are suppressed. Nonbinary assigned-male-at-birth prevalence overall is 89 of 438 (20.3%). Those overall figures are not city comparisons.

A local behavioral category that is not alignable to NHBS: the November 2024 RUHS-PH report states that in 2023, 86.4% of newly diagnosed HIV cases were among gay, bisexual, same-gender-loving, or male-to-male sexual contact. That wording mixes identity and behavior, uses a different year and geography, and is a share of diagnoses rather than HIV prevalence in a sample of MSM. It is not used as a comparator to the NHBS percentages.

CDPH 2024 care continuum is alignable across California counties only, and it is not LGBTQ-specific. It is included because it was opened with the prevalence tables and is a clinical-access indicator for the valley’s county. In care and viral suppression are percentages of people living with diagnosed HIV. 2025 national Ending the HIV Epidemic goals printed in the table are 95% for both displayed percentage columns.

| Indicator | Group | Place | Year | Estimate | Interval or numerator/denominator | Sample size | Denominator definition | Source | URL or PMID | Identity measurement | Comparability note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| In care; virally suppressed | People living with diagnosed HIV | Riverside County | 2024 | In care 83.1%; virally suppressed 77.5% | 9,332 in care and 8,712 virally suppressed among 11,236 | 11,236 | Persons living with diagnosed HIV, current jurisdiction | CDPH Table 2d | CDPH 2024 report URL | Not identity | California counties only. Not NHBS and not an LGBTQ sample |
| In care; virally suppressed | Same | Los Angeles County | 2024 | 73.5%; 67.0% | 38,769 / 52,731 in care; 35,315 / 52,731 suppressed | 52,731 | Same | CDPH Table 2d | Same | Not identity | Same California series |
| In care; virally suppressed | Same | San Francisco | 2024 | 79.4%; 74.2% | 9,205 / 11,595; 8,609 / 11,595 | 11,595 | Same | CDPH Table 2d | Same | Not identity | Same series |
| In care; virally suppressed | Same | San Diego County | 2024 | 74.6%; 62.1% | 10,673 / 14,307; 8,887 / 14,307 | 14,307 | Same | CDPH Table 2d | Same | Not identity | Same series |
| In care; virally suppressed | Same | California | 2024 | 76.1%; 68.4% | 109,541 / 143,918; 98,467 / 143,918 | 143,918 | Same | CDPH Table 2d | Same | Not identity | State benchmark for this table |

No parallel 2024 care-continuum table was opened for New York City, Chicago, Atlanta, Miami, Seattle, or the United States, so those cities are not given a care-continuum row.

## Wilton Manors

Wilton Manors does not replace Miami. The City of Wilton Manors demographics page, opened November 8, 2026, says the city is in Broward County and says it “was named the second gayest city by the Williams Institute (Williams Institute 2010 Census Snapshot).” The linked 2010 snapshot was not opened, so that ranking is not extracted as a number. The page does not report an HIV diagnosis rate, an HIV prevalence rate, or its own LGBT percentage. General-population Census QuickFacts on that page, not LGBTQ estimates, include a July 1, 2022 population estimate of 11,342 and a 2022 poverty percentage of 5.9%. Those are general-population figures.

Broward County HIV figures that were opened are the CDC Table A3 2023 diagnosis row and the Fort Lauderdale metropolitan-division rows in Table 18. Neither is Wilton Manors.

## City-by-city checklist

| Required comparator | New HIV diagnoses, 2023, CDC Table 18 | HIV prevalence, year-end 2023, CDC Table 18 | LGBT adult share, one named method | Alignable LGBTQ-related health indicator | Failed-search note |
| --- | --- | --- | --- | --- | --- |
| Los Angeles | Found: Los Angeles–Long Beach–Anaheim MSA, not the city | Found: same MSA | Found: Gallup/Williams 2012–2017, same MSA family (Los Angeles–Long Beach–Anaheim) | Found: NHBS 2023 Los Angeles | City-proper rate not in Table 18 |
| San Francisco | Found: San Francisco–Oakland–Berkeley MSA and a San Francisco division | Found: same | Found: Gallup/Williams Bay Area MSA | Found: NHBS 2023 San Francisco | City/county rate is in CDC Table A3 and CDPH, a different denominator |
| San Diego | Found: San Diego–Chula Vista–Carlsbad MSA | Found: same | Found: Gallup/Williams | Found: NHBS 2023 San Diego | None for the required city at MSA level |
| New York City | Found only as multi-state MSA and a New York–Jersey City–White Plains division; city not in Table 18 | Found at those geographies | Found: Gallup/Williams New York–Newark–Jersey City MSA, not the city | Found: NHBS 2023 New York City, small sample | City-proper diagnosis rate not in the common MSA table. Manhattan and Brooklyn only were extracted from Table A3 |
| Chicago | Found: Chicago–Naperville–Elgin MSA and an Illinois division | Found: same | Found: Gallup/Williams | Found: NHBS 2023 Chicago, but HIV-positive n = 4, unreliable by the report’s rule | City-proper rate not found |
| Atlanta | Found: Atlanta–Sandy Springs–Roswell MSA and division | Found: same | Found: Gallup/Williams Atlanta–Sandy Springs–Alpharetta MSA | Found: NHBS 2023 Atlanta | City-proper rate not found. Fulton and DeKalb are separate Table A3 counties |
| Miami | Found: Miami–Fort Lauderdale–Pompano Beach MSA and Miami division | Found: same | Found: Gallup/Williams Miami MSA | Not found in NHBS 2023 | NHBS project-area list does not include Miami. Wilton Manors does not replace this row |
| Seattle | Found: Seattle–Tacoma–Bellevue MSA and Seattle–Bellevue–Kent division | Found: same | Found: Gallup/Williams | Found: NHBS 2023 Seattle | City-proper rate not found. King County is the Table A3 proxy |
| United States | Found: Table 18 total rate 11.6 per 100,000, 50 states, DC, and Puerto Rico; Table 16 aged-13-and-older rate 13.7 is a different denominator | Found: Table 18 prevalence rate 335.1; Table 16 aged-13-and-older prevalence rate 394.5 is different | Not found in the Gallup MSA brief. Found separately: BRFSS 2020–2021, 5.5%, different method | NHBS 19-city total is not a U.S. population rate. No national NHBS row | National Gallup percentage from the same 2012–2017 MSA method: not in the opened brief |

Coachella Valley, not one of the nine but required as the index place: CDC valley rate not found. RUHS-PH valley diagnosis and prevalence rates found, with a boundary conflict between the November 2024 and November 2025 reports. Valley LGBT population share not found.

Wilton Manors: added only as a Miami-area place note. A city webpage supports its use as an LGBTQ-identified community in Broward County by citing a Williams Institute census snapshot. HIV rates and an LGBT percentage for the city were not retrieved. It does not replace Miami.

## Not-found list

- Coachella Valley new HIV diagnosis rate and prevalence rate in CDC NHSS Table 18 or Table A3. Queries: CDC 2023 MSA surveillance tables; Coachella Valley HIV diagnoses rate plus HARC, DAP Health, or RUHS. Local RUHS-PH rates were found instead and are labeled local.
- Coachella Valley or Palm Springs LGBT adult population share from Gallup, BRFSS, or an opened HARC probability survey. Queries: Williams MSA brief; Williams BRFSS adult report; “HARC sexual orientation Coachella Valley percent”; “HARC Coachella Valley LGBTQ population percentage.”
- United States LGBT adult share using the Gallup 2012–2017 item in the MSA brief.
- City-proper HIV diagnosis and prevalence rates for Los Angeles, San Francisco, New York City, Chicago, Atlanta, Miami, and Seattle in the common 2023 Table 18. County or division proxies were extracted where Table A3 or CDPH had them. San Diego’s MSA is the county.
- Miami and Coachella Valley rows in NHBS 2023.
- Wilton Manors HIV diagnosis rate, HIV prevalence, and LGBT percentage from a source opened in this run. Query: “Wilton Manors HIV prevalence OR LGBT population percentage.”
- 2024 CDC MSA rates. The 2024 national page was opened; the linked 2024 workbook was not parsed.
- AIDSVu 2023 city rates. Snippets were not treated as opened sources.
- A single LGBTQ-specific health indicator, other than NHBS, measured the same way in the valley and in all nine comparators.
- General-population uninsured rates. Not searched as an LGBTQ indicator. The Wilton Manors poverty percentage above is general population and is not an LGBTQ estimate.

## Citations

Centers for Disease Control and Prevention. (2024, September). *HIV infection risk, prevention, and testing behaviors among men who have sex with men—National HIV Behavioral Surveillance, 19 U.S. cities, 2023* (HIV Surveillance Special Report No. 37). U.S. Department of Health and Human Services. https://stacks.cdc.gov/view/cdc/162349

Centers for Disease Control and Prevention. (2025, April 29). *Diagnoses, deaths, and prevalence of HIV in the United States and 6 territories and freely associated states, 2023: Tables*. CDC Stacks. https://stacks.cdc.gov/view/cdc/177772

Centers for Disease Control and Prevention. (2026, May 18). *HIV diagnoses, deaths, and prevalence*. https://www.cdc.gov/hiv-data/nhss/hiv-diagnoses-deaths-prevalence.html

California Department of Public Health, Office of AIDS. (2026, June). *California HIV surveillance report — 2024*. California Department of Public Health. https://www.cdph.ca.gov/Programs/CID/DOA/CDPH%20Document%20Library/California-HIV-Surveillance-Report-2024.pdf

City of Wilton Manors. (n.d.). *Demographics*. Retrieved November 8, 2026, from https://www.wiltonmanors.gov/92/Demographics

Conron, K. J., Luhur, W., & Goldberg, S. K. (2020, December). *Estimated number of US LGBT adults in large metropolitan statistical areas (MSA)*. Williams Institute. https://williamsinstitute.law.ucla.edu/wp-content/uploads/MSA-LGBT-Ranking-Mar-2021.pdf

Flores, A. R., & Conron, K. J. (2023). *Adult LGBT population in the United States*. Williams Institute. https://williamsinstitute.law.ucla.edu/wp-content/uploads/LGBT-Adult-US-Pop-Dec-2023.pdf

Riverside University Health System–Public Health, Epidemiology & Program Evaluation. (2024, November). *Epidemiology of HIV in Riverside County, 2023*. https://ruhealth.org/media/6416

Riverside University Health System–Public Health, Epidemiology and Program Evaluation. (2025, November). *Epidemiology of HIV/AIDS in Riverside County, 2024*. https://www.ruhealth.org/media/6411

Webpage retrieval date for all webpages and downloadable reports above: November 8, 2026. No social-media prevalence was used. No numeric gap was calculated.
