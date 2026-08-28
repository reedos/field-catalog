/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#161410",
        charcoal: "#241f1a",
        bark: "#3a3228",
        paper: "#efe6d6",
        "paper-dim": "#d9cdb8",
        moss: "#6a7a52",
        "moss-dark": "#4e5c3c",
        ochre: "#c4a36a",
        reject: "#a65d4a",
      },
      fontFamily: {
        serif: ['"Iowan Old Style"', "Palatino Linotype", "Palatino", "Georgia", "serif"],
        sans: ["Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
