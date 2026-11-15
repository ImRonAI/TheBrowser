# Slidev Deckcraft & Research Presentation Rubric

## 1. Narrative & Density Discipline
- **One Idea Per Slide**: Every slide earns its place with one unmistakable headline claim supported by concrete numbers, a compact comparison table, or a structured breakdown.
- **Word Budget**: Keep body slides under ~45–65 words (excluding compact table cells or code blocks). Move extended context into HTML speaker comment blocks (`<!-- ... -->`) if helpful.
- **Recommended 7–10 Slide Arc**:
  1. **Cover Slide**: Crisp title, 1-line thesis subtitle, date/depth badge (`routerMode: hash` in YAML frontmatter).
  2. **Executive Answer**: The single highest-leverage finding and headline quantitative metrics.
  3. **Core Findings (2–3 slides)**: Evidence-backed pillars, architectural patterns, or empirical benchmarks.
  4. **Quantitative Comparison**: Clean Markdown table contrasting options, benchmarks, or studies.
  5. **Risks, Limitations & Counterevidence**: Honest boundary conditions surfaced by the adversarial & verification swarms.
  6. **Actionable Synthesis & Sources**: Concrete decision guidance + primary `[Title](URL)` citations.

## 2. Technical Slidev Requirements
- Always set `routerMode: hash` in frontmatter:
  ```yaml
  ---
  theme: default
  title: "<Deck Title>"
  routerMode: hash
  aspectRatio: 16/9
  ---
  ```
- Separate slides strictly with `\n---\n` on its own line surrounded by blank lines.
- Materialize via `compile_slidev_deck(slides_markdown=..., title=...)` so `slides.md`, `slides/index.html` (`--base ./`), and `slides.pdf` are all verified on disk.
