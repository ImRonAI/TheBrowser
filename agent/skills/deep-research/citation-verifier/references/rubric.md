# Citation Verifier Rubric

## Citation Defect Taxonomy
- **Verified**: Source resolves cleanly and explicitly supports the exact claim, scope, and number attributed.
- **Scope Overreach**: Source proves X in a narrow subset, while the ledger generalizes X universally — must narrow the claim.
- **Misattributed / Hallucinated**: Source does not contain the attributed claim or URL fails — must quarantine immediately and either replace via `gap-targeted-search` or flag as a critical gap.
- **Access-Restricted**: Paywalled or gated source — may only cite publicly verifiable metadata/abstract, never unverified body claims.

