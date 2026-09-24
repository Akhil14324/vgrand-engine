import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { PublicShareDto } from "@catgpt/types";
import { API_URL } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Public read-only share view — no auth required. */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/share/${token}`, { cache: "no-store" });
  if (!res.ok) notFound();
  const data = (await res.json()) as PublicShareDto;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/catgpt-logo.png"
            alt="CatGPT"
            className="mx-auto h-16 w-auto rounded-xl bg-white object-contain px-2 py-1"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            shared generation · {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card shadow-lg">
          {data.imageUrls[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.imageUrls[0]}
              alt={data.prompt}
              className="w-full object-cover"
            />
          )}
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              {data.themeLabel && <Badge>{data.themeLabel}</Badge>}
              <Badge variant="outline">{data.provider}</Badge>
            </div>
            <p className="text-sm leading-relaxed">{data.prompt}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <Button asChild size="lg">
            <Link href="/">
              Generate your own <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
