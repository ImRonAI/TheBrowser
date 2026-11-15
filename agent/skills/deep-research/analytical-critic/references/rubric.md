# Analytical Critic Gate Rubric

## When to Emit `[NEEDS_REFINEMENT]`
Emit `[NEEDS_REFINEMENT]` **only** if ALL of the following hold:
1. At least one core sub-question from the user's prompt has a material, decision-changing evidence gap or broken primary citation.
2. Publicly accessible evidence is reasonably likely to exist under specific, untried search angles.
3. You provide 2-5 concrete, ready-to-run gap queries and target source domains.

## When to Emit `[VERIFICATION_PASSED]`
Emit `[VERIFICATION_PASSED]` when:
- All core sub-questions have corroborated evidence with verified URLs, **and**
- Contested areas or public-data ceilings are transparently documented with confidence bounds so synthesis can state them honestly.
Never emit both tokens in the same output.

