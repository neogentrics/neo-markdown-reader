# Contributing

Thanks for your interest in Neo Markdown Reader!

This is **proprietary software** (see [LICENSE](LICENSE)). The source is public for transparency, but
**code contributions are by invitation only**. Please don't open pull requests unless you've been
asked to.

You are very welcome to:

- **Report bugs.** Open an issue using the *Bug report* template. Include the Markdown that renders
  incorrectly and a screenshot if you can.
- **Suggest features.** Use the *Feature request* template.
- **Report security issues** privately, as described in [SECURITY.md](SECURITY.md).

By submitting an issue, suggestion or other feedback you agree to the terms in Section 5 of the
[LICENSE](LICENSE).

## For invited collaborators

```bash
npm ci
npm run dev     # launch with the showcase document
npm test        # must pass before you open a PR
```

- Keep the renderer free of Node/Electron APIs. Everything OS-related goes through `preload.js` → `main.js`.
- Any new HTML that reaches the page must go through the DOMPurify step in `src/renderer/markdown.js`.
- Check visual changes in all three themes and in **Export as PDF**.
