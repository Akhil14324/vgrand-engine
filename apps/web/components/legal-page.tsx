import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_LAST_UPDATED = "September 25, 2026";

/** Public contact address; override with NEXT_PUBLIC_CONTACT_EMAIL in the web environment. */
export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL || "vgrandlounge@gmail.com";

export function ContactLine() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-2">
      {CONTACT_EMAIL}
    </a>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/catgpt-logo.png"
              alt="CatGPT"
              className="h-9 w-auto rounded-lg bg-white object-contain px-1.5 py-0.5"
            />
          </Link>
          <nav className="flex gap-4 text-xs text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/data-deletion" className="hover:text-foreground">
              Data deletion
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated: {LEGAL_LAST_UPDATED}</p>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{intro}</p>
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} CatGPT ·{" "}
        <Link href="/terms" className="hover:text-foreground">
          Terms of Service
        </Link>{" "}
        ·{" "}
        <Link href="/privacy" className="hover:text-foreground">
          Privacy Policy
        </Link>{" "}
        ·{" "}
        <Link href="/data-deletion" className="hover:text-foreground">
          Data Deletion
        </Link>
      </footer>
    </div>
  );
}
