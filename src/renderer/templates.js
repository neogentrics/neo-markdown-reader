// Starting points for File > New from Template.
const today = () => new Date().toISOString().slice(0, 10);

export const TEMPLATES = {
  blank: { name: 'Untitled', content: () => '' },

  meeting: {
    name: 'Meeting Notes',
    content: () => `---
title: Meeting notes
date: ${today()}
tags: [meeting]
---

# Meeting notes

**Attendees:**
**Where:**

## Agenda

1.
2.
3.

## Discussion

-

## Decisions

> [!IMPORTANT]
>

## Action items

- [ ] Task — *owner* — due date
- [ ]
`,
  },

  readme: {
    name: 'README',
    content: () => `# Project name

One or two sentences about what this project does and who it's for.

## Features

- Feature one
- Feature two

## Getting started

\`\`\`bash
# install
# run
\`\`\`

## Usage

Explain the most common way to use it.

## License

© ${new Date().getFullYear()} — all rights reserved.
`,
  },

  checklist: {
    name: 'Checklist',
    content: () => `# Checklist

> [!TIP]
> Tick a box by changing \`[ ]\` to \`[x]\`.

## To do

- [ ] First thing
- [ ] Second thing
- [ ] Third thing

## Done

- [x] Made a checklist
`,
  },

  report: {
    name: 'Report',
    content: () => `---
title: Report title
subtitle: A one-line summary of what this report covers
author: Neo Gentrics
date: ${today()}
tags: [report]
---

# Summary

Three or four sentences with the key findings and what you recommend.

| Measure | Value | Change |
| --- | ---: | ---: |
| Example | 1,234 | +12% |

## Background

Why this report exists and what question it answers.

## Findings

### Finding one

Details…

### Finding two

Details…

## Recommendations

1.
2.

## Appendix

Supporting detail, sources and notes.
`,
  },
};
