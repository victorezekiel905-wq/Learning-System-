import type { Config } from "tailwindcss";

// SwiftCipher design system: warm "paper and ink" neutrals, cobalt for action,
// electric lime as the signature highlight. Brand and accent are themeable per
// school (src/lib/theme.ts); defaults live in globals.css.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // <Button variant> builds "btn-${variant}", which the content scan cannot see.
  safelist: ["btn-primary", "btn-secondary", "btn-ghost", "btn-danger", "btn-accent", "btn-ink"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)"
        },
        accent: {
          50: "rgb(var(--accent-50) / <alpha-value>)",
          100: "rgb(var(--accent-100) / <alpha-value>)",
          200: "rgb(var(--accent-200) / <alpha-value>)",
          300: "rgb(var(--accent-300) / <alpha-value>)",
          400: "rgb(var(--accent-400) / <alpha-value>)",
          500: "rgb(var(--accent-500) / <alpha-value>)",
          600: "rgb(var(--accent-600) / <alpha-value>)",
          700: "rgb(var(--accent-700) / <alpha-value>)",
          800: "rgb(var(--accent-800) / <alpha-value>)",
          900: "rgb(var(--accent-900) / <alpha-value>)",
          // readable text colour on accent backgrounds (ink or white, computed per school)
          ink: "rgb(var(--accent-ink) / <alpha-value>)"
        },
        // Warm neutrals: paper background, ink text. Every text shade from 500 up
        // meets WCAG AA on both white and paper.
        ink: {
          50: "#F6F5F1", 100: "#EEECE6", 200: "#E3E0D8", 300: "#CCC8BE", 400: "#A29D91",
          500: "#6B675E", 600: "#54514A", 700: "#3D3B36", 800: "#27261F", 900: "#151411", 950: "#0B0B09"
        }
      },
      fontFamily: {
        // Body text: Inter. Headings: Plus Jakarta Sans (loaded with next/font in app/layout.tsx).
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-jakarta)", "'Plus Jakarta Sans'", "var(--font-inter)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      letterSpacing: { tightest: "-0.035em" },
      boxShadow: {
        // Only overlays float; the page itself is flat with hairlines.
        overlay: "0 1px 2px rgb(21 20 17 / 0.06), 0 12px 32px -8px rgb(21 20 17 / 0.18)",
        lift: "0 1px 0 rgb(21 20 17 / 0.04), 0 1px 3px rgb(21 20 17 / 0.06)"
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "sheet-up": { from: { transform: "translateY(16px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".45" } }
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "sheet-up": "sheet-up .22s cubic-bezier(.2,.8,.2,1)",
        pulse2: "pulse2 1.6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
