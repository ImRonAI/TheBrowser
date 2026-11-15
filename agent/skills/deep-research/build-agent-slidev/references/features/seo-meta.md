<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: seo-meta

- **Category:** Delivery
- **Curated practice:** Set accurate title, description, canonical URL, and social image; remove private speaker notes from a public build separately.
- **Deep-dive workflow:** [hosting.md](../hosting.md)
- **Canonical documentation:** https://sli.dev/features/seo-meta.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/seo-meta.md
description: >
  Configure SEO meta tags for better social media sharing and search engine
  optimization.
---

# SEO Meta Tags

Slidev allows you to configure SEO meta tags in the headmatter to improve social media sharing and search engine optimization. You can set up Open Graph and Twitter Card meta tags to control how your slides appear when shared on social platforms.

## Configuration

Add the `seoMeta` configuration to your slides deck frontmatter:

```yaml
---
# SEO meta tags
seoMeta:
  ogTitle: Slidev Starter Template
  ogDescription: Presentation slides for developers
  ogImage: https://cover.sli.dev
  ogUrl: https://example.com
  twitterCard: summary_large_image
  twitterTitle: Slidev Starter Template
  twitterDescription: Presentation slides for developers
  twitterImage: https://cover.sli.dev
  twitterSite: username
  twitterUrl: https://example.com
---
```

This feature is powered by [unhead](https://unhead.unjs.io/)'s `useHead` hook, please refer to the [documentation](https://unhead.unjs.io/docs/head/api/composables/use-seo-meta) for more details.
