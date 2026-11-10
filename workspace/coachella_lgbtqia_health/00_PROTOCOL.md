# Protocol for the Coachella Valley LGBTQIA+ population-health graph

Review date: 2026-11-08. Workspace: /Users/tims-stuff/RonBrowserRebuild/workspace/coachella_lgbtqia_health/

This is an evidence review, not a peer-reviewed publication. Do not invent authors, affiliations, statistics, quotations, study findings, or citations. Every number in the manuscript must trace to a source retrieved by a tool in this run (URL or PMID). If a fact is not retrieved, write "not found in sources retrieved" and list the queries tried.

## Population and place

Coachella Valley, Riverside County, California, including Palm Springs, Cathedral City, Rancho Mirage, Palm Desert, Indian Wells, La Quinta, Desert Hot Springs, Thousand Palms, Bermuda Dunes, Indio, Coachella, Thermal, Mecca, Oasis, North Shore, and nearby unincorporated communities. Do not treat Palm Springs as the whole valley. Report west-valley and east-valley patterns separately whenever sources allow.

Population: LGBTQIA+ people. Keep sexual orientation, sexual behavior, and gender identity distinct. Do not collapse transgender, nonbinary, and cisgender sexual-minority estimates. Note how each source measured identity.

## Required health domains

Population size, age, race/ethnicity, income, insurance, housing. HIV and other STIs. Mental health and suicide. Substance use. Chronic disease and aging. Youth. Clinical access and culturally specific services. Social determinants, including heat, housing, migration, agricultural labor, poverty, and discrimination. Strengths as well as vulnerabilities. Mechanisms (why this pattern exists here), not labels alone.

## Required comparators

Los Angeles, San Francisco, San Diego, New York City, Chicago, Atlanta, Miami (Wilton Manors if a source supports it), Seattle, and a national US benchmark. Use the same indicator, similar year, and similar denominator, or state that they are not comparable. Intra-valley comparisons count as a unique-region analysis, not as a substitute for major-city comparisons.

## Interventions

Ten-year horizon from 2026. Evidence-based and comparatively cost-effective. For each option report: population reached, outcome, evidence grade, cost or cost-effectiveness metric if retrieved (cost per QALY, cost per infection averted, program cost), equity (east valley, transgender people, youth, older adults, Spanish-speaking and immigrant communities), and local feasibility. If cost data were not retrieved, document the searches and do not invent a dollar figure. Do not recommend a program solely because it is familiar.

## Analysis rules

Extract every quantitative claim into a row: indicator, group, place, year, estimate, interval or numerator/denominator if given, sample size if given, source, URL or PMID, comparability note. Compute a gap only when inputs are in the dossiers. Show the formula and inputs. Do not add precision. Suggested multi-criteria weights, adjustable with a written reason: evidence strength 0.30, cost-effectiveness 0.25, equity reach 0.25, ten-year local feasibility 0.20. Missing data stay missing.

## Citation rules

APA 7. Journal: Author, A. A. (Year). Title. Journal, volume(issue), pages. PMID or DOI URL. Report or webpage: Author or organization. (Year, Month Day if available). Title. Site or publisher. URL. Retrieval date 2026-11-08 if the source is a webpage. No citation may appear unless this run opened or fetched it. Record the tool and query in the methods log.

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

## Send-back rule

QA does not rewrite the submission. QA issues VERDICT: PASS or VERDICT: REVISE, plus numbered redo tasks that name the file, the failed claim, and the exact repair. The submitting role redoes those tasks with tools, writes a response-to-reviewers table, and does not silently drop a task. If a task cannot be repaired because no source exists, say so and downgrade or remove the claim.

## File contract

- 01_epidemiology.md
- 02_strengths.md
- 03_vulnerabilities.md
- 04_comparators.md
- 05_interventions.md
- 06_skill_note.md
- 07_research_qa.md
- 08_research_rework.md
- 09_estimates.csv
- 09_analysis.md
- 10_analysis_qa.md
- 11_analysis_rework.md
- 12_manuscript.md
- 13_manuscript_qa.md
- 14_manuscript_rework.md
- 15_article.html
- 15_article.md

Write with the editor tool. Read with editor or file_read. Do not ask the user questions. If a tool fails, try one alternate tool, then record the failure.
