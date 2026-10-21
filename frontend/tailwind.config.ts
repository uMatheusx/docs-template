import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import { fontFamily } from "tailwindcss/defaultTheme";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1480px" } },
    extend: {
      fontFamily: {
        // famílias em variáveis CSS (index.css) — trocadas pela pré-visualização de tipografia
        sans: ["var(--font-body)", ...fontFamily.sans],
        display: ["var(--font-display)", ...fontFamily.sans],
        mono: ["var(--font-mono)", ...fontFamily.mono],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        sidebar: "hsl(var(--sidebar))",
        // Paleta de marca (laranja + azul-marinho + amarelo de apoio)
        brand: {
          DEFAULT: "hsl(var(--brand))",
          ink: "hsl(var(--brand-ink))",
          soft: "hsl(var(--brand-soft))",
          50: "#FFF4EA",
          100: "#FFE3C7",
          200: "#FFC48A",
          300: "#FFA24D",
          400: "#FF8A1F",
          500: "#EC7000",
          600: "#C75C00",
          700: "#9E4700",
        },
        navy: {
          DEFAULT: "hsl(var(--navy))",
          50: "#EEF3FF",
          100: "#D9E3FF",
          300: "#7E9BE6",
          500: "#1F4FC2",
          600: "#003399",
          700: "#002673",
          800: "#0B1A45",
          900: "#071030",
          950: "#040A1D",
        },
        sun: "#FFC20E",
      },
      borderRadius: {
        // escala mais enxuta: 3xl (cartões grandes) 12px, 2xl 10px
        "3xl": "0.75rem",
        "2xl": "0.625rem",
        xl: "calc(var(--radius) + 2px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        glow: "0 0 0 1px hsl(var(--border)), 0 6px 20px -10px rgb(0 0 0 / 0.18)",
        float: "0 0 0 0.5px rgb(0 0 0 / 0.05), 0 10px 30px -12px rgb(0 0 0 / 0.2)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-collapsible-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-collapsible-content-height)" }, to: { height: "0" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        aurora: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(4%, -6%, 0) scale(1.08)" },
        },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 currentColor" },
          "70%": { boxShadow: "0 0 0 6px transparent" },
          "100%": { boxShadow: "0 0 0 0 transparent" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-up": "fade-up 0.45s cubic-bezier(.2,.7,.2,1) both",
        aurora: "aurora 14s ease-in-out infinite",
        shimmer: "shimmer 6s linear infinite",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
