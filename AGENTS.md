# Agent Guide

Routing layer, not complete documentation.

Start here: read `docs/agent/INDEX.md` and load only task-relevant documents.

Development: use the repository's existing build/test/lint commands —
discover them from project config, never invent them.

Knowledge: durable knowledge belongs in canonical project docs.
Chat history and provider memory are not sources of truth.

Verification: before declaring substantial work complete, run the relevant
verification workflow. Safety: preserve configs and secrets; no destructive
production actions without explicit authorization.

## Local PDF analysis

When a task needs a local PDF, verify that the source exists and preserve it.
Use PDF Inspector first:

```bash
/Users/massimilianociconte/.cargo/bin/detect-pdf "$PDF" --analyze --json
/Users/massimilianociconte/.cargo/bin/pdf2md "$PDF" --compact --pages > "$OUTPUT_MD"
```

Use `--select-pages` when only selected pages matter. Read the generated
Markdown and keep its `<!-- Page N -->` markers for citations. Put temporary
derivatives in `/tmp` or `.cache/ai/pdf/`. If classification indicates image
pages, OCR requirements, or unreliable extraction, use the configured OCR
workflow for those pages, and inspect visual pages when layout or figures
matter. Do not interpret empty extracted text as absent content.

## Skills and harness

The active skill registry is `~/skills-source/SKILLS-REGISTRY.md`; skills are
available under `~/.agents/skills`. Use matching skills without asking for
permission to read them. Before substantial work use `context-router`; before
claiming completion run `verify-change`. The canonical harness root is
`~/.ai-harness` and its global instructions are in
`~/.ai-harness/core/GLOBAL-INSTRUCTIONS.md`. For a new repository run
`~/.ai-harness/bin/bootstrap` after a dry run.
