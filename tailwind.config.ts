import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Phone-width gate. The smallest viewport we design the app header for is
      // 360px (Android baseline); below that the header row has no slack left,
      // so `xs:` marks the point where an element may take its larger scale.
      // Additive — sm/md/lg keep their Tailwind defaults.
      screens: {
        xs: "360px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Brand / Logo palette (PureProperty.ca logo spec). `pp.accent`
        // (cyan) is reserved for live/active UI states, never the logo.
        pp: {
          bg: "#0A1828",
          "bg-elevated": "var(--pp-bg-elevated)",
          "bg-input": "var(--pp-bg-input)",
          "bg-hover": "var(--pp-bg-hover)",
          "bg-selected": "var(--pp-bg-selected)",
          primary: "#FFFFFF",
          secondary: "#8FA4B8",
          tertiary: "#6B7E92",
          disabled: "var(--pp-text-disabled)",
          accent: "#1DD3E0",
          "accent-dim": "var(--pp-accent-dim)",
          "accent-bg": "var(--pp-accent-bg)",
          // Border tokens (use as border-pp-border / border-pp-border-strong)
          border: "var(--pp-border-default)",
          "border-subtle": "var(--pp-border-subtle)",
          "border-strong": "var(--pp-border-strong)",
          // Semantic
          success: "var(--pp-success)",
          "success-bg": "var(--pp-success-bg)",
          danger: "var(--pp-danger)",
          "danger-bg": "var(--pp-danger-bg)",
          warning: "var(--pp-warning)",
          "warning-bg": "var(--pp-warning-bg)",
          info: "var(--pp-info)",
          "info-bg": "var(--pp-info-bg)",
          // Data-viz
          "data-1": "var(--pp-data-1)",
          "data-2": "var(--pp-data-2)",
          "data-3": "var(--pp-data-3)",
          "data-4": "var(--pp-data-4)",
          "data-5": "var(--pp-data-5)",
          "data-6": "var(--pp-data-6)",
          "data-7": "var(--pp-data-7)",
          "data-8": "var(--pp-data-8)",
          // On-light variants (PDF/email)
          "primary-light": "#0A1828",
          "secondary-light": "#4A6378",
          "tertiary-light": "#6B7E92",
        },
      },
      // Namespaced type scale (design-system spec). Does NOT override the
      // default text-* utilities — opt in via text-pp-base, text-pp-lg, etc.
      fontSize: {
        "pp-xs": ["var(--pp-text-xs)", { lineHeight: "1.4" }],
        "pp-sm": ["var(--pp-text-sm)", { lineHeight: "1.5" }],
        "pp-base": ["var(--pp-text-base)", { lineHeight: "1.5" }],
        "pp-md": ["var(--pp-text-md)", { lineHeight: "1.6" }],
        "pp-lg": ["var(--pp-text-lg)", { lineHeight: "1.4", fontWeight: "700" }],
        "pp-xl": ["var(--pp-text-xl)", { lineHeight: "1.3", fontWeight: "700" }],
        "pp-2xl": ["var(--pp-text-2xl)", { lineHeight: "1.2", fontWeight: "700" }],
        "pp-3xl": ["var(--pp-text-3xl)", { lineHeight: "1.1", fontWeight: "700" }],
        "pp-display": ["var(--pp-text-display)", { lineHeight: "1.05", fontWeight: "700" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Opt-in design-system radii (rounded-pp). Sharp --radius:0 is untouched.
        pp: "var(--pp-radius)",
        "pp-sm": "4px",
        "pp-lg": "8px",
      },
    },
  },
  plugins: [],
};
export default config;
