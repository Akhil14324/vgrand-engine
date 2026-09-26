"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2, Save, Sparkles } from "lucide-react";
import type { BrandDto } from "@catgpt/types";
import { useAuth } from "@/lib/auth";
import { useWorkspaces } from "@/lib/hooks";
import {
  useBrandGuidelines,
  useExportGuidelines,
  useGenerateGuidelines,
  useSaveGuidelines,
} from "@/lib/brand-guidelines-hooks";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";

/** Field keys a save can change, in the words the document uses. */
const FIELD_LABEL: Record<string, string> = {
  tagline: "Tagline",
  tone: "Tone of voice",
  colors: "Colors",
  typography: "Typography",
  logoRules: "Logo usage",
  visualStyle: "Visual style",
  photographyStyle: "Photography",
  requiredPhrases: "Required phrases",
  forbiddenWords: "Words to avoid",
  forbiddenClaims: "Claims we never make",
  defaultCta: "Call to action",
};

/**
 * Editable brand guidelines. Saving re-derives the matching brand profile
 * fields, so what is written here is what the AI follows from then on.
 */
export function BrandGuidelinesSection({ brand }: { brand: BrandDto }) {
  const { user } = useAuth();
  const { data: workspaces } = useWorkspaces();
  const canManage =
    brand.userId === user?.id ||
    (!!brand.workspaceId && workspaces?.find((w) => w.id === brand.workspaceId)?.role === "owner");

  const { data: saved, isLoading } = useBrandGuidelines(brand.id);
  const generate = useGenerateGuidelines();
  const save = useSaveGuidelines();
  const exportDoc = useExportGuidelines();

  const [text, setText] = useState("");
  const [tab, setTab] = useState("edit");
  // Reset the editor when the saved copy (or the brand) changes underneath it.
  useEffect(() => {
    setText(saved?.content ?? "");
  }, [saved?.content, brand.id]);

  const dirty = text !== (saved?.content ?? "");
  const hasContent = text.trim().length > 0;

  const runGenerate = () => {
    if ((hasContent || dirty) && !window.confirm("Replace the current text with a new AI draft? Unsaved edits will be lost.")) return;
    generate.mutate(brand.id, {
      onSuccess: ({ content }) => {
        setText(content);
        setTab("edit");
        toast.info("Draft ready - review and edit it, then save.");
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't generate guidelines"),
    });
  };

  const runSave = () =>
    save.mutate(
      { brandId: brand.id, content: text },
      {
        onSuccess: (res) =>
          toast.success(
            res.updatedFields.length
              ? `Guidelines saved. Updated brand: ${res.updatedFields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}`
              : "Guidelines saved",
          ),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
      },
    );

  const runExport = (format: "pdf" | "docx") =>
    exportDoc.mutate(
      { brandId: brand.id, format },
      {
        onSuccess: ({ url }) => window.open(url, "_blank", "noopener"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
      },
    );

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-semibold">Brand guidelines</h2>
        <p className="text-xs text-muted-foreground">
          Your brand&rsquo;s rulebook. Sections like Tone of voice, Colors, Words to avoid and Claims we never make are
          linked to your brand profile: when you save, they update what the AI follows for all future content.
        </p>
      </div>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : !hasContent && !canManage ? (
        <p className="text-sm text-muted-foreground">The brand owner hasn&rsquo;t written guidelines yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canManage && (
              <Button variant="outline" size="sm" onClick={runGenerate} disabled={generate.isPending}>
                {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {hasContent ? "New AI draft" : "Generate guidelines"}
              </Button>
            )}
            {canManage && (
              <Button size="sm" onClick={runSave} disabled={!dirty || !hasContent || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Save
              </Button>
            )}
            <span className="flex-1" />
            {saved && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => runExport("pdf")}
                  disabled={dirty || exportDoc.isPending}
                  title={dirty ? "Save first - exports use the saved version" : "PDF (Latin text)"}
                >
                  <FileDown /> PDF
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => runExport("docx")}
                  disabled={dirty || exportDoc.isPending}
                  title={dirty ? "Save first - exports use the saved version" : "Word (any language)"}
                >
                  <FileDown /> Word
                </Button>
              </>
            )}
          </div>

          {!hasContent ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              No guidelines yet. Generate a first draft from your brand profile; you can edit everything before saving.
              The AI only uses facts from your profile and never invents offers or claims.
            </p>
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="edit">{canManage ? "Edit" : "Text"}</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="pt-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  readOnly={!canManage}
                  spellCheck
                  aria-label="Brand guidelines (markdown)"
                  className="min-h-[360px] w-full rounded-md border border-input bg-transparent p-3 font-mono text-xs leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Edit the text under each heading. Keep the ## headings so linked sections stay connected;
                  empty a section to clear that brand field. PDF export supports Latin text; use Word for other scripts.
                </p>
              </TabsContent>
              <TabsContent value="preview" className="pt-2">
                <div className="rounded-md border p-4">
                  <Markdown>{text}</Markdown>
                </div>
              </TabsContent>
            </Tabs>
          )}
          {dirty && hasContent && canManage && <p className="text-xs text-amber-600">Unsaved changes</p>}
        </>
      )}
    </section>
  );
}
