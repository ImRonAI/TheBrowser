# Interventions dossier: Coachella Valley LGBTQIA+ population health

Review date: 2026-11-08. Horizon: 2026 through 2036. Place: full Coachella Valley, Riverside County, California, not Palm Springs alone. Population: LGBTQIA+ people, with sexual orientation, sexual behavior, and gender identity kept distinct.

This file extracts what opened or fetched sources support. It does not apply multi-criteria weights and does not rank options by familiarity. The analyst will weight later. If a field was not in a source opened or fetched in this run, the cell says "not found in sources retrieved." No dollar figure in this file was estimated by the reviewer.

A conventional west-valley / east-valley label is applied below only when a city is named, and it is labeled as a reviewer label, not as a classification printed by the source. Cities named from sources: Palm Springs, Cathedral City, Desert Hot Springs, Indio, and Coachella. Reviewer-applied label, not a source classification: Palm Springs, Cathedral City, and Desert Hot Springs are treated here as west-valley cities; Indio and Coachella are treated here as east-valley cities. Mecca, Thermal, Oasis, and North Shore were not confirmed in the opened cool-center text search (see methods).

## Methods log

Retrieval date for webpages: November 8, 2026. A search snippet was not treated as an opened source. Citation below requires an opened page, an opened PDF text extraction, a PubMed abstract fetch, or a Europe PMC REST fetch in this run.

### Tools and queries

| Tool | Query or URL | Result |
| --- | --- | --- |
| file_read | `00_PROTOCOL.md`, `00_NODE_BRIEF.md`, `06_skill_note.md` | Read. Skill note reported no relevant taught skill and no population-health facts. |
| web_search | USPSTF PrEP recommendation pre-exposure prophylaxis HIV | Used to locate the USPSTF page, then opened. |
| web_search | CDC PrEP guidelines clinical practice 2021 site:cdc.gov | Used to locate CDC Stacks, then opened. |
| open_page | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/prevention-of-human-immunodeficiency-virus-hiv-infection-pre-exposure-prophylaxis | Opened. |
| open_page_with_find | Same USPSTF URL; pattern for grade, transgender, efficacy | Opened matching lines. |
| open_page | https://www.uspreventiveservicestaskforce.org/uspstf/document/final-evidence-summary/prevention-of-human-immunodeficiency-virus-hiv-infection-pre-exposure-prophylaxis | Opened. Authors and pooled results taken from that page. |
| pubmed_search | tenofovir emtricitabine PrEP cost-effectiveness United States | Failed: API error 429, rate limit. |
| pubmed_search | cabotegravir long-acting PrEP cost-effectiveness | Success. PMIDs included 38267806, 36468218, 36632416, 35099992. |
| pubmed_search | HIV testing cost-effectiveness status-neutral care United States | Failed: API error 429. |
| pubmed_search | syringe services program cost-effectiveness HIV HCV | Failed: API error 429. |
| pubmed_search | Housing First HIV OR homelessness cost-effectiveness | Success. Count 894. PMIDs reviewed by title in the return included 32732712 and others; the cost-effectiveness source retained was opened via CDC Stacks (PMID 34774389), not from this PMID list alone. |
| pubmed_search | LGBTQ affirming mental health intervention systematic review CBT depression sexual minority | Success, 0 articles. |
| pubmed_fetch_abstracts | 38267806, 36468218, 36632416, 35099992 | Success. Abstracts truncated relative to full text. |
| open_page | https://pubmed.ncbi.nlm.nih.gov/35099992/ | Failed. |
| open_page | https://pubmed.ncbi.nlm.nih.gov/38267806/ | Failed. |
| http_request | Europe PMC REST `EXT_ID:38267806 OR EXT_ID:35099992`, resultType=core | Success. Full abstracts retrieved, including cost figures quoted below. |
| open_page | https://pmc.ncbi.nlm.nih.gov/articles/PMC3690921/ | Opened. Juusola et al. full text abstract, methods, Table 1, and high-risk table figures used below. |
| open_page | https://pmc.ncbi.nlm.nih.gov/articles/PMC9087297/ | Failed: reCAPTCHA. Neilan full-text table not used. |
| open_page | https://europepmc.org/article/MED/35099992 | Failed: page required JavaScript. Abstract already fetched via REST. |
| web_search | Juusola Brandeau PrEP cost-effectiveness men who have sex with men United States QALY | Snippets only until the PMC page was opened. Los Angeles County model (Drabo and colleagues, Clinical Infectious Diseases) was a snippet only and is not cited. |
| web_search | syringe services program cost-effectiveness HIV hepatitis C CDC | Used to locate CDC pages, then opened. PLOS One program-cost paper and later NSP cost-utility papers were snippets only and are not cited. |
| open_page | https://www.cdc.gov/hepatitis-syringe-services/php/about/index.html | Opened. |
| open_page | https://archive.cdc.gov/www_cdc_gov/policy/hi5/cleansyringes/index.html | Opened. |
| web_search | HRSA Ryan White HIV/AIDS Program annual client-level data report viral suppression | Used to locate HRSA pages, then opened. |
| open_page | https://www.hrsa.gov/about/news/press-releases/2025-new-data-ryanwhite-hiv | Opened. |
| open_page | https://ryanwhite.hrsa.gov/about/parts-and-initiatives/part-b-adap/fy-2025-grant-awards | Opened. California row transcribed below. |
| web_search | Ryan White HIV/AIDS Program HRSA clients served cost ADAP California | KFF ADAP client table, a California Ryan White fact sheet, and the CDPH ADAP PDF appeared as snippets. Only the HRSA award page was opened. CDPH PDF was not successfully opened (see failures). Those snippet figures are not used. |
| open_page | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/human-immunodeficiency-virus-hiv-infection-screening | Opened. |
| web_search | CDC status-neutral HIV care approach site:cdc.gov | Used to locate Stacks. |
| open_page | https://www.cdc.gov/hiv/pdf/policies/issue-brief/Issue-Brief-Status-Neutral-HIV-Care.pdf | Failed: CDC page not found. |
| open_page | https://stacks.cdc.gov/view/cdc/129024 | Opened landing record. PDF body was not extracted. Claims are limited to the Stacks description. |
| open_page | https://stacks.cdc.gov/view/cdc/112360 | Opened landing record for the 2021 CDC/USPHS PrEP guideline. |
| open_page_with_find | https://stacks.cdc.gov/view/cdc/112360/cdc_112360_DS1.pdf | Opened PDF text matches for graded recommendations. |
| open_page | https://stacks.cdc.gov/view/cdc/149681 | Opened. Compendium methods landing record. Individual intervention summaries were not opened. |
| web_search | Community Preventive Services Task Force permanent supportive housing Housing First economic review CDC | Used to locate Stacks. |
| open_page | https://www.thecommunityguide.org/findings/social-determinants-health-housing-first-programs.html | Failed. Housing-stability percentages from that snippet are not used. |
| open_page | https://stacks.cdc.gov/view/cdc/114852 | Opened. Jacob and colleagues economic-review abstract used. |
| open_page | https://www.thecommunityguide.org/findings/hivaids-interventions-reduce-sexual-risk-behaviors-or-increase-protective-behaviors-acquisition-hiv-men-sex-men-community.html | Failed. Community Guide MSM behavioral findings from the search snippet are not used. |
| web_search | systematic review gender-affirming hormone therapy mental health outcomes transgender PMID | Used to locate Baker and colleagues. |
| open_page | https://academic.oup.com/jes/article/5/4/bvab011/6126016 | Failed. |
| open_page | https://pmc.ncbi.nlm.nih.gov/articles/PMC7894249/ | Opened. |
| open_page_with_find | Same Baker PMC URL | Matching lines opened. Study-level "Low" and "Moderate" labels in tables were not tied to a named outcome row in the extracted context, so they are not reported as the review's overall grade. |
| web_search | Gay-Straight Alliance GSA school-based anti-bullying sexual minority youth suicide systematic review | Used to locate Marx and colleagues and Krantz and colleagues. |
| open_page | https://pubmed.ncbi.nlm.nih.gov/27221632/ | Opened. |
| open_page | https://pubmed.ncbi.nlm.nih.gov/38564182/ | Failed. Krantz suicide risk ratios from the search snippet are not used. |
| web_search | Pachankis ESTEEM cognitive behavioral therapy gay bisexual men depression randomized trial | Used to locate the trial. |
| open_page | https://pmc.ncbi.nlm.nih.gov/articles/PMC9446477/ | Opened. |
| web_search | community health worker farmworker OR Spanish-speaking chronic disease or HIV cost-effectiveness systematic review | Farmworker chronic-disease prevalence paper and LMIC CHW cost review were snippets only and are not cited. |
| open_page | https://www.cdc.gov/pcd/issues/2026/26_0132.htm | Opened. |
| open_page_with_find | Same Wilder URL; pattern HIV, viral suppression, promotora, Spanish, cost | Opened matching lines. No farmworker result and no program-cost figure in those lines. |
| web_search | extreme heat cooling center cost-effectiveness older adults systematic review | Oxford Open Climate Change review and a 2026 healthcare-cost meta-analysis were snippets only and were not opened. |
| open_page | https://pmc.ncbi.nlm.nih.gov/articles/PMC10234508/ | Opened. Meade and colleagues. No cost figure on the opened pages used. |
| web_search | Coachella Valley cooling center heat plan Riverside County DAP Health PrEP HIV | News recaps were not used as effectiveness evidence. |
| open_page | https://daphealth.org/sexual-and-reproductive-health/prep-and-pep/ | Opened. |
| open_page | https://ruhealth.org/hiv-prevention | Opened; tool returned https://www.ruhealth.org/hiv-prevention. |
| open_page | https://www.capriverside.org/cool-centers | Failed: page required JavaScript and returned no center list. |
| open_page | https://irp.cdn-website.com/6847619a/files/uploaded/2026+Cool+Center+Directory+English+-+RIV+CO.pdf | Opened. Directory text is duplicated by the extractor; only clearly repeated rows are cited. |
| open_page_with_find | Same cool-center PDF; pattern Indio, Mecca, Thermal, Palm Springs, Coachella, North Shore, Desert Hot Springs | Matches for Coachella, Desert Hot Springs, Indio, and Cathedral City. Palm Springs, Mecca, Thermal, and North Shore were not in the first 25 matches. |
| open_page | https://www.cdph.ca.gov/Programs/CID/DOA/CDPH%20Document%20Library/CA-ADAP-Report-FY23-24.pdf | Failed. |
| http_request | Same CDPH ADAP PDF | Failed: SSL certificate verification error. One alternate after open_page, then stopped. Client counts and expenditures from search snippets of that PDF are not used. |
| tavily_extract | Brogan PMC, Europe PMC Neilan, CDC SSP, HRSA | Failed: TAVILY_API_KEY not set. |
| exa_get_contents | Same four URLs | Failed: EXA_API_KEY not set. |

### Sources opened or fetched and used

1. U.S. Preventive Services Task Force PrEP recommendation page, August 22, 2023.
2. Chou and colleagues evidence summary page, August 22, 2023, corresponding to JAMA 2023;330(8):746-763.
3. Juusola and colleagues, PMC3690921, PMID 22508731.
4. Brogan and colleagues abstract, Europe PMC REST, PMID 38267806.
5. Neilan and colleagues abstract, Europe PMC REST and PubMed abstract fetch, PMID 35099992.
6. CDC/USPHS PrEP guideline landing page and PDF text matches, December 2021, CDC Stacks 112360.
7. CDC syringe services program page, March 20, 2024.
8. CDC HI-5 access to clean syringes page, last reviewed February 26, 2024.
9. HRSA Ryan White press release, December 17, 2025.
10. HRSA FY 2025 Ryan White Part B award table, last reviewed January 2026.
11. USPSTF HIV screening recommendation page, June 11, 2019.
12. CDC status-neutral issue-brief Stacks record, August 19, 2022.
13. Jacob and colleagues Housing First economic review, CDC Stacks 114852, PMID 34774389.
14. Baker and colleagues, PMC7894249, PMID 33644622.
15. Marx and colleagues PubMed record, PMID 27221632.
16. Pachankis and colleagues, PMC9446477, PMID 35482652.
17. Wilder and colleagues, Preventing Chronic Disease, October 29, 2026.
18. Meade and colleagues, PMC10234508, PMID 37262028.
19. DAP Health PrEP and PEP page.
20. Riverside University Health System HIV prevention page.
21. Community Action Partnership of Riverside County, Cool Centers 2026 directory PDF.
22. CDC HIV Prevention Research Synthesis compendium methods landing record, April 1, 2024, CDC Stacks 149681.
23. Pepperrell and colleagues abstract, PubMed fetch, PMID 36632416. Used only for the price sentence in that abstract.
24. Liegeon and Ghosn abstract, PubMed fetch, PMID 36468218. Fetched and not used for a cost or outcome figure because the abstract did not report a U.S. cost-effectiveness metric.

### Identity measurement rule used in this dossier

Sexual orientation, sexual behavior, and gender identity are not interchangeable. For each option, the measurement note states only what the opened source said. If question wording was not printed, this file says the wording was not found in sources retrieved. Same-sex households are not used. No social-media post is used as prevalence or effectiveness. No private person is named.

## How to read evidence grades

Grades are copied from the source that assigned them. They are not converted into a single scale by this review.

- USPSTF grade A means the Task Force recommends the service. The opened PrEP page states that the USPSTF does not consider the costs of providing a service in its assessment.
- CDC/USPHS 2021 PrEP grades use the guideline's own labels. In the opened PDF text, IA was attached to daily F/TDF for sexually active adults and adolescents and for people who inject drugs, and to cabotegravir injections for adults reporting sexual behaviors that place them at substantial ongoing risk. The PDF text extraction broke some parentheses around those IA labels. F/TAF was labeled IA for men and IIB for transgender women who have sex with men.
- CDC compendium, opened landing record only: an evidence-based intervention has the strongest evidence of efficacy; an evidence-informed intervention has some evidence and ideally needs further testing. No individual compendium summary for men who have sex with men or transgender people was opened, so no named behavioral intervention is graded from the compendium in this file.
- Modeling papers report incremental cost-effectiveness ratios. Those ratios are not USPSTF grades.
- Where a trial did not show a statistically significant benefit, this file says so and does not upgrade the option because the program is familiar.

## Option-by-option extraction

### 1. Daily oral tenofovir disoproxil fumarate/emtricitabine PrEP

**What the option is.** Daily oral emtricitabine with tenofovir disoproxil fumarate for people without HIV who meet risk criteria. This is a medication-based prevention option, not a count of lesbian, gay, bisexual, transgender, queer, intersex, or asexual people.

**Population reached, as measured.** USPSTF, August 22, 2023: adolescents and adults weighing at least 35 kg (77 lb) who do not have HIV and are at increased risk. The opened page lists sexual behavior and partner factors, not a sexual-orientation identity question: a partner with HIV; a bacterial sexually transmitted infection in the past 6 months, with syphilis, gonorrhea, or chlamydia specified for men who have sex with men and transgender women, and gonorrhea and syphilis for heterosexual women and men; inconsistent or no condom use with partners of unknown HIV status; injection-drug exposure. The page says transgender women are at especially high risk and should be considered using those criteria. It says persons who request PrEP may have undisclosed behaviors. Question wording for "transgender women" was not found in sources retrieved.

CDC/USPHS 2021 PDF text: daily F/TDF is recommended for sexually active men and women, and separately for adults and adolescents who inject drugs and report injection practices that place them at substantial ongoing risk, both at grade IA in the extracted text, for persons weighing at least 35 kg (77 lb).

Juusola and colleagues modeled men who have sex with men aged 13–64 in the United States. That is a sexual-behavior category. Gender identity was not modeled separately. Transgender women were not found as a separate group in the opened Juusola text.

**Outcome.** Chou and colleagues, for the USPSTF: across 11 trials, oral PrEP versus placebo or no PrEP was associated with lower HIV acquisition, n = 18,172, relative risk 0.46 (95% CI, 0.33–0.66). Absolute risk reduction was −2.0% (95% CI, −2.8% to −1.2%) after 4 months to 4 years. When adherence was greater than 70%, 6 trials, n = 7,328, relative risk 0.27 (95% CI, 0.19–0.39). The opened evidence summary says no trial enrolled pregnant persons or persons younger than 18 years. USPSTF assigns grade A and states high certainty of substantial net benefit. The USPSTF page also says consistent condom use decreases risk of HIV acquisition by approximately 80%, and that PrEP does not reduce the risk of other sexually transmitted infections. Benefit depends on adherence counseling, safer sex including condom use, and regular HIV testing.

CDC PDF text: daily oral F/TDF, and F/TAF for the groups specified below, "has been shown to be safe and effective in reducing the risk of sexual HIV acquisition." A numeric efficacy percent for F/TDF was not found in the PDF lines opened.

**Evidence grade.** USPSTF grade A for prescribing effective antiretroviral PrEP, which includes oral TDF/FTC, to persons at increased risk. CDC/USPHS 2021 extracted text: IA for daily F/TDF in the sexual-behavior and injection-drug indications above. USPSTF explicitly does not grade cost-effectiveness.

**Cost metric.** Two opened U.S. analyses, with different years and prices. They are not interchangeable.

Juusola and colleagues, Annals of Internal Medicine, 2012, PMID 22508731, societal perspective, 2010 U.S. dollars, 3% annual discount, 20-year horizon, efficacy assumed at 44% from the iPrEx trial: if PrEP is initiated in 20% of men who have sex with men in the United States, a 13% reduction in new HIV infections and a gain of 550,166 QALYs over 20 years at $172,091 per QALY gained. If 100% receive PrEP, $216,480 per QALY gained. For men who have sex with men with 5 annual partners on average, the abstract says PrEP costs approximately $50,000 per QALY gained; the opened high-risk table prints $52,443 per QALY gained for 100% of that high-risk group relative to the status quo. PrEP for all high-risk men who have sex with men for 20 years leads to $75 billion in healthcare-related costs incremental to the status quo and $600,000 per HIV infection averted, compared with incremental costs of $95 billion and $2 million per infection averted for 20% coverage of all men who have sex with men. The conclusion says annual expenditures on PrEP could be over $4 billion. Table 1 prints a 30-day TDF/FTC supply at $776 (range $300–$1,118), 2010 U.S. dollars. This price is a 2010 branded-era input, not a 2026 generic price.

Neilan and colleagues abstract, PMID 35099992, does not report an incremental cost-effectiveness ratio for generic F/TDF versus no PrEP in the abstract text fetched. It does print annual base-case drug costs of $360 for generic F/TDF and $16,800 for branded F/TAF, in the abstract's 2020 U.S. dollar frame, and off-PrEP incidence of 5.32 per 100 person-years versus 1.33 per 100 person-years on generic F/TDF and branded F/TAF, in a very-high-risk men who have sex with men and transgender women population. A full-text table figure seen only in an unopened search snippet is not used.

A Coachella Valley or Riverside County cost per QALY, cost per infection averted, or program budget for oral PrEP was not found in sources retrieved.

**Equity.** USPSTF page: PrEP is underutilized, particularly for Black and Hispanic/Latino persons with indications. The same page cites a CDC survey in 7 cities with HIV prevalence of 42% among transgender women, 62% among Black transgender women, and 65% among Native American/Alaska Native transgender women. That is not a Coachella Valley estimate, and the survey question wording was not found in sources retrieved. Chou separates some trial populations as cisgender men who have sex with men and transgender women, and as cisgender women, but the oral-PrEP-versus-placebo pooled relative risk is not printed as a transgender-only estimate. East-valley, youth-under-18, older-adult, Spanish-speaking, immigrant, and farmworker outcome estimates for oral PrEP were not found in sources retrieved. CDC PDF text: F/TAF is not recommended for women or other persons at risk through receptive vaginal sex because it had not been studied in those groups; for transgender women who have sex with men, daily F/TAF is grade IIB, while for men it is grade IA. That is an evidence-grade difference by the guideline's gender categories, not a finding that F/TDF is unavailable to transgender women.

**Local feasibility.** DAP Health's opened PrEP page says the organization offers free or low-cost oral and long-acting injectable PrEP and PEP, same-day prescriptions, labs, and starter doses when needed, and a free navigator consultation at 760.466.0800, extension 761. The page footer address is 1695 N. Sunrise Way, Palm Springs, CA 92262. Other valley clinic addresses were not found on that opened page. Client volume was not found. Riverside University Health System's opened page says most California residents qualify for free PrEP, lists daily pills and injectable PrEP, and lists an Indio Family Health Center at 47-923 Oasis Street, Indio, CA 92201, hours once a month, 8 a.m.–1 p.m., phone (951) 358-6037. The same page lists Riverside Neighborhood Health Clinic and Perris Family Care Center, which are outside the Coachella Valley. Whether once-monthly Indio hours meet valley need was not found in sources retrieved. Spanish-language PrEP navigation was not found on the opened DAP or RUHS pages.

### 2. Long-acting injectable cabotegravir PrEP

**Population reached, as measured.** USPSTF: injectable cabotegravir is an effective formulation approved for at-risk adults and adolescents weighing at least 35 kg to reduce sexually acquired HIV. CDC PDF text: intramuscular cabotegravir every 2 months for sexually active men, women, and transgender persons with indications; graded IA for adults reporting sexual behaviors that place them at substantial ongoing risk. The 2021 PDF said this recommendation was conditional on FDA approval; the 2023 USPSTF page states cabotegravir is FDA-approved. Chou: one trial in cisgender men who have sex with men and transgender women (n = 4,490) and one trial in cisgender women (n = 3,178). The opened Chou text does not print a separate transgender-women-only relative risk. Neilan abstract target population: 476,700 men who have sex with men and transgender women at very high risk, and a separate high-risk population of 1,906,800. Brogan abstract: adult men who have sex with men, transgender women, and cisgender women at risk. Question wording was not found in sources retrieved. These sources measure sexual behavior and gender identity categories differently and sometimes combine men who have sex with men with transgender women.

**Outcome.** Chou: cabotegravir versus oral TDF/FTC, relative risk 0.33 (95% CI, 0.18–0.62) in cisgender men who have sex with men and transgender women, and relative risk 0.11 (95% CI, 0.04–0.31) in cisgender women. USPSTF grade A includes injectable cabotegravir as effective antiretroviral PrEP. Neilan abstract: estimated HIV incidence 5.32, 1.33, and 0.26 per 100 person-years for off PrEP, generic F/TDF and branded F/TAF, and cabotegravir, respectively; 28% 6-year PrEP retention. Compared with generic F/TDF or branded F/TAF, cabotegravir increased life expectancy by 28,000 QALYs or 26,000 QALYs among those at very high risk. Brogan abstract: the cabotegravir pathway prevented 4.5 more primary and secondary HIV-1 infections per 100 PrEP users than the oral pathway and yielded 0.2 fewer QALYs lost per person.

**Evidence grade.** Clinical prevention: USPSTF grade A, with Chou reporting trial relative risks above. CDC/USPHS 2021 extracted text: IA for cabotegravir injections in adults with sexual exposure risk. Cost-effectiveness is not graded by USPSTF. The two opened cost-effectiveness abstracts do not agree at unconstrained prices. Both are reported. This review does not pick one because it is newer or industry-sponsored.

**Cost metric.** Neilan and colleagues, Annals of Internal Medicine, 2022, PMID 35099992, health care system perspective, 10-year horizon, abstract currency 2020 U.S. dollars: at 10 years, cabotegravir could achieve an incremental cost-effectiveness ratio of at most $100,000 per QALY compared with generic F/TDF at a maximum price premium of $3,700 per year over generic F/TDF, which the abstract states as a cabotegravir price under $4,100 per year, in the very-high-risk population. In the high-risk population, the maximum price premium for that same $100,000 per QALY ceiling was $1,100 per year, cabotegravir price under $1,500 per year. Annual base-case drug costs printed in the abstract: $360 generic F/TDF and $16,800 branded F/TAF. The abstract says branded F/TAF cost more per QALY gained than generic F/TDF compared with no PrEP. It does not print the actual U.S. acquisition price of cabotegravir.

Brogan and colleagues, PharmacoEconomics, 2024, PMID 38267806, healthcare sector perspective, lifetime horizon, 3% discount, 2022 U.S. dollars: additional per-person lifetime costs $9,476, incremental cost-effectiveness ratio $46,843 per QALY gained versus generic daily oral FTC/TDF. Europe PMC grants list: ViiV Healthcare, Inc. The abstract says results remained consistent in sensitivity analyses, including underserved populations with low oral PrEP usage, but it does not print a separate ratio for those populations.

Pepperrell and colleagues abstract, PMID 36632416: "Cabotegravir is currently priced at $22 200 per year," more than 185 times higher than a $60–$119 cost-effectiveness threshold the abstract assigns to middle-income countries. That abstract is not a U.S. cost-effectiveness analysis and does not state the payer or calendar year of the $22 200 figure beyond "currently." It is reported only so the price sentence is not confused with Neilan's threshold price.

A Coachella Valley price, copay, or 340B acquisition cost for cabotegravir was not found in sources retrieved. DAP's opened page says long-acting injectable PrEP is offered and that cost is not a barrier in most cases, without a dollar figure.

**Equity.** Chou's transgender women result is pooled with cisgender men who have sex with men. A transgender-only cost-effectiveness ratio was not found in the Neilan or Brogan abstracts fetched. Cisgender women have a separate efficacy relative risk in Chou and are included in Brogan's population statement, but Brogan's abstract ratio is not printed separately for cisgender women. East-valley, Spanish-speaking, immigrant, youth-under-18, and older-adult cabotegravir outcomes were not found in sources retrieved. CDC 2021 text says cabotegravir was added for sexually active men, women, and transgender persons; injection-drug-use-only approval language was not found in the opened PDF lines. USPSTF says no PrEP medication has FDA approval for the indication of reducing acquisition via injection drug use, while CDC guidelines note that people who inject drugs are likely to benefit from any FDA-approved PrEP medication.

**Local feasibility.** Same DAP and RUHS pages as option 1. Injectable administration requires a clinic visit. RUHS Indio hours on the opened page are once a month. Whether cabotegravir's every-2-month schedule can be delivered at that site was not found in sources retrieved. Palm Springs DAP address is on the opened DAP page. Full-valley coverage was not found.

### 3. HIV screening, early treatment, and status-neutral care

**Population reached, as measured.** USPSTF screening recommendation, June 11, 2019: adolescents and adults aged 15 to 65 years, plus younger adolescents and older adults at increased risk, and all pregnant persons. Risk factors printed on the page include male-to-male sexual contact, injection drug use, anal intercourse without a condom, vaginal intercourse without a condom with more than one partner of unknown HIV status, transactional sex, other sexually transmitted infections, and a partner living with HIV or in a high-risk category. The page says persons who request testing are also considered at increased risk. It does not print a sexual-orientation identity question or a gender-identity question. The page states the topic is being updated; the June 11, 2019 statement was the final statement opened.

CDC status-neutral Stacks record, August 19, 2022: a service-delivery approach for people with and without HIV, aimed at culturally affirming care at every engagement. The opened record is a fact-sheet landing page. It does not report a trial population, a gender-identity measure, or an outcome estimate. The PDF body was not extracted.

HRSA press release, December 17, 2025: people with HIV served by the Ryan White HIV/AIDS Program. Sexual orientation and gender identity were not reported in the opened release.

**Outcome.** USPSTF: grade A for screening ages 15 to 65 and grade A for pregnant persons. The Task Force found convincing evidence that recommended HIV tests are highly accurate, that identification and early antiretroviral treatment substantially reduce AIDS-related events or death, that viral suppression decreases transmission to uninfected sex partners, and that identification and treatment of pregnant persons living with HIV substantially reduce mother-to-child transmission. Harms are rated small relative to benefits. The opened rationale says approximately 15% of persons living with HIV are unaware of their infection and that persons unaware of their HIV status are responsible for 40% of transmission in the United States. Those are national figures in the recommendation, not Coachella Valley figures. Repeat-interval evidence was insufficient, with repeat screening described as reasonable for people at increased risk, including sexually active men who have sex with men.

HRSA: 91.4% of patients receiving HIV medical care through the Ryan White HIV/AIDS Program were virally suppressed in 2024, up from 69.5% in 2010, and higher than 67.2% virally suppressed nationally among all people with diagnosed HIV. The release says nearly 602,000 clients were served in 2024, over 50% of people with diagnosed HIV in the United States, and that about 87% of new HIV transmissions result from people who are undiagnosed or not engaged in care, attributed in the release to CDC. Status-neutral care, on the opened Stacks description, is a delivery framework, not a trial result.

**Evidence grade.** USPSTF grade A for screening, with the page stating high certainty of substantial net benefit. USPSTF does not consider costs. Status-neutral approach: no evidence grade was printed on the opened Stacks record. Ryan White viral suppression is a program outcome, not a randomized evidence grade.

**Cost metric.** Not found in sources retrieved for HIV testing cost per QALY, cost per infection averted, or status-neutral program cost. PubMed query "HIV testing cost-effectiveness status-neutral care United States" failed with API error 429. USPSTF states that it does not consider costs. HRSA's opened release says viral suppression reduces health care costs but prints no dollar figure.

Ryan White is a financing and service platform, not a cost-effectiveness ratio. HRSA FY 2025 Part B table, last reviewed January 2026, California row, which is statewide and not a Coachella Valley allocation: base award $36,890,303; ADAP award $102,403,026; ADAP supplemental $0; emerging communities $199,897; Minority AIDS Initiative $1,403,154; Part B award (X07) $140,896,380; Part B supplemental (X08) $3,616,421; Part B emergency relief (X09) $4,652,262; total Part B funding $149,165,063. The page note says the X07 total includes base, ADAP, ADAP supplemental, emerging communities, and Minority AIDS Initiative. A Riverside County or Coachella Valley subaward was not found in sources retrieved. California ADAP clients served were not used because the CDPH FY 2023–2024 ADAP PDF did not open.

**Equity.** Screening from age 15 reaches youth; adults older than 65 are screened if at increased risk, which matters for older adults but is risk-based rather than universal in the recommendation. Gender identity is not a printed screening criterion. Transgender-specific screening yield was not found in sources retrieved. Ryan White release: more than 47% of clients were aged 50 years and older in the 2024 data described. East-valley, Spanish-speaking, and immigrant shares of Ryan White clients were not found in sources retrieved. The release says the program serves people with HIV with lower incomes and funds transportation, housing, mental and behavioral health, medical case management, and nutrition, which are relevant to access but are not valley-specific.

**Local feasibility.** RUHS opened page: free at-home HIV test kits through a partner program, results in as few as 20 minutes for some types, or a few days if sent to a lab. Eligibility questions are on the partner site, which was not opened, so who qualifies locally was not found beyond the RUHS statement that people can answer questions to see if they qualify. Clinic PrEP access is as in option 1, including once-monthly Indio hours. A valley Ryan White provider list was not opened. DAP is a deemed Federally Qualified Health Center on the opened page, which is an organizational status, not a client count.

### 4. Syringe services programs

**Population reached, as measured.** CDC SSP page, March 20, 2024: people who use or inject drugs or have a history of injecting drugs. Sexual orientation and gender identity were not measured on that page. This option is relevant to LGBTQIA+ people who inject drugs, but the opened effectiveness statements are not LGBTQ-specific. CDC HI-5 page uses injection drug use and people who inject drugs. It is not an identity prevalence.

**Outcome.** CDC SSP page: syringe services programs are associated with an estimated 50% reduction in HIV and hepatitis C incidence. The page says nearly 30 years of research show comprehensive programs are safe, effective, and cost-saving, do not increase illegal drug use or crime, and reduce transmission of viral hepatitis, HIV, and other infections. The 50% figure is not accompanied on the opened page by a confidence interval, year, or identity subgroup.

CDC HI-5 page, summarizing studies it cites: a systematic review of 15 studies found needle-syringe programs associated with decreases in HIV and HCV prevalence and HIV incidence. New York legalization studies, 1990–2002, are summarized as HIV prevalence falling from 50% to 17% (p < .001) and person-years at risk for HIV from 3.55 to 0.77 per 100 person-years (p < .001). HCV prevalence among HIV-negative people who inject drugs fell from 80% to 59% (p < 0.034) between 1990 and 2001 in the summary of a New York study. A District of Columbia evaluation is summarized as a 70% decrease in new HIV cases among people who inject drugs and 120 HIV cases averted in two years. These are the HI-5 page's summaries of other studies, not Coachella Valley surveillance.

**Evidence grade.** CDC's opened program page calls the evidence base nearly 30 years of research and calls programs cost-saving. It does not print an evidence-based-intervention grade. The compendium landing page was opened, but a syringe-services compendium chapter summary was not.

**Cost metric.** CDC HI-5 page: a New York City analysis estimated baseline one-year savings to the government of $1,300 to $3,000 per client. Another analysis estimated that an additional annual U.S. investment of $10 million would avert 194 HIV infections in one year, with lifetime treatment cost savings of $75.8 million in 2011 dollars, and a return of $7.58 per $1 spent from the national perspective. The same page prints a lifetime HIV treatment cost of $379,668 in 2010 dollars as a cited estimate, and initial 2014 HCV drug prices of $84,000 to $96,000, later an estimated $40,000 for Medicaid programs. Those drug prices are context on the HI-5 page, not a Coachella Valley program budget.

CDC SSP page: over five years, CDC expects to award approximately $10 million across two national program components, pending funds. That is a national cooperative-agreement figure, not a local program cost and not a cost per QALY.

A Riverside County syringe-services budget, client count, or cost per infection averted was not found in sources retrieved. The PubMed query for syringe-services cost-effectiveness returned API error 429; the HI-5 page is the opened cost source used instead.

**Equity.** East-valley, transgender, youth, older-adult, Spanish-speaking, and immigrant outcomes for syringe services were not found in sources retrieved. USPSTF PrEP page includes people who inject drugs in PrEP consideration, so syringe services and PrEP are complementary in the opened guidelines, not substitutes. CDC PrEP PDF text says follow-up for people who inject drugs includes access to clean needles or syringes and drug-treatment services.

**Local feasibility.** A Coachella Valley or Riverside County syringe-services site, hours, or language access was not found in sources retrieved. Queries did not open a county harm-reduction directory. DAP's opened page describes sexual-health prevention, not syringe services.

### 5. Housing First / permanent supportive housing

**Population reached, as measured.** Jacob and colleagues, American Journal of Preventive Medicine, 2022, PMID 34774389, opened via CDC Stacks: Housing First programs for people experiencing homelessness. The opened abstract says the program addresses chronic homelessness and has been shown to be effective, then reports economic results. It does not print sexual orientation, sexual behavior, or gender identity. It does not print an HIV-specific subgroup. A Community Guide findings page that, in a search snippet, mentioned HIV was not opened, so an HIV-specific housing outcome is not claimed.

**Outcome.** The opened abstract says Housing First has been shown to be effective. It does not print housing-stability percentages, emergency-department reductions, or quality-of-life percentages. Those figures appeared in an unopened Community Guide snippet and are not used. Economic outcome is below.

**Evidence grade.** Community Preventive Services Task Force is the corporate author on the Stacks record. The opened abstract does not print the words "recommended" or a letter grade. The effectiveness finding is the sentence that the program "has been shown to be effective," plus the economic conclusion. A fuller CPSTF rationale page was not opened.

**Cost metric.** Jacob and colleagues, 2019 U.S. dollars, 20 studies through November 2019, 17 from the United States and 3 from Canada: median intervention cost per person per year for U.S. studies $16,479, and for all studies $16,336. Median total benefit for U.S. studies $18,247 per person per year, and $17,751 for all studies. Benefit-to-cost ratio for U.S. studies 1.80:1, and for all studies 1.06:1. The abstract says economic benefits exceed the cost of Housing First programs in the United States, and that there were too few studies to determine cost-benefit in the Canadian context. The introduction sentence says the annual economic burden of chronic homelessness in the United States is estimated to be as high as $3.4 billion. A cost per QALY was not found in the opened abstract. A Coachella Valley housing program cost was not found in sources retrieved.

**Equity.** LGBTQIA+ people, transgender people, youth, older adults, Spanish-speaking people, and immigrant communities were not subgrouped in the opened abstract. East-valley homelessness was not found. Housing is relevant to HIV outcomes in program logic, but that link was not quantified in the opened Jacob abstract. Using this option for LGBTQIA+ health is an equity rationale, not a finding that the economic review measured sexual orientation or gender identity.

**Local feasibility.** A Housing First or permanent supportive housing program in the Coachella Valley, with clients served or LGBTQ inclusion, was not found in sources retrieved. HRSA's Ryan White release lists housing as a type of support service the national program can fund. A local Ryan White housing allocation was not found.

### 6. LGBQ-affirmative cognitive behavioral therapy for young sexual-minority men

**Population reached, as measured.** Pachankis and colleagues, Journal of Consulting and Clinical Psychology, 2022, PMID 35482652: young HIV-negative sexual-minority men, described as gay and bisexual men and as sexual minority men, ages 18–35, N = 254, 67.2% racial/ethnic minority, with a depression, anxiety, and/or stress- or trauma-related disorder and past-90-day HIV-transmission-risk behavior. This is a sexual-orientation and sexual-behavior sample of men. Transgender women, nonbinary people, and cisgender sexual-minority women were not the enrolled population in the opened abstract. Question wording for "gay" and "bisexual" was not found in sources retrieved.

**Outcome.** Participants were randomized to 10-session ESTEEM (n = 100), 10-session community-based LGBQ-affirmative counseling (n = 102), or HIV testing and counseling only (n = 52). For any HIV-transmission-risk behavior at 8 months, ESTEEM versus HIV testing and counseling, risk ratio 0.89, p = 0.52. Frequency of HIV-transmission-risk behavior, risk ratio 0.69 versus HIV testing and counseling and 0.62 versus LGBQ-affirmative counseling; the opened abstract says these differences were not significant. For depression, anxiety, substance use, suicidality, and number of mental health diagnoses at 8 months, ESTEEM had a larger effect size than the two comparison conditions, but comparisons did not reach statistical significance after false-discovery-rate adjustment. The conclusion says the study had insufficient power to detect a consistently small-to-moderate benefit. An earlier waitlist trial is described in the introduction of the opened paper; its numeric results were not in the lines used here and are not quoted.

**Evidence grade.** This is one randomized trial, not a USPSTF grade. The primary and adjusted secondary comparisons in this trial were not statistically significant. A PubMed search for an LGBTQ-affirming mental-health systematic review combined with CBT and sexual-minority depression returned 0 articles. This option is retained as an extracted trial, not as a demonstrated superior program.

**Cost metric.** Not found in sources retrieved. No cost, cost per QALY, or session price was in the opened trial text used.

**Equity.** The sample was young adult men, including a majority racial/ethnic minority share as printed (67.2%), which does not identify Hispanic, Spanish-speaking, or immigrant participants. Transgender people, women, adolescents under 18, older adults, and east-valley residents were not the study population. No Coachella Valley site was described.

**Local feasibility.** A valley clinic offering ESTEEM or an equivalent manualized LGBQ-affirmative CBT protocol was not found in sources retrieved. DAP's opened page describes sexual-health navigation, not this psychotherapy protocol.

### 7. Gender-affirming hormone therapy and mental health

**Population reached, as measured.** Baker and colleagues, Journal of the Endocrine Society, 2021, PMID 33644622: transgender people of any age on gender-affirming hormone therapy for at least 3 months. Included studies: 3 of trans-feminine people only, 7 of trans-masculine people only, 10 of both, and 3 focused on adolescents. Gender identity is the population frame. Sexual orientation was not the inclusion rule. The review is about hormone therapy, not a protocol for surgery, puberty suppression doses, or a local clinic pathway. This dossier does not restate doses or clinical protocols.

**Outcome.** Twenty studies in 22 publications: 15 trials or prospective cohorts, 1 retrospective cohort, and 4 cross-sectional studies. Seven assessed quality of life, 12 depression, 8 anxiety, and 1 death by suicide. The abstract says hormone therapy was associated with increased quality of life, decreased depression, and decreased anxiety, with similar associations across gender identity and age. Certainty is limited by high risk of bias, small samples, and confounding with other interventions. The review could not draw conclusions about death by suicide.

**Evidence grade.** The authors graded strength of evidence with AHRQ methods, but the opened extraction did not support quoting an overall "low" or "moderate" label for a named outcome without a clearer table row. The grade used here is the abstract's own certainty statement: limited by high risk of bias, small samples, and confounding; no conclusion on suicide. This is not a USPSTF recommendation. The opened review was conducted for WPATH standards-of-care revision; WPATH did not control analysis, according to the paper.

**Cost metric.** Not found in sources retrieved. Searches for this option did not return an opened cost-per-QALY or program-cost figure for gender-affirming hormone therapy.

**Equity.** The review includes trans-feminine and trans-masculine people and some adolescents, and says associations were similar across gender identity and age. It does not estimate east-valley, Spanish-speaking, immigrant, or older-adult effects. Sexual-orientation subgroups were not found. Because suicide conclusions could not be drawn, this option must not be described as a proven suicide-prevention program.

**Local feasibility.** A Coachella Valley gender-affirming hormone program, wait time, language access, or payer mix was not found in sources retrieved. DAP's opened page does not describe hormone therapy. CDC's TRANSCEND demonstration project appeared in a search result and was not opened, so it is not cited.

### 8. School gender-sexuality alliances or gay-straight alliances

**Population reached, as measured.** Marx and colleagues, Journal of Youth and Adolescence, 2016, PMID 27221632: the opened PubMed record lists Robert A. Marx and colleagues. The full coauthor list was not displayed on the opened record. The meta-analysis synthesized 15 studies, 62,923 participants, on school GSA presence and LGBTQ+ youth self-reports of school-based victimization. The abstract uses LGBTQ+ youth and does not separate sexual orientation from gender identity, and it does not print question wording.

**Outcome.** GSA presence was associated with significantly lower self-reported homophobic victimization, fear for safety, and hearing homophobic remarks. The abstract says results were robust to study-level factors. It does not print a pooled effect size, confidence interval, or suicide outcome. A 2024 study of enumerated antibullying laws and suicide attempts (PMID 38564182) did not open. Suicide outcomes for GSAs are therefore not found in sources retrieved.

**Evidence grade.** The paper is a systematic review and meta-analysis. It is not a USPSTF or CDC compendium grade. No cost-effectiveness grade was printed.

**Cost metric.** Not found in sources retrieved.

**Equity.** The abstract supports GSAs as protection from school-based victimization for LGBTQ+ youth as measured in the included studies. It does not report east-valley schools, Spanish-speaking youth, immigrant youth, transgender-only estimates, or older adults. Transgender youth may be inside the LGBTQ+ label; the opened abstract does not show a separate estimate.

**Local feasibility.** A Coachella Valley, Palm Springs Unified, Desert Sands, or Coachella Valley Unified GSA count or evaluation was not found in sources retrieved. No school-district page was opened.

### 9. Cooling centers and brief air-conditioning for older adults in extreme heat

**Population reached, as measured.** Meade and colleagues, Environmental Health Perspectives, 2023, PMID 37262028: 40 adults aged 64–79 years in a laboratory heat-wave simulation in Ottawa, Ontario, Canada. Sex was not a result used here. Sexual orientation and gender identity were not measured. The study is not a Coachella Valley evaluation and is not an LGBTQIA+ evaluation. It is included because extreme heat is a valley exposure and older adults are a required equity group, with the geography limitation stated.

Local reach, from the opened 2026 Riverside County cool-center directory published with Community Action Partnership of Riverside County contact information: sites whose rows were clearly readable include Cathedral City Library, 33520 Date Palm Drive, Cathedral City 92234; Coachella Senior Center, 1540 7th Street, Coachella 92236, Monday–Friday 8:00 a.m.–3:30 p.m.; Desert Hot Springs Library area site at 14380 Palm Drive and a seniors-only Desert Hot Springs site at 11777 West Drive; Indio sites including 84110 Manila Street (Coachella Valley Rescue Mission row in the directory text), Indio Senior Center at 45700 Aladdin Street marked seniors only, Martha's Village at 83791 Date Avenue, and Molina Indio One Stop at 81735 Highway 111. The directory is a location list, not a user count and not an LGBTQ count.

**Outcome.** Meade and colleagues: a 2-hour midday air-conditioned period during a 9-hour simulated heat wave (heat index 37°C) lowered core temperature by 0.8°C (95% CI, 0.6 to 0.9) at the end of cooling compared with control, and by 0.3°C (95% CI, 0.2 to 0.4) one hour after return to heat. Core temperatures were statistically equivalent at hours 8 and 9, within ±0.3°C. Cardiovascular benefits were also transient. The paper says a CDC systematic review found no direct evidence linking cooling centers with reduced mortality or morbidity; that CDC review was not opened in this run, so the sentence is attributed to Meade and colleagues rather than independently verified. Meade and colleagues also say case-control studies found older adults who visited cooled locations were up to 66% less likely to die of heat-related causes, and they warn that confounding is likely. Those case-control papers were not opened.

**Evidence grade.** Laboratory physiologic evidence in 40 older adults, not a mortality trial and not a USPSTF grade. Direct evidence that valley cooling centers reduce deaths was not found in sources retrieved.

**Cost metric.** Not found in sources retrieved. Searches for extreme-heat intervention cost-effectiveness returned snippets of an Oxford review and a healthcare-cost meta-analysis that were not opened. No cost per QALY, cost per death averted, or Riverside County cool-center budget was retrieved from an opened page. A news page and a grant packet that printed user counts or an estimated 20,000 persons were not opened and are not used.

**Equity.** Meade's sample is older adults, which matches one required equity group, in Canada, not the valley. Local seniors-only sites, as marked in the directory for Indio Senior Center and one Desert Hot Springs site, do not by themselves serve younger LGBTQ adults. East-valley sites in Indio and Coachella were readable in the directory, so the opened list is not Palm Springs alone. Palm Springs, Mecca, Thermal, and North Shore were not confirmed by the pattern search of the opened PDF text; absence from that search is a retrieval limit, not proof those cities have no center. Spanish-language directory: the opened file name is English. A Spanish directory was not opened. LGBTQ-specific heat outcomes were not found. Immigrant and farmworker heat outcomes were not found.

**Local feasibility.** The directory exists for 2026 and names Community Action Partnership of Riverside County, 3403 Tenth Street #300, Riverside, CA 92501, phone 951-955-4900. Hours differ by site and include weekday daytime windows that may not cover evening heat. No evaluation of transportation to centers was opened. This is an operating local service, not an opened effectiveness evaluation.

### 10. Community health workers, including promotora-labeled roles

**Population reached, as measured.** Wilder and colleagues, Preventing Chronic Disease, October 29, 2026: systematic review of U.S. randomized trials of community health worker interventions addressing at least one social-determinant domain among adults with chronic disease. Seven trials met inclusion criteria. Search terms included promotoras. Participants were predominantly racial and ethnic minority populations; Hispanic adults were 3% to 46.7% of study populations across studies. Mean age 52.5 years (SD 23.5). Conditions included HIV, diabetes, asthma, hepatitis C, and hearing loss. One HIV study was of people recently released from jail who use substances. Farmworker status, Spanish language of intervention, sexual orientation, and gender identity were not results in the opened sections.

**Outcome.** The review says community health worker interventions improved engagement in care and addressed social needs, with modest and variable clinical effects. Asthma control improved by 2.02 symptom-free days (95% CI, 0.94–3.09). No significant glycemic improvement was found in the diabetes studies. Hoff and colleagues, as summarized by Wilder: no significant difference in HIV viral suppression at 6 months, 20% versus 37%, P = .61, for the community-health-worker arm versus treatment as usual. The review's own conclusion is that evidence of meaningful clinical benefit is still limited.

**Evidence grade.** Systematic review of 7 randomized trials. Not a USPSTF grade. The HIV finding cited is a null result in a small trial summary. This is not evidence that a promotora HIV program in the east valley would improve viral suppression.

**Cost metric.** Not found in sources retrieved. The opened Wilder sections discuss health care costs as background and do not print a cost per QALY, cost per client, or incremental cost-effectiveness ratio. A separate scoping review of community health worker costs in low- and middle-income countries was a search snippet and was not opened. A farmworker-specific cost search did not yield an opened economic evaluation.

**Equity.** The review is the closest opened source to Spanish-speaking and Hispanic reach because promotora was a search term and Hispanic participation was reported as a range. It does not show a Spanish-language or farmworker effect. It does not measure sexual orientation or gender identity. The HIV trial summary is a jail-release population, not a valley farmworker population. East-valley applicability was not found.

**Local feasibility.** A Coachella Valley promotora, community health worker, or farmworker HIV or chronic-disease program evaluation was not found in sources retrieved.

### 11. CDC compendium as a menu, not a local program

**What was opened.** CDC HIV Prevention Research Synthesis Project methods record, April 1, 2024. The compendium has five chapters: risk reduction (1996), medication adherence (2010), linkage, retention, and re-engagement (2013), structural interventions (2017), and PrEP (2020). Evidence-based interventions are the strongest evidence of efficacy. Evidence-informed interventions have some evidence and ideally need further testing. Individual intervention summaries for men who have sex with men or transgender people were not opened. No outcome, population count, or cost is taken from an unopened summary. This record is a methods source, not a valley program.

## What this review does not recommend from familiarity alone

DAP's opened page describes DoxyPEP as two 100 mg doxycycline tablets taken 24–72 hours after unprotected sex. No effectiveness trial or cost study for DoxyPEP was opened. DoxyPEP is recorded as a local service description only. It is not retained as an evidence-based option in the table.

Lenacapavir PrEP guidance was listed as a related CDC Stacks item on the 2021 guideline page and was not opened. No lenacapavir efficacy or cost figure is used.

Los Angeles County PrEP cost-effectiveness figures in a search snippet were not opened and are not used.

News accounts of cooling-center use are not used as effectiveness or cost evidence.

## Quantitative claims extracted

Indicator | group | place | year | estimate | interval or numerator/denominator | sample size | identity measurement | source | URL or PMID | comparability note

Oral PrEP vs placebo or no PrEP, HIV acquisition | adolescents and adults at increased risk in trials; no one under 18 enrolled | trials, not Coachella Valley | evidence search through 2022; summary 2023 | RR 0.46 | 95% CI 0.33–0.66; absolute risk reduction −2.0% (95% CI −2.8% to −1.2%) | 11 trials, n = 18,172 | sexual and injection risk in trials; not a single identity question | Chou et al. evidence summary | https://www.uspreventiveservicestaskforce.org/uspstf/document/final-evidence-summary/prevention-of-human-immunodeficiency-virus-hiv-infection-pre-exposure-prophylaxis | Not a valley estimate

Oral PrEP, adherence >70% | trial participants with higher adherence | trials | 2023 summary | RR 0.27 | 95% CI 0.19–0.39 | 6 trials, n = 7,328 | same as above | Chou et al. | same URL | Subgroup of the oral PrEP evidence

Cabotegravir vs oral TDF/FTC | cisgender men who have sex with men and transgender women | trials | 2023 summary | RR 0.33 | 95% CI 0.18–0.62 | n = 4,490 | gender identity and sexual behavior combined in one trial population; not separated in this estimate | Chou et al. | same URL | Do not read as a transgender-only effect

Cabotegravir vs oral TDF/FTC | cisgender women | trials | 2023 summary | RR 0.11 | 95% CI 0.04–0.31 | n = 3,178 | cisgender women; not a sexual-orientation measure | Chou et al. | same URL | Not a valley estimate

Persons with HIV, U.S. | persons with HIV | United States | USPSTF PrEP page 2023 | 1.2 million | deaths since 1981 more than 760,000 | not found in sources retrieved | not an identity measure | USPSTF | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/prevention-of-human-immunodeficiency-virus-hiv-infection-pre-exposure-prophylaxis | National, not valley

HIV prevalence among transgender women | transgender women in 7 cities; Black transgender women; Native American/Alaska Native transgender women | 7 U.S. cities, as cited by USPSTF | cited on 2023 page; survey year not found in sources retrieved | 42%; 62%; 65% | not found in sources retrieved | not found in sources retrieved | USPSTF calls it a CDC survey; question wording not found | USPSTF | same URL | Not Coachella Valley; do not use as local prevalence

PrEP in 20% of MSM | men who have sex with men aged 13–64 | United States | model published 2012; costs 2010 USD | $172,091 per QALY; 13% fewer new infections; 550,166 QALYs over 20 years | not found in sources retrieved | modeled MSM population 4,343,741 in Table 1 | sexual behavior, not gender identity | Juusola et al. | PMID 22508731 | Historical branded price; not 2026 generic price; not valley

PrEP in 100% of MSM | men who have sex with men | United States | 2012 model | $216,480 per QALY | not found in sources retrieved | same model | sexual behavior | Juusola et al. | PMID 22508731 | Same limitation

PrEP in high-risk MSM | MSM with 5 annual partners on average | United States | 2012 model | abstract approximately $50,000 per QALY; table $52,443 per QALY for 100% of high-risk group | $75 billion incremental healthcare-related costs and $600,000 per infection averted for all high-risk MSM over 20 years | not found as a valley sample | sexual behavior | Juusola et al. | PMID 22508731 | Abstract rounds; table prints $52,443

TDF/FTC 30-day supply input | PrEP drug price input | United States model | 2010 USD | $776 | range $300–$1,118 | not applicable | not an identity measure | Juusola et al. Table 1 | PMID 22508731 | Not a 2026 price

Generic F/TDF and branded F/TAF annual drug cost | model inputs | United States | Neilan 2022 abstract; 2020 USD | $360 and $16,800 | not found in sources retrieved | not applicable | not an identity measure | Neilan et al. | PMID 35099992 | Drug cost inputs, not ICERs

HIV incidence off PrEP, on oral PrEP, on cabotegravir | MSM/TGW at very high risk | United States model | Neilan abstract | 5.32, 1.33, and 0.26 per 100 person-years | not found in sources retrieved | 476,700 very-high-risk MSM/TGW | men who have sex with men and transgender women combined | Neilan et al. | PMID 35099992 | Combined category; not separated

Cabotegravir price premium for ICER at most $100,000 per QALY vs generic F/TDF | very-high-risk MSM/TGW | United States | 10-year model, abstract | maximum premium $3,700 per year; cabotegravir price under $4,100 per year | QALY gain vs generic F/TDF 28,000 in this population | 476,700 | MSM and transgender women combined | Neilan et al. | PMID 35099992 | Threshold price, not a quoted market price

Cabotegravir price premium for the same ICER ceiling | high-risk rather than very-high-risk | United States | same abstract | maximum premium $1,100 per year; price under $1,500 per year | off-PrEP incidence 1.54 per 100 person-years | 1,906,800 | MSM/TGW as defined in the abstract | Neilan et al. | PMID 35099992 | Different risk group from the row above

Cabotegravir vs generic oral FTC/TDF | adults at risk: MSM, transgender women, and cisgender women | United States | Brogan 2024; 2022 USD | $46,843 per QALY | $9,476 additional lifetime cost per person; 4.5 more infections prevented per 100 users; 0.2 fewer QALYs lost per person | decision model, not a trial n | three groups named; ratio not stratified in the abstract | Brogan et al. | PMID 38267806 | ViiV-funded; conflicts with unconstrained-price reading of Neilan; do not average the ratios

Cabotegravir current price sentence | not a U.S. ICER | middle-income-country access paper | abstract 2023 | $22 200 per year | compared in the abstract with a $60–$119 threshold for middle-income countries | not applicable | not an identity measure | Pepperrell et al. | PMID 36632416 | Not a U.S. cost-effectiveness result; payer not specified in the abstract

Ryan White viral suppression | patients receiving HIV medical care in the program | United States and territories as described by HRSA | 2024 | 91.4% | compared with 69.5% in 2010 and 67.2% nationally among people with diagnosed HIV | nearly 602,000 clients served | people with HIV; SOGI not printed | HRSA | https://www.hrsa.gov/about/news/press-releases/2025-new-data-ryanwhite-hiv | Not a valley rate

Ryan White clients aged 50 and older | program clients | United States | 2024 data in the 2025 release | more than 47% | not found in sources retrieved | nearly 602,000 clients | age, not SOGI | HRSA | same URL | National

California Ryan White Part B total FY 2025 | state Part B recipient | California, not Coachella Valley | FY 2025 | $149,165,063 | ADAP award $102,403,026; base $36,890,303; X07 $140,896,380; X08 $3,616,421; X09 $4,652,262 | clients not in this table | not an identity measure | HRSA | https://ryanwhite.hrsa.gov/about/parts-and-initiatives/part-b-adap/fy-2025-grant-awards | Statewide award, not a valley budget

Persons living with HIV unaware | persons living with HIV | United States | USPSTF screening page 2019 | about 15% unaware; unaware persons responsible for 40% of transmission | prevalence 0.4% among persons 13 and older (0.7% males, 0.2% females) | about 1.1 million living with HIV | sex categories as printed; not gender identity | USPSTF | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/human-immunodeficiency-virus-hiv-infection-screening | 2019 page; topic marked as being updated when opened in 2026

SSP HIV and HCV incidence | people who inject drugs | United States, as stated by CDC | page dated March 20, 2024 | about 50% reduction associated with SSPs | interval not found | not found | injection behavior, not SOGI | CDC | https://www.cdc.gov/hepatitis-syringe-services/php/about/index.html | Page does not show the primary study year

SSP expansion return | national hypothetical investment | United States | HI-5 page citing a national analysis; savings in 2011 dollars | $7.58 per $1; 194 HIV infections averted; $75.8 million lifetime treatment savings | from an additional $10 million annual investment | not a valley sample | people who inject drugs | CDC HI-5 | https://archive.cdc.gov/www_cdc_gov/policy/hi5/cleansyringes/index.html | National model summarized by CDC; primary paper not re-opened

New York syringe exchange savings | clients | New York City, as summarized | HI-5 page | $1,300 to $3,000 per client one-year government savings | not found | not found | people who inject drugs | CDC HI-5 | same URL | Not Riverside County

Housing First cost and benefit | people experiencing homelessness | U.S. studies in the review | 2019 USD; review published 2022 | median cost $16,479 per person per year; median benefit $18,247; benefit-to-cost 1.80:1 | all-study ratio 1.06:1; all-study cost $16,336; all-study benefit $17,751 | 17 U.S. studies and 3 Canadian studies | homelessness, not SOGI | Jacob et al. | PMID 34774389 | Not LGBTQ-specific; not valley-specific; no cost per QALY in the opened abstract

ESTEEM vs HIV testing and counseling | young HIV-negative sexual-minority men ages 18–35 | trial sites not Coachella Valley | 8-month outcome; paper 2022 | RR 0.89 for any HIV-transmission-risk behavior | p = 0.52 | N = 254; ESTEEM n = 100; affirmative counseling n = 102; testing only n = 52 | gay and bisexual men / sexual minority men; not transgender women | Pachankis et al. | PMID 35482652 | Not significant; not a valley program

GSA and school victimization | LGBTQ+ youth | studies in the meta-analysis, not valley schools | 2016 | significantly lower homophobic victimization, fear for safety, and homophobic remarks | pooled effect size not on the opened abstract | 15 studies, 62,923 participants | LGBTQ+ self-report; SO and GI not separated; wording not found | Marx et al. | PMID 27221632 | Suicide outcome not on the opened abstract

Hormone therapy and mental health | transgender people on hormones at least 3 months | included studies, not valley | search through June 10, 2020 | associated with higher quality of life and lower depression and anxiety | no pooled effect size in the abstract | 20 studies, 22 publications | gender identity; 3 adolescent-focused studies | Baker et al. | PMID 33644622 | No suicide conclusion; no cost

Cooling-center core temperature | adults 64–79 years | Ottawa laboratory | 2023 paper; exposures 2019–2021 | 0.8°C lower at hour 6; 0.3°C lower at hour 7 | 95% CI 0.6 to 0.9; 95% CI 0.2 to 0.4 | 40; 20 per group | age; SOGI not measured | Meade et al. | PMID 37262028 | Not mortality; not Coachella Valley; effect gone by hours 8–9

CHW vs usual care, HIV viral suppression | people with HIV recently released from jail who use substances | U.S. trial summarized by Wilder | 6 months | 20% vs 37% | P = .61 | not found in the Wilder sentence | not SOGI | Wilder et al. citing Hoff et al. | https://www.cdc.gov/pcd/issues/2026/26_0132.htm | Null result; not farmworker-specific

## Evidence table for retained options

No weights are applied. "Cost metric" quotes the source or says not found. Equity notes name gaps rather than inventing valley effects.

| Option | Population reached | Outcome | Evidence grade | Cost metric | Equity note | Feasibility note | Source | URL or PMID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Daily oral F/TDF PrEP | People without HIV at increased sexual or injection risk, including adolescents ≥35 kg; USPSTF names MSM, transgender women, heterosexual women and men, and people who inject drugs as risk contexts, not as one LGBT count. Juusola modeled U.S. MSM only. | Lower HIV acquisition, RR 0.46 (95% CI 0.33–0.66); stronger when adherence >70%, RR 0.27. | USPSTF A. CDC/USPHS 2021 extracted text IA for daily F/TDF. | Juusola 2012, 2010 USD: $172,091/QALY at 20% MSM coverage; about $50,000/QALY, table $52,443/QALY, in high-risk MSM; $600,000 per infection averted if all high-risk MSM covered. Neilan abstract prints generic F/TDF drug cost $360/year but not an ICER vs no PrEP. Valley cost not found in sources retrieved. | Underuse for Black and Hispanic/Latino persons with indications, per USPSTF. Transgender women named as high risk; 7-city survey cited by USPSTF is not local. F/TAF grade IIB for transgender women who have sex with men vs IA for men. East valley, Spanish, immigrant, under-18 trial enrollment: not found in sources retrieved. | DAP offers oral PrEP from a Palm Springs address on the opened page; other clinic cities not found on that page. RUHS lists Indio once monthly. | USPSTF; Chou et al.; CDC/USPHS; Juusola et al.; Neilan et al.; DAP; RUHS | USPSTF PrEP URL; Chou evidence-summary URL; https://stacks.cdc.gov/view/cdc/112360; PMID 22508731; PMID 35099992; DAP and RUHS URLs |
| Long-acting cabotegravir PrEP | Adults and adolescents ≥35 kg at sexual risk; Chou trials in cisgender MSM plus transgender women, and in cisgender women. Neilan combines MSM/TGW. | Chou RR 0.33 (MSM and transgender women) and 0.11 (cisgender women) vs oral TDF/FTC. | USPSTF A as effective PrEP. CDC extracted text IA for sexual-risk adults. Cost-effectiveness not graded. | Brogan 2024: $46,843 per QALY vs generic oral FTC/TDF; +$9,476 lifetime per person (2022 USD); ViiV-funded. Neilan 2022: price must be under $4,100/year (very high risk) or under $1,500/year (high risk) to meet at most $100,000/QALY vs generic F/TDF. Pepperrell abstract price sentence $22 200/year is not a U.S. ICER. Valley price not found. | Transgender women not separated from MSM in the Chou relative risk or in the Neilan abstract ratio. Cisgender women have an efficacy result but not a separate opened ICER. East valley and language access not found. | Injectable visits required. RUHS Indio hours once monthly on the opened page. Whether that can deliver every-2-month injections was not found. | Chou et al.; USPSTF; CDC/USPHS; Brogan et al.; Neilan et al.; Pepperrell et al. | Chou URL; USPSTF URL; Stacks 112360; PMID 38267806; PMID 35099992; PMID 36632416 |
| HIV screening, early ART, status-neutral linkage, Ryan White as the care platform | USPSTF: ages 15–65, younger and older people at increased risk, all pregnant persons. Behavior and partner risk printed; SOGI questions not printed. Ryan White: people with HIV, lower income. | USPSTF: accurate tests, fewer AIDS events and deaths, less sexual transmission when suppressed, less perinatal transmission. HRSA: 91.4% viral suppression in 2024 among medical-care patients. Status-neutral record: framework only, no outcome number. | USPSTF A. Ryan White is a program result, not a trial grade. Status-neutral grade not found in sources retrieved. | Testing cost per QALY not found. PubMed cost query failed, 429. USPSTF does not consider costs. California FY2025 Part B total $149,165,063, of which ADAP award $102,403,026. Not a valley subaward. Not a cost per QALY. | Screening includes youth from 15 and pregnant people. Adults >65 only if at risk. More than 47% of Ryan White clients aged 50+. SOGI, east valley, Spanish, immigrant shares not found. | RUHS offers free home test kits and Indio PrEP clinic hours once monthly. Valley Ryan White client count not found. CDPH ADAP client report did not open. | USPSTF screening; HRSA release; HRSA award table; CDC Stacks 129024; RUHS | USPSTF screening URL; HRSA release URL; HRSA award URL; https://stacks.cdc.gov/view/cdc/129024; RUHS URL |
| Syringe services | People who inject or use drugs. Not an LGBT count. | CDC: about 50% lower HIV and HCV incidence; cost-saving; no increase in drug use or crime, as stated on the page. HI-5 summarizes larger historical declines in New York and D.C. | CDC program page states nearly 30 years of research. No letter grade on the opened page. | HI-5: $1,300–$3,000 per client one-year government savings in a New York analysis; $7.58 returned per $1 on a $10 million national expansion, 194 HIV infections averted, $75.8 million lifetime treatment savings (2011 dollars). CDC national SSP agreement about $10 million over five years. Valley cost not found. | SOGI, east valley, youth, older adults, Spanish, immigrant outcomes not found. Complements PrEP for people who inject drugs in CDC/USPSTF text. | No Riverside or Coachella Valley SSP site opened. | CDC SSP page; CDC HI-5 | CDC SSP URL; HI-5 URL |
| Housing First | People experiencing homelessness, including chronic homelessness in the economic review. SOGI not measured. HIV subgroup not in the opened abstract. | Abstract says the program has been shown to be effective. Housing-stability percentages were on an unopened page and are not used. | CPSTF economic review. Letter grade not printed on the opened abstract. | U.S. median cost $16,479 per person per year; median benefit $18,247; benefit-to-cost 1.80:1 (2019 USD). Cost per QALY not found. Valley cost not found. | LGBTQ, transgender, youth, older adults, Spanish-speaking, immigrant, and east-valley results not found. Do not treat as an HIV intervention evaluation. | Local Housing First program not found in sources retrieved. Ryan White can fund housing support nationally; local allocation not found. | Jacob et al. | PMID 34774389; https://stacks.cdc.gov/view/cdc/114852 |
| LGBQ-affirmative CBT (ESTEEM) | HIV-negative gay and bisexual men ages 18–35 with a mental-health diagnosis and recent HIV-transmission-risk behavior. Not a transgender sample. | 8-month any risk behavior RR 0.89, p = 0.52 vs testing and counseling. Mental-health comparisons not significant after FDR. Study underpowered. | One RCT. Not superior on primary outcome. Systematic-review PubMed query returned 0. | Not found in sources retrieved. | Young men only. Racial/ethnic minority share 67.2%, not further specified. East valley, Spanish, immigrant, transgender, older adults not studied. | Valley delivery of this manual not found. | Pachankis et al. | PMID 35482652 |
| Gender-affirming hormone therapy | Transgender people on hormones ≥3 months; trans-feminine, trans-masculine, and adolescent studies included. Sexual orientation not the frame. | Associated with better quality of life and less depression and anxiety. No conclusion on suicide. | Systematic review; certainty limited by bias, small samples, confounding. Not a treatment protocol. | Not found in sources retrieved. | Includes transgender adults and some adolescents. East valley, Spanish, immigrant, older-adult-specific effects not found. Not a suicide-prevention claim. | Valley hormone-therapy access, waits, and language not found on opened pages. | Baker et al. | PMID 33644622 |
| School GSAs | LGBTQ+ youth in 15 studies. SO and GI not separated in the abstract. | Lower school victimization, fear, and homophobic remarks. Suicide outcome not found in sources retrieved. | Meta-analysis. No agency letter grade opened. | Not found in sources retrieved. | Youth. Transgender-only, Spanish-speaking, immigrant, and east-valley school estimates not found. | No local district GSA evaluation opened. | Marx et al. | PMID 27221632 |
| Cooling centers / brief cooling for older adults | Lab: adults 64–79 in Ottawa. Local directory: general public, with some seniors-only sites in Indio and Desert Hot Springs. SOGI not measured. | Brief cooling lowered core temperature temporarily; effect gone by the end of the simulated heat wave. Mortality benefit not found in an opened valley study. Meade says a CDC review found no direct mortality evidence; that review was not opened. | Laboratory study, n = 40. Not a public-health effectiveness grade for Riverside County. | Not found in sources retrieved. Heat cost-effectiveness pages were not opened. | Older adults in the lab study. Seniors-only local sites exclude younger people. East-valley sites in Coachella and Indio were readable. Spanish directory not opened. LGBTQ heat outcomes not found. | 2026 county directory is operating infrastructure. Hours are mostly daytime. User volume not found in an opened source. | Meade et al.; CAP Riverside directory | PMID 37262028; cool-center PDF URL |
| Community health workers / promotoras | U.S. adults with chronic disease in 7 trials; Hispanic share 3%–46.7% across studies. Promotora was a search term. SOGI not measured. Farmworkers not identified in results. | Engagement and social-need help described; clinical effects modest. HIV viral suppression 20% vs 37%, P = .61 in one summarized trial. | Systematic review of small trials. Authors say clinical benefit evidence is limited. | Not found in sources retrieved. | Closest opened source to Hispanic reach, but not Spanish-language or farmworker outcomes. Not LGBTQ-specific. East valley not studied. | Valley CHW program evaluation not found. | Wilder et al. | https://www.cdc.gov/pcd/issues/2026/26_0132.htm |
| CDC compendium methods | Not a reached population. Menu of HIV-prevention evidence standards. | Not an outcome. EBIs are strongest evidence; EIs need more testing. Named MSM or transgender interventions were not opened. | Methods grade definitions only. | Not found in sources retrieved. | Not applicable until a named intervention summary is opened. | Not a local program. | CDC PRS | https://stacks.cdc.gov/view/cdc/149681 |

## Failed cost searches

These searches were run so that a missing dollar figure is a documented gap, not an omitted lookup.

1. PubMed: "tenofovir emtricitabine PrEP cost-effectiveness United States" — API 429. Oral PrEP cost figures used instead come from the opened Juusola PMC article and from drug-cost inputs in the Neilan abstract. A post-generic U.S. ICER for oral F/TDF versus no PrEP was not retrieved.
2. PubMed: "HIV testing cost-effectiveness status-neutral care United States" — API 429. No cost per QALY for HIV testing or status-neutral care was retrieved. USPSTF states that it does not consider costs.
3. PubMed: "syringe services program cost-effectiveness HIV HCV" — API 429. Cost figures used are those printed on the opened CDC HI-5 page, not a new PubMed economic evaluation.
4. PubMed: "LGBTQ affirming mental health intervention systematic review CBT depression sexual minority" — 0 records. ESTEEM trial was opened separately. No cost figure.
5. CDPH ADAP annual report PDF, FY 2023–2024 — open_page failed; http_request failed with SSL certificate verification. California ADAP clients served, medication expenditures, and Riverside County client counts from search snippets are not used.
6. Heat-health cost-effectiveness — web search returned Oxford Open Climate Change and a healthcare-cost meta-analysis. Those pages were not opened. No cost per QALY or program cost is reported for cooling centers.
7. Farmworker or Spanish-speaking community health worker cost — no opened economic evaluation. Wilder and colleagues print no cost-effectiveness ratio in the sections opened.
8. Gender-affirming care cost-effectiveness — no opened cost study.
9. GSA or school anti-bullying cost — no opened cost study.
10. Housing First cost per QALY — not in the opened Jacob abstract. The printed metric is cost per person per year and benefit-to-cost ratio.
11. Cabotegravir full text — Neilan PMC page blocked by reCAPTCHA. Table ICERs from search snippets, including any figure not in the Europe PMC abstract, are not used.
12. Community Guide Housing First findings page and Community Guide MSM behavioral page — open_page failed. Snippet percentages are not used.
13. Krantz and colleagues, PMID 38564182, suicide attempts and GSAs — open_page failed. Suicide risk ratios are not used.
14. Local program budgets for DAP Health, RUHS PrEP, syringe services, and cool centers — not found on the pages that opened.

## Gaps that block a 2026–2036 cost-effectiveness ranking

- No opened source estimates the number of LGBTQIA+ people in the Coachella Valley who would be reached by any option, or separates sexual orientation from gender identity in a valley denominator.
- No opened source gives a Coachella Valley or Riverside County cost per QALY, cost per infection averted, or program budget for PrEP, Ryan White services, syringe services, housing, mental health, gender-affirming care, schools, heat, or community health workers.
- Oral PrEP cost-effectiveness that was opened uses 2010 drug prices except for Neilan's generic annual drug-cost input, which was not paired in the fetched abstract with an ICER versus no PrEP.
- Cabotegravir cost-effectiveness conflicts between a ViiV-funded analysis finding $46,843 per QALY and an independent analysis finding that the price premium must stay under a few thousand dollars per year to meet $100,000 per QALY. This file does not resolve that conflict.
- East-valley delivery is documented for a once-monthly RUHS Indio PrEP clinic and for cool-center addresses in Indio and Coachella. Effectiveness at those sites was not found.
- Spanish-speaking, immigrant, and farmworker intervention effects were not found in opened effectiveness or cost sources.
- Transgender-specific local programs were not opened. Transgender women are included in national PrEP criteria and pooled in some trial estimates.
- Youth suicide outcomes for GSAs were not retrieved after the Krantz page failed.
- Gender-affirming hormone therapy has mental-health associations in a biased evidence base and no opened cost metric, and it is not a suicide-prevention finding.
- Heat interventions have physiologic laboratory evidence and local sites, not an opened mortality or cost-effectiveness result for the valley.
- Comparator-city intervention costs for Los Angeles, San Francisco, San Diego, New York City, Chicago, Atlanta, Miami, Seattle, and the United States were not part of the successfully opened set, except national U.S. models and a New York City syringe-exchange savings summary on the CDC HI-5 page. A Los Angeles PrEP cost-effectiveness snippet was not opened.

## APA 7 references

References are limited to sources opened or fetched in this run. Webpage retrieval date is November 8, 2026.

Baker, K. E., Wilson, L. M., Sharma, R., Dukhanin, V., McArthur, K., & Robinson, K. A. (2021). Hormone therapy, mental health, and quality of life among transgender people: A systematic review. *Journal of the Endocrine Society, 5*(4), Article bvab011. https://doi.org/10.1210/jendso/bvab011

Brogan, A. J., Davis, A. E., Mellott, C. E., Fraysse, J., Metzner, A. A., & Oglesby, A. K. (2024). Cost-effectiveness of cabotegravir long-acting for HIV pre-exposure prophylaxis in the United States. *PharmacoEconomics, 42*(4), 447–461. https://doi.org/10.1007/s40273-023-01342-y

Centers for Disease Control and Prevention. (2022, August 19). *Status neutral HIV care and service delivery: Eliminating stigma and reducing health disparities*. https://stacks.cdc.gov/view/cdc/129024

Centers for Disease Control and Prevention. (2024, February 26). *Access to clean syringes*. https://archive.cdc.gov/www_cdc_gov/policy/hi5/cleansyringes/index.html

Centers for Disease Control and Prevention. (2024, March 20). *Strengthening syringe services programs (SSPs)*. https://www.cdc.gov/hepatitis-syringe-services/php/about/index.html

Centers for Disease Control and Prevention & U.S. Public Health Service. (2021, December). *Preexposure prophylaxis for the prevention of HIV infection in the United States—2021 update: A clinical practice guideline*. https://stacks.cdc.gov/view/cdc/112360

Chou, R., Spencer, H., Bougatsos, C., Blazina, I., Ahmed, A., & Selph, S. (2023). Preexposure prophylaxis for the prevention of HIV: Updated evidence report and systematic review for the US Preventive Services Task Force. *JAMA, 330*(8), 746–763. https://doi.org/10.1001/jama.2023.9865

Community Action Partnership of Riverside County. (2026). *Cool Centers 2026*. https://irp.cdn-website.com/6847619a/files/uploaded/2026+Cool+Center+Directory+English+-+RIV+CO.pdf

DAP Health. (n.d.). *Free PrEP & PEP services*. https://daphealth.org/sexual-and-reproductive-health/prep-and-pep/

Health Resources and Services Administration. (2025, December 17). *New data show over 91% viral suppression rate among Ryan White HIV/AIDS Program patients*. https://www.hrsa.gov/about/news/press-releases/2025-new-data-ryanwhite-hiv

Health Resources and Services Administration. (2026, January). *FY25 Ryan White HIV/AIDS Program Part B grant awards*. https://ryanwhite.hrsa.gov/about/parts-and-initiatives/part-b-adap/fy-2025-grant-awards

HIV Prevention Research Synthesis Project. (2024, April 1). *Compendium of evidence-based interventions and best practices for HIV prevention: Background, methods, and criteria*. Centers for Disease Control and Prevention. https://stacks.cdc.gov/view/cdc/149681

Jacob, V., Chattopadhyay, S. K., Attipoe-Dorcoo, S., Peng, Y., Hahn, R. A., Finnie, R., Cobb, J., Cuellar, A. E., Emmons, K. M., Remington, P. L., & Community Preventive Services Task Force. (2022). Permanent supportive housing with Housing First: Findings from a Community Guide systematic economic review. *American Journal of Preventive Medicine, 62*(3), e188–e201. https://doi.org/10.1016/j.amepre.2021.08.009

Juusola, J. L., Brandeau, M. L., Owens, D. K., & Bendavid, E. (2012). The cost-effectiveness of preexposure prophylaxis for HIV prevention in men who have sex with men in the United States. *Annals of Internal Medicine, 156*(8), 541–550. https://doi.org/10.7326/0003-4819-156-8-201204170-00001

Marx, R. A., et al. (2016). Gay-straight alliances are associated with lower levels of school-based victimization of LGBTQ+ youth: A systematic review and meta-analysis. *Journal of Youth and Adolescence, 45*(7), 1269–1282. https://doi.org/10.1007/s10964-016-0501-7

Meade, R. D., Notley, S. R., Akerman, A. P., McCormick, J. J., King, K. E., Sigal, R. J., & Kenny, G. P. (2023). Efficacy of cooling centers for mitigating physiological strain in older adults during daylong heat exposure: A laboratory-based heat wave simulation. *Environmental Health Perspectives, 131*(6), Article 067003. https://doi.org/10.1289/EHP11651

Neilan, A. M., Landovitz, R. J., Le, M. H., Grinsztejn, B., Freedberg, K. A., McCauley, M., Wattananimitgul, N., Cohen, M. S., Ciaranello, A. L., Clement, M. E., Reddy, K. P., Hyle, E. P., Paltiel, A. D., & Walensky, R. P. (2022). Cost-effectiveness of long-acting injectable HIV preexposure prophylaxis in the United States: A cost-effectiveness analysis. *Annals of Internal Medicine, 175*(4), 479–489. https://doi.org/10.7326/M21-1548

Pachankis, J. E., Harkness, A., Maciejewski, K. R., Behari, K., Clark, K. A., McConocha, E., Winston, R., Adeyinka, O., Reynolds, J., Bränström, R., Esserman, D. A., Hatzenbuehler, M. L., & Safren, S. A. (2022). LGBQ-affirmative cognitive-behavioral therapy for young gay and bisexual men's mental and sexual health: A three-arm randomized controlled trial. *Journal of Consulting and Clinical Psychology, 90*(6), 459–477. https://doi.org/10.1037/ccp0000724

Pepperrell, T., Cross, S., & Hill, A. (2023). Cabotegravir—Global access to long-acting pre-exposure prophylaxis for HIV. *Open Forum Infectious Diseases, 10*(1). https://doi.org/10.1093/ofid/ofac673

Riverside University Health System. (n.d.). *HIV prevention*. https://www.ruhealth.org/hiv-prevention

U.S. Preventive Services Task Force. (2019, June 11). *Human immunodeficiency virus (HIV) infection: Screening*. https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/human-immunodeficiency-virus-hiv-infection-screening

U.S. Preventive Services Task Force. (2023, August 22). *Prevention of acquisition of HIV: Preexposure prophylaxis*. https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/prevention-of-human-immunodeficiency-virus-hiv-infection-pre-exposure-prophylaxis

Wilder, M., Degtyar, A., McKay, J., Mavuri, S., Bolton, M., Richardson, L. D., & Souffront, K. (2026). Community health worker interventions addressing social determinants of health in chronic disease: A systematic review. *Preventing Chronic Disease, 23*, Article 260132. https://doi.org/10.5888/pcd23.260132
