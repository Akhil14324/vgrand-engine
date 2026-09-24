import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import { catgptPreset } from "@catgpt/config/tailwind/preset";

export default {
  presets: [catgptPreset],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  plugins: [typography],
} satisfies Config;
