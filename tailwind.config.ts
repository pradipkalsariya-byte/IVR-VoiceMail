import type { Config } from 'tailwindcss';
import fountainhead from './styles/fountainhead/fountainhead-preset';

// The Fountainhead DS preset (vendored — see styles/fountainhead/README.md) maps Tailwind's
// color/font/radius/shadow utilities onto the DS CSS variables, so `bg-surface`,
// `text-muted`, `border-border` etc. follow the active theme (light/dark) automatically.
export default {
  presets: [fountainhead],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Beacon: one UI face everywhere. Overrides the preset's default mapping so Tailwind's
      // font-heading/font-body utilities resolve to the next/font-loaded Plus Jakarta Sans
      // (see app/fonts.ts + app/beacon.css).
      fontFamily: {
        heading: ['var(--font-plus-jakarta)', 'system-ui', 'sans-serif'],
        body: ['var(--font-plus-jakarta)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
