import type { Config } from "tailwindcss";

/** Token HSL com suporte a modificador de opacidade (bg-primary/10). */
const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Bricolage Grotesque", "Inter", "sans-serif"],
      },
      colors: {
        border: hsl("--border"),
        input: hsl("--input"),
        ring: hsl("--ring"),
        background: hsl("--background"),
        foreground: hsl("--foreground"),

        primary: {
          DEFAULT: hsl("--primary"),
          foreground: hsl("--primary-foreground"),
        },
        secondary: {
          DEFAULT: hsl("--secondary"),
          foreground: hsl("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: hsl("--destructive"),
          foreground: hsl("--destructive-foreground"),
        },
        muted: {
          DEFAULT: hsl("--muted"),
          foreground: hsl("--muted-foreground"),
        },
        accent: {
          DEFAULT: hsl("--accent"),
          foreground: hsl("--accent-foreground"),
        },
        popover: {
          DEFAULT: hsl("--popover"),
          foreground: hsl("--popover-foreground"),
        },
        card: {
          DEFAULT: hsl("--card"),
          foreground: hsl("--card-foreground"),
        },

        success: {
          DEFAULT: hsl("--success"),
          foreground: hsl("--success-foreground"),
        },
        warning: {
          DEFAULT: hsl("--warning"),
          foreground: hsl("--warning-foreground"),
        },
        /** Dinheiro — sempre em destaque quando > 0 */
        money: hsl("--money"),

        /** Status do pedido — cor viva: fundos suaves, faixas e preenchimentos */
        status: {
          novo: hsl("--status-novo"),
          separacao: hsl("--status-separacao"),
          rua: hsl("--status-rua"),
          entregue: hsl("--status-entregue"),
          cancelado: hsl("--status-cancelado"),
        },
        /** Variante escura — usar SEMPRE que a cor virar texto ou ícone (WCAG AA) */
        "status-ink": {
          novo: hsl("--status-novo-ink"),
          separacao: hsl("--status-separacao-ink"),
          rua: hsl("--status-rua-ink"),
          entregue: hsl("--status-entregue-ink"),
          cancelado: hsl("--status-cancelado-ink"),
        },

        sidebar: {
          DEFAULT: hsl("--sidebar-background"),
          foreground: hsl("--sidebar-foreground"),
          primary: hsl("--sidebar-primary"),
          "primary-foreground": hsl("--sidebar-primary-foreground"),
          accent: hsl("--sidebar-accent"),
          "accent-foreground": hsl("--sidebar-accent-foreground"),
          border: hsl("--sidebar-border"),
          ring: hsl("--sidebar-ring"),
        },

        /* Aliases legados mantidos para não quebrar telas ainda não migradas */
        surface: hsl("--background"),
        silver: hsl("--border"),
        medical: {
          DEFAULT: hsl("--primary"),
          foreground: hsl("--primary-foreground"),
        },
        "slate-deep": hsl("--foreground"),
        "slate-muted": hsl("--muted-foreground"),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
