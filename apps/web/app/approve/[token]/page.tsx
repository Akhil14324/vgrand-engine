import { notFound } from "next/navigation";
import type { PublicApprovalDto } from "@catgpt/types";
import { API_URL } from "@/lib/config";
import { ApprovalForm } from "@/components/approval-form";

/** Public client approval page — token grants review access without login. */
export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/approvals/${token}`, { cache: "no-store" });
  if (!res.ok) notFound();
  const data = (await res.json()) as PublicApprovalDto;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/catgpt-logo.png"
          alt="CatGPT"
          className="mx-auto h-14 w-auto rounded-xl bg-white object-contain px-2 py-1"
        />
        <h1 className="mt-4 text-lg font-semibold">Review this creative</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Client approval · no account needed · {new Date(data.createdAt).toLocaleDateString()}
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {data.imageUrls.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt={data.prompt}
            className="w-full object-cover"
          />
        ))}
        <div className="p-4">
          <p className="text-sm leading-relaxed">{data.prompt}</p>
        </div>
      </div>

      <ApprovalForm
        token={token}
        initialStatus={data.status}
        initialReviewer={data.reviewerName}
        initialComment={data.comment}
      />
    </div>
  );
}
