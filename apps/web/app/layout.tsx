import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { PwaRegister } from "@/components/pwa";
import { Petals } from "@/components/petals";
import { AutoSketch } from "@/components/auto-sketch";

// Self-hosted (latin, variable weight) so the build never fetches Google Fonts.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sans",
  display: "swap",
});

const fraunces = localFont({
  src: "./fonts/fraunces-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-display",
  display: "swap",
});

const caveat = localFont({
  src: "./fonts/caveat-latin-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-hand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CatGPT — AI Chat & Image Studio",
  description:
    "Chat with AI, plan sales campaigns, and create on-brand images — installable on your phone or desktop.",
  applicationName: "CatGPT",
  appleWebApp: {
    capable: true,
    title: "CatGPT",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EC" },
    { media: "(prefers-color-scheme: dark)", color: "#151718" },
  ],
};

/**
 * Runs before first paint so there is no light/dark flash: a saved choice
 * wins, otherwise follow the OS setting.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("catgpt-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body
        className={`${inter.variable} ${fraunces.variable} ${caveat.variable} font-sans`}
      >
        <Petals />
        <Providers>
          {children}
          <PwaRegister />
          <AutoSketch />
        </Providers>
      </body>
    </html>
  );
}
