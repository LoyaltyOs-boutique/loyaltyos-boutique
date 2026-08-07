/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: "#C5A880",
        "gold-soft": "#E9DFCF",
        charcoal: "#111111",
        ink: "#111111",
        paper: "#FFFFFF",
        steel: "#6B6B6B",
        line: "#E5E5E5",
        mist: "#FAFAFA"
      },
      fontFamily: {
        serif: ["Playfair Display", "serif"],
        sans: ["Montserrat", "sans-serif"]
      },
      letterSpacing: {
        luxe: "0.18em",
        wide2: "0.12em"
      },
      boxShadow: {
        card: "0 1px 2px rgba(17,17,17,.05), 0 8px 24px rgba(17,17,17,.05)"
      }
    }
  },
  plugins: []
}