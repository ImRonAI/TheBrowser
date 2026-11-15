<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: slot-sugar

- **Category:** Layout
- **Curated practice:** Use named slots exactly as the selected layout defines them; inspect nested Markdown and missing/extra slots in the browser.
- **Deep-dive workflow:** [layouts.md](../layouts.md)
- **Canonical documentation:** https://sli.dev/features/slot-sugar.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/slot-sugar.md
description: |
  A syntax sugar for named slots in layouts.
---

# Slot Sugar for Layouts

Some layouts can provide multiple contributing points using [Vue's named slots](https://vuejs.org/guide/components/slots.html).

For example, in [`two-cols` layout](https://github.com/slidevjs/slidev/blob/main/packages/client/layouts/two-cols.vue), you can have two columns left (`default` slot) and right (`right` slot) side by side.

```md
---
layout: two-cols
---

<template v-slot:default>

# Left

This is shown on the left

</template>
<template v-slot:right>

# Right

This is shown on the right

</template>
```

We also provide a shorthand syntactical sugar `::name::` for slot name. The following works exactly the same as the previous example.

```md
---
layout: two-cols
---

# Left

This is shown on the left

::right::

# Right

This is shown on the right
```

You can also explicitly specify the default slot and provide it in the custom order.

```md
---
layout: two-cols
---

::right::

# Right

This shows on the right

::default::

# Left

This is shown on the left
```
