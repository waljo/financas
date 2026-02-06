import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#14213D",
        sand: "#F8F5F0",
        mint: "#BDE0C4",
        coral: "#E76F51",
        pine: "#2A9D8F"
      }
    }
  },
  plugins: []
};

export default config;
