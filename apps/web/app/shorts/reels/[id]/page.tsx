import { ReelEditorView } from "@/components/shorts/reel-editor";
import { ReelRunView } from "@/components/shorts/reel-run-view";

/** A reel: live progress and the finished video; `?edit=1` opens the editor for corrections. */
export default async function ShortsReelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  return edit ? <ReelEditorView id={id} /> : <ReelRunView id={id} />;
}
