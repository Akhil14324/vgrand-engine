import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Splash } from "@/components/splash";
import { PwaRegister } from "@/components/pwa";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
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
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#17161c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans`}>
        <Providers>
          {children}
          <Splash />
          <PwaRegister />
        </Providers>
      </body>
    </html>
  );
}
