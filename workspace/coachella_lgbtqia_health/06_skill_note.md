# Methods skill note

Review date: 2026-11-08.

Workspace: `/Users/tims-stuff/RonBrowserRebuild/workspace/coachella_lgbtqia_health/`

Assigned file for this node: `06_skill_note.md`. This node writes only this file.

## Skill status

No learned skill was loaded in the parent session. This node did not call `list_learned_skills` or `use_skill`. No skill ran. This note does not pretend that a skill ran, and it does not incorporate output from a skill. The methods below are the constraints in `00_PROTOCOL.md`, which this node opened with the editor tool, plus the assignment for this node.

## What this review is

This is an evidence review, not a peer-reviewed publication. No individual authors are invented. No affiliations are invented. This note does not invent statistics, quotations, study findings, or citations. This note makes no health claims.

## Sources opened for this note

| Item | Tool | Path or query | Result |
| --- | --- | --- | --- |
| Protocol | editor, command `view` | `/Users/tims-stuff/RonBrowserRebuild/workspace/coachella_lgbtqia_health/00_PROTOCOL.md` | Opened and read in full on 2026-11-08 |
| Workspace directory | editor, command `view` | `/Users/tims-stuff/RonBrowserRebuild/workspace/coachella_lgbtqia_health/` | Directory confirmed before this file was written |

No webpage, PubMed record, PMID, or other external source was opened or fetched for this note. No health statistics were retrieved. This note therefore cites no external source. A citation may not be added later unless that later node opens or fetches the source in this run.

## DAG design

The review is a directed acyclic graph. Nodes do not loop back.

1. Parallel research files. These are written as separate dossiers. None of them is a substitute for the others.
   - `01_epidemiology.md`
   - `02_strengths.md`
   - `03_vulnerabilities.md`
   - `04_comparators.md`
   - `05_interventions.md`
2. `06_skill_note.md` (this file). Methods constraints only. It does not supply health findings, estimates, or citations.
3. `07_research_qa.md`. Research QA. Verdict only. Does not rewrite the research submissions.
4. `08_research_rework.md`. One research repair pass, with a response-to-reviewers table.
5. Analysis outputs: `09_estimates.csv` and `09_analysis.md`.
6. `10_analysis_qa.md`. Analysis QA. Verdict only. Does not rewrite the analysis submission.
7. `11_analysis_rework.md`. One analysis repair pass, with a response-to-reviewers table.
8. `12_manuscript.md`.
9. `13_manuscript_qa.md`. Manuscript QA. Verdict only. Does not rewrite the manuscript.
10. `14_manuscript_rework.md`. One manuscript repair pass, with a response-to-reviewers table.
11. Stylist outputs: `15_article.html` and `15_article.md`.

## One repair pass

There is one repair pass at research, one at analysis, and one at manuscript, because the graph is acyclic. Each QA node points forward to its rework node. Rework does not return to QA and does not open a second cycle. A numbered redo task is not dropped. If a task cannot be repaired because no source was opened or fetched, the rework note says so and downgrades or removes the claim.

## Role boundaries

QA does not rewrite the submission. QA issues `VERDICT: PASS` or `VERDICT: REVISE`, plus numbered redo tasks. Each redo task names the file, the failed claim, and the exact repair.

Rework nodes repair with tools. They write a response-to-reviewers table that accounts for every numbered task. They do not silently drop a task.

The stylist writes `15_article.html` and `15_article.md` only. The stylist may not add facts. That includes statistics, quotations, mechanisms, costs, comparators, program effects, and citations that are not already in the repaired manuscript and traced to a source opened or fetched in this run. Style changes are not new evidence.

## Questions the review must answer

These are required questions. This note does not answer them.

- What strengths and vulnerabilities are unique to this region?
- What mechanisms explain them?
- How do comparable indicators differ from Los Angeles, San Francisco, San Diego, New York City, Chicago, Atlanta, Miami, Seattle, and the United States?
- Which evidence-based approaches would most cost-effectively improve this community's public health from 2026 through 2036?

Intra-valley comparisons count as a unique-region analysis. They are not a substitute for the major-city comparisons.

## Place and population rules

Place is the Coachella Valley, Riverside County, California, including Palm Springs, Cathedral City, Rancho Mirage, Palm Desert, Indian Wells, La Quinta, Desert Hot Springs, Thousand Palms, Bermuda Dunes, Indio, Coachella, Thermal, Mecca, Oasis, North Shore, and nearby unincorporated communities. Palm Springs is not the whole valley. West-valley and east-valley patterns are reported separately whenever sources allow.

Population is LGBTQIA+ people. Sexual orientation, sexual behavior, and gender identity stay distinct. Transgender, nonbinary, and cisgender sexual-minority estimates are not collapsed. Each source's measurement of identity is noted. Individual people are not identified or outed.

## Evidence the other nodes must cover

These are coverage rules, not findings.

Domains: population size, age, race/ethnicity, income, insurance, housing; HIV and other STIs; mental health and suicide; substance use; chronic disease and aging; youth; clinical access and culturally specific services; social determinants, including heat, housing, migration, agricultural labor, poverty, and discrimination. Strengths as well as vulnerabilities. Mechanisms, not labels alone.

Required comparators: Los Angeles, San Francisco, San Diego, New York City, Chicago, Atlanta, Miami (Wilton Manors if a source supports it), Seattle, and a national United States benchmark. Use the same indicator, a similar year, and a similar denominator, or state that they are not comparable. Omitting a comparator city from this list without a documented failed search is a must-fail item.

Interventions use a ten-year horizon from 2026 through 2036. They must be evidence-based and comparatively cost-effective. For each option report population reached, outcome, evidence grade, cost or cost-effectiveness metric if retrieved, equity, and local feasibility. Equity includes the east valley, transgender people, youth, older adults, and Spanish-speaking and immigrant communities. If cost data were not retrieved, document the searches and do not invent a dollar figure. Do not recommend a program solely because it is familiar.

## Quantitative rules for analysis

Extract every quantitative claim into a row: indicator, group, place, year, estimate, interval or numerator/denominator if given, sample size if given, source, URL or PMID, and comparability note. Compute a gap only when the inputs are in the dossiers. Show the formula and the inputs. Do not add precision. Missing data stay missing.

Suggested multi-criteria weights, adjustable only with a written reason, as stated in the opened protocol: evidence strength 0.30, cost-effectiveness 0.25, equity reach 0.25, ten-year local feasibility 0.20. These weights are protocol instructions read from the local protocol file. They are not health statistics and they are not a retrieved cost-effectiveness result.

Every number in the manuscript must trace to a source retrieved by a tool in this run (URL or PMID). If a fact is not retrieved, write "not found in sources retrieved" and list the queries tried. Social-media posts are not prevalence.

## Citation rule

APA 7. Cite only a source this run opened or fetched. Record the tool and the query in the methods log. Retrieval date for a webpage: 2026-11-08.

Journal: Author, A. A. (Year). Title. Journal, volume(issue), pages. PMID or DOI URL.

Report or webpage: Author or organization. (Year, Month Day if available). Title. Site or publisher. URL. Retrieval date 2026-11-08 if the source is a webpage.

No citation may appear unless this run opened or fetched it. This skill note adds no external citation, because this node opened only the local protocol and the workspace directory.

## QA must-fail items

From the opened protocol, QA must fail a submission that contains any of the following:

1. A statistic with no retrieved URL or PMID.
2. A citation not opened or fetched in this run.
3. Palm Springs treated as the entire valley.
4. Sexual orientation and gender identity conflated without a measurement note.
5. A comparator city from the required list omitted without a documented failed search.
6. A strength or vulnerability with no mechanism.
7. A cost figure not present in a retrieved source.
8. Social-media posts used as prevalence.
9. Identity described only as risk, with no strengths section.
10. Individual people identified or outed.

## Send-back rule

QA does not rewrite the submission. QA issues `VERDICT: PASS` or `VERDICT: REVISE`, plus numbered redo tasks that name the file, the failed claim, and the exact repair. The submitting role redoes those tasks with tools, writes a response-to-reviewers table, and does not silently drop a task. If a task cannot be repaired because no source exists, say so and downgrade or remove the claim.

## Tool-failure rule

If a tool fails, try one alternate tool, then record the failure. Do not replace a failed retrieval with an invented figure or citation.

## What this note does not contain

No health claim. No prevalence, incidence, cost, or program-effect number from an external source. No invented author. No claim that a learned skill was loaded or that a skill ran.
