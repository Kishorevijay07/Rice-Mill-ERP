import type { Config } from "tailwindcss";

// Foundation Tailwind config. shadcn/ui design tokens (CSS variables) are wired
// via globals.css and can be extended here as components are added in later stages.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "rm-fade": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
        "rm-slide": {
          "0%": { transform: "translateX(-140%)" },
          "100%": { transform: "translateX(260%)" },
        },
      },
      animation: {
        "rm-fade": "rm-fade 0.45s ease",
        "rm-slide": "rm-slide 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
