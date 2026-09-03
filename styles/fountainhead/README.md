# Vendored: @fountainhead/design-system v1.29.0

Copied verbatim from `career-counselling/node_modules/@fountainhead/design-system` (css/* +
tailwind/fountainhead-preset.js) on 2026-08-30 (previously v1.18.1 from route-planning,
2026-08-09). v1.29 brings the work-surface layer this app now uses: `.fh-split`
(queue + reading pane, §54) plus the accumulated 1.19–1.29 fixes.

**Why vendored instead of depended on:** the package is a private GitHub-tag dependency that
needs a PAT at install time — the same dep that had nucleus's CI red, and the reason this app
originally shipped with no design system at all. The CSS is static and framework-agnostic, so
carrying it in-repo gives the full Beacon look (tokens, components, dark theme, print layer)
with zero install-time credentials.

**Do not edit these files.** App-side overrides belong in `app/beacon.css` (loaded after, wins
the cascade). To upgrade: copy a newer `css/` + `tailwind/fountainhead-preset.js` over this
directory from any sibling app's node_modules and update the version in this README.
