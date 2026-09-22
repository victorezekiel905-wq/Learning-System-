import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef5ff", 100: "#d9e8ff", 200: "#bcd6ff", 300: "#8ebcff",
          400: "#5a99ff", 500: "#2f78f6", 600: "#1d5ddb", 700: "#1a4bb0",
          800: "#1a4090", 900: "#1a3878"
        }
      },
      fontFamily: { sans: ["ui-sans-serif", "system-ui", "Inter", "sans-serif"] }
    }
  },
  plugins: []
};
export default config;
