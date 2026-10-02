import type { Config } from "tailwindcss";

// Brand colours from the project brief, plus neutral surfaces for an enterprise UI.
// When the Stitch export arrives, its tokens replace/extend these in one place.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nexvra: {
          lime: "#9CFF00",
          black: "#000000",
          white: "#FFFFFF",
          gray: "#A0A0A0",
        },
        surface: "#F5F6F8",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
