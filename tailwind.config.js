/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './templates/**/*.html',
    './static/**/*.js',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "var(--border-color)",
        input: "var(--input-bg)",
        ring: "var(--link-color)",
        background: "var(--body-bg)",
        foreground: "var(--text-color)",
        primary: {
          DEFAULT: "var(--link-color)",
          foreground: "var(--text-color)",
        },
        secondary: {
          DEFAULT: "var(--text-secondary)",
          foreground: "var(--text-color)",
        },
        card: {
          DEFAULT: "var(--card-bg)",
          foreground: "var(--text-color)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "var(--card-shadow)",
        "card-hover": "var(--card-hover-shadow)",
      },
    },
  },
  plugins: [],
}
