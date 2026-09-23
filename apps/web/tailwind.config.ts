import type { Config } from "tailwindcss";
import { prompthubPreset } from "@prompthub/config/tailwind/preset";

export default {
  presets: [prompthubPreset],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
} satisfies Config;
