import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, Image as ImageIcon, Megaphone, MessageSquare } from "lucide-react";

const EMBER_COLORS = ["#ff5a2e", "#ff8c42", "#ffc46b"];
/** Deterministic ember field — rising sparks beside the mascot. */
const EMBERS = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 53 + 7) % 96}%`,
  size: 2 + ((i * 7) % 3),
  duration: 5 + ((i * 37) % 50) / 10,
  delay: ((i * 61) % 90) / 10,
  drift: ((i * 29) % 90) - 45,
  color: EMBER_COLORS[i % EMBER_COLORS.length],
}));

/**
 * Public landing page — shown at "/" to signed-out visitors (see home-gate).
 * Get Started / Sign in lead to /login; signed-in users never reach this.
 */
export function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#050505] text-white">
      {/* Mascot — desktop (lg): right-side panel fading into black on its left.
          Phones & portrait tablets: full-width panel filling the lower half
          of the first viewport, its top edge fading up into the hero copy —
          same art, same fires and embers at full strength. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[45dvh] h-[55dvh] lg:inset-y-0 lg:left-auto lg:h-auto lg:w-[56%]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/landing-mascot.jpg"
          alt=""
          className="landing-mascot h-full w-full object-cover object-[50%_38%] lg:object-center [mask-image:linear-gradient(to_bottom,transparent,black_38%)] lg:[mask-image:linear-gradient(to_right,transparent,black_30%)]"
        />
        {/* Drifting red haze over the cat */}
        <div className="landing-haze absolute inset-0 bg-[radial-gradient(55%_45%_at_60%_65%,rgba(255,45,45,.14),transparent_70%)]" />
        {/* Firelight flickering beside it */}
        <div className="landing-fireglow absolute bottom-[6%] left-[8%] h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(255,85,35,.45),transparent_65%)] blur-2xl" />
        <div
          className="landing-fireglow absolute -bottom-[4%] right-[4%] h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,60,25,.4),transparent_65%)] blur-3xl"
          style={{ animationDelay: "-1.7s", animationDuration: "4.3s" }}
        />
        <div
          className="landing-fireglow absolute bottom-[32%] right-0 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(255,120,50,.35),transparent_65%)] blur-2xl"
          style={{ animationDelay: "-2.6s", animationDuration: "2.9s" }}
        />
        {/* Rising embers */}
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="landing-ember"
            style={
              {
                left: e.left,
                width: e.size,
                height: e.size,
                background: e.color,
                boxShadow: `0 0 ${e.size * 2.5}px ${e.color}`,
                animationDuration: `${e.duration}s`,
                animationDelay: `${e.delay}s`,
                "--drift": `${e.drift}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      {/* Header */}
      <header className="relative z-10 flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-12">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/catgpt-paw.png" alt="" className="h-7 w-auto sm:h-8" />
          <span className="font-display text-lg font-bold tracking-tight sm:text-xl">
            CatGPT
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-4 text-xs font-medium text-white/90 transition-colors hover:bg-white/10 sm:px-5 sm:text-sm"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-full bg-[#ff3d5e] px-4 text-xs font-medium shadow-lg shadow-[#ff3d5e]/25 transition-colors hover:bg-[#ff5470] sm:px-6 sm:text-sm"
          >
            Get Started
          </Link>
        </nav>
      </header>

      {/* Stacked-mode scrim — keeps hero copy readable where the cat's faded
          top edge slides underneath it. The lg side panel doesn't need it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[62dvh] bg-gradient-to-b from-[#050505] via-[#050505]/60 to-transparent lg:hidden"
      />

      {/* Hero */}
      <main className="relative z-10 flex min-h-[calc(100dvh-4rem)] flex-col justify-start px-5 pb-16 pt-10 sm:px-6 sm:pt-12 lg:min-h-[calc(100dvh-5rem)] lg:justify-center lg:px-12 lg:pt-0 lg:pl-20">
        <div className="max-w-2xl animate-fade-in">
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white/70">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#ff3d5e] shadow-[0_0_8px_#ff3d5e]" />
            Smart. Private. Unleashed.
          </span>

          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-7xl">
            Think Smarter
            <br />
            with <span className="text-[#ff3d5e]">CatGPT</span>
          </h1>

          <p className="mt-6 max-w-md text-sm leading-relaxed text-white/60 md:text-base">
            A fast, private and intelligent AI assistant for coding, learning
            and everyday tasks. Built for creators, developers and curious
            minds.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-[#ff3d5e] px-6 text-sm font-medium shadow-lg shadow-[#ff3d5e]/25 transition-all hover:bg-[#ff5470] active:scale-[0.98]"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#features"
              className="inline-flex h-11 items-center whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-6 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
            >
              Learn More
            </Link>
          </div>
        </div>
      </main>

      {/* Learn More target — below the fold, same dark/red theme */}
      <section id="features" className="relative z-10 px-5 pb-24 pt-8 sm:px-6 md:px-12 lg:pl-20">
        <div className="grid max-w-5xl gap-4 sm:grid-cols-3">
          {[
            {
              icon: MessageSquare,
              title: "Chat & code",
              desc: "A fast AI assistant for coding, learning and everyday questions.",
            },
            {
              icon: ImageIcon,
              title: "Image studio",
              desc: "Generate on-brand images with themed styles, edits and variants.",
            },
            {
              icon: Megaphone,
              title: "Brands & campaigns",
              desc: "Plan sales campaigns and keep every asset on-brand.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm"
            >
              <Icon className="h-5 w-5 text-[#ff3d5e]" />
              <h2 className="mt-3 font-display text-base font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
