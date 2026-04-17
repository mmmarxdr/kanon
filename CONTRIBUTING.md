# Contributing to Kanon

Thanks for your interest in contributing. Kanon is early-stage, which means
contributions have outsized impact — but also that the moving parts change
quickly. Read this document before opening a PR.

## Before you start

- **Open an issue first.** Describe the problem and the proposed solution.
  This avoids duplicated work and lets us align on direction before you
  invest time.
- **Check the roadmap.** Some areas are actively being reworked; a PR
  against them may land on outdated code.

## Setup

See the main [README](README.md) for install and
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for commands and testing.

## Workflow

1. Fork the repo (external contributors) or branch from `main`.
2. Make your changes with tests covering new behavior.
3. Run `pnpm test:all` locally. All tests must pass.
4. Follow the existing code style — no bespoke formatting.
5. Open a PR with a clear description of the change and the issue it
   closes (e.g. "Closes #42").

## Commit style

We use Conventional Commits:

```
feat(api): add issue dependency endpoints
fix(web): prevent duplicate card on drag-drop
test(mcp): cover transition error paths
docs(readme): clarify quick start requirements
```

## What gets merged

- Bug fixes with tests.
- Small, focused features that align with the roadmap.
- Documentation improvements.
- Performance wins with benchmarks.

## What probably won't get merged (without discussion)

- Large refactors without prior agreement.
- Feature additions not tracked in an issue.
- Style-only changes to code that already passes the linter.

## License

By contributing, you agree that your contributions will be licensed under
the [Apache License 2.0](LICENSE).
