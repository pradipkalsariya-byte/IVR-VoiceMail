import localFont from 'next/font/local';

// SELF-HOSTED, not fetched from Google while the build runs.
//
// `next/font/google` self-hosts at RUNTIME — the browser never calls Google — but it downloads the
// font during `next build`, so every deploy depended on fonts.gstatic.com answering. That killed a
// Railway build on 14-Aug-2026 with nothing wrong with the app.
//
// VENDORED HERE RATHER THAN READ FROM THE DESIGN SYSTEM PACKAGE, because this app has no dependency
// on it — front-desk vendors the DS CSS into styles/fountainhead/ instead (repo CLAUDE.md). Every
// other app points at @fountainhead/design-system/assets/fonts; this one carries its own copy of
// the same file until it moves onto the package, which is the preferred fix and a separate job.
//
// ONE VARIABLE FILE replaces the five static weights. SIL OFL 1.1 — licence beside it.
export const plusJakarta = localFont({
  src: './fonts/PlusJakartaSans-Variable.woff2',
  weight: '200 800',
  style: 'normal',
  variable: '--font-plus-jakarta',
  display: 'swap',
});
