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
          50: "#f8f4f0",
          100: "#eee4d8",
          200: "#ddc9b0",
          300: "#c7a57e",
          400: "#b38658",
          500: "#9a6a3d",
          600: "#825732",
          700: "#68452a",
          800: "#4a3222",
          900: "#2a1d16",
        },
        surface: {
          DEFAULT: "#f7f3ee",
          card: "#ffffff",
          muted: "#efe8df",
        },
        ink: {
          DEFAULT: "#1c1917",
          muted: "#57534e",
          faint: "#a8a29e",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 4px 24px -4px rgba(42, 29, 22, 0.10)",
        lift: "0 16px 44px -10px rgba(42, 29, 22, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
