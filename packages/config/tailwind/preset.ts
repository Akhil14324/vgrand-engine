/**
 * Shared Tailwind preset. Token values come from CSS variables defined in the
 * app's globals.css so a single theme system can be reused across apps.
 * (Deliberately untyped — this package must not depend on tailwindcss.)
 */
export const catgptPreset = {
  darkMode: "class" as const,
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        field: "hsl(var(--field))",
        pen: "hsl(var(--pen))",
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        lavd: "hsl(var(--primary-deep))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Hand-drawn corners: slightly uneven, like a pen-drawn box.
        xl: "14px 5px 12px 6px / 6px 12px 5px 14px",
        "2xl": "18px 6px 16px 7px / 7px 16px 6px 18px",
      },
      boxShadow: {
        // Soft, low, downward only: paper lifted off a desk.
        sm: "0 6px 14px -10px rgba(25,21,15,.25)",
        DEFAULT: "0 8px 20px -12px rgba(25,21,15,.28)",
        md: "0 10px 24px -14px rgba(25,21,15,.28)",
        lg: "0 14px 34px -18px rgba(25,21,15,.28)",
        xl: "0 18px 44px -22px rgba(25,21,15,.28)",
        "2xl": "0 22px 50px -26px rgba(25,21,15,.36)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        hand: ["var(--font-hand)", "Segoe Print", "Bradley Hand", "cursive"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        // Dictation equalizer bars — staggered via animation-delay inline.
        wave: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-in-left": "slide-in-left 200ms ease-out",
        "slide-in-right": "slide-in-right 200ms ease-out",
        "slide-in-up": "slide-in-up 220ms ease-out",
        wave: "wave 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
