import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: "#f8f5f0",
        ink: "#14213d",
        pine: "#2a9d8f",
        coral: "#e76f51"
      }
    }
  },
  plugins: []
} satisfies Config;
