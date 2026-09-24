import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { PublicChatDto } from "@catgpt/types";
import { API_URL } from "@/lib/config";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";

/** Public read-only view of a shared chat - no login needed. */
export default async function SharedChatPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/share/c/${token}`, { cache: "no-store" });
  if (!res.ok) notFound();
  const chat = (await res.json()) as PublicChatDto;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
      <header className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/catgpt-logo.png"
          alt="CatGPT"
          className="mx-auto h-14 w-auto rounded-xl bg-white object-contain px-2 py-1"
        />
        <h1 className="mt-4 text-lg font-semibold">{chat.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Shared chat · read-only · {new Date(chat.createdAt).toLocaleDateString()}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-6">
        {chat.turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-3">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed sm:max-w-[70%]">
                <p className="whitespace-pre-wrap break-words">{t.prompt}</p>
              </div>
            </div>
            <div className="max-w-[92%] sm:max-w-[80%]">
              {t.kind === "text" && t.textResponse ? (
                <Markdown>{t.textResponse}</Markdown>
              ) : (
                t.imageUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt={t.prompt}
                    className="max-w-full rounded-xl border sm:max-w-md"
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex justify-center">
        <Button asChild size="lg">
          <Link href="/">
            Start your own chat <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
