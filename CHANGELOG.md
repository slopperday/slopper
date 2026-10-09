# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.1.0 (2026-10-09)

### Features

- **Release with monochange.** Changesets in `.changeset/` record every change worth releasing. User types (`user_feat`, `user_fix`, `user_change`) become the release notes on `/changelog`, read from `app/changelog/<version>.json`; every other type lands in `CHANGELOG.md`. `vp exec monochange run release` bumps `package.json`, writes both and commits on `main`; `vp exec monochange run publish` tags the release, pushes `main` with the tag, and waits until Deno Deploy serves it on slopper.day.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 8a6d374
