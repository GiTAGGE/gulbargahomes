import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./content/**/*.{mdx,md}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7f4",
          100: "#dceee4",
          200: "#b8dcc9",
          300: "#86c2a6",
          400: "#549e7e",
          500: "#2f7d62",
          600: "#1f6550",
          700: "#1a5142",
          800: "#163f35",
          900: "#0f2a24",
        },
        surface: {
          DEFAULT: "#f6f3ec",
          card: "#ffffff",
          muted: "#ebe6dc",
        },
        ink: {
          DEFAULT: "#1a1f1c",
          muted: "#4a5550",
          faint: "#8a948e",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 4px 24px -4px rgba(15, 42, 36, 0.10)",
        lift: "0 16px 44px -10px rgba(15, 42, 36, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
