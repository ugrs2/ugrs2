# CLAUDE.md

This file provides guidance for AI assistants (like Claude) working in this repository.

## Repository Overview

This is the **GitHub profile README repository** for the user `ugrs2`. GitHub treats the repository `ugrs2/ugrs2` as special: its `README.md` is automatically displayed on the user's public GitHub profile page at `https://github.com/ugrs2`.

## Repository Structure

```
ugrs2/ugrs2/
├── README.md    # GitHub profile page content (the only content file)
└── CLAUDE.md   # This file — guidance for AI assistants
```

There is no application code, build system, test suite, or external dependencies. This is a purely content-driven repository.

## Purpose of README.md

The `README.md` is the **entire deliverable** of this repository. It renders as the profile page on GitHub. Changes to it are immediately visible on the profile after pushing to the default branch (`master`).

GitHub renders the file as standard Markdown with GitHub Flavored Markdown (GFM) extensions. Common features used in profile READMEs include:

- Markdown headings, lists, and links
- Inline HTML (GitHub allows a limited subset)
- Images and badges (e.g., shields.io badges for tech stacks)
- GitHub stats widgets (third-party services embedded as `<img>` tags)
- Emojis via `:emoji_name:` syntax or Unicode

## Development Workflow

### Editing the Profile README

1. Edit `README.md` directly — it is the only content file.
2. Commit with a clear message describing what changed (e.g., `Update README: add skills section`).
3. Push to the `master` branch. The profile page updates immediately.

### Branching

- Default/production branch: `master`
- Feature work can be done on separate branches and merged via pull request.
- The profile only reflects the content on the **default branch** (`master`).

### No Build or Test Steps

There are no build commands, test suites, linters, or CI/CD pipelines. Changes are purely content edits to Markdown.

## Conventions

- **File encoding:** UTF-8
- **Line endings:** LF (Unix-style)
- **Markdown style:** GitHub Flavored Markdown (GFM)
- Keep the README concise and professional — it is a public-facing profile.
- Prefer real content over placeholder template text (the current README still has unfilled template prompts like `I'm interested in ...`).

## Key Notes for AI Assistants

- The only file that matters for the user's GitHub profile is `README.md`.
- Do not create application scaffolding, source directories, or config files unless explicitly requested — this is not a software project.
- When asked to improve or update the profile, edit `README.md` only.
- Commit and push to `master` to make changes live on the profile.
- This repository has no test or build step to verify before pushing.
