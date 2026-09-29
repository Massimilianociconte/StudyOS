import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Su tablet e telefoni (touch) gli stati hover non restano "appiccicati" dopo un tap.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      },
      borderRadius: {
        squircle: "34px",
        "squircle-sm": "24px",
        super: "42%"
      },
      boxShadow: {
        soft: "0 24px 80px rgba(0, 0, 0, 0.22)",
        lift: "0 18px 48px rgba(0, 0, 0, 0.18)"
      }
    }
  },
  plugins: [
    // `can-hover:` = dispositivi con mouse/trackpad. Serve per nascondere azioni secondarie
    // fino al passaggio del mouse SOLO dove il passaggio esiste: su tablet restano visibili.
    plugin(({ addVariant }) => addVariant("can-hover", "@media (hover: hover) and (pointer: fine)"))
  ]
};
