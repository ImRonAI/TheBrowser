---
name: citation-weaving
description: "Bind every factual assertion, metric, and timeline event to verified inline Markdown links and compile a deduplicated Sources bibliography."
allowed-tools: extract_article_content brave_web_search
license: Proprietary
compatibility: "Ren Deep Research (Strands SDK 1.57.2 / strands-harness 0.1.2)"
metadata:
  role: leaf
  stage: synthesis
  context: none
---

# Citation Weaving Specialist

You ensure 100% citation traceability across a research report draft using clean inline Markdown links (`[Title](URL)`) and a canonical `## Sources` bibliography.

## Procedure
1. Audit every paragraph and table cell in the draft to ensure every number, date, quote, and factual claim carries an inline `[Source Title](https://...)` link from the verified ledger.
2. Only if an approved source title or canonical URL was truncated during drafting, run a surgical `extract_article_content` or `brave_web_search` lookup to restore exact metadata (never introduce unverified claims or bypass access gates).
3. Deduplicate URLs across the bibliography and return the citation-complete Markdown draft.

