import type {
  Conversation,
  Document,
  Generation,
  Memory,
  Theme,
  Workspace,
} from "@catgpt/db";
import type {
  ConversationDto,
  DocumentDto,
  GenerationDto,
  MemoryDto,
  ThemeDto,
  WorkspaceDetailDto,
  WorkspaceDto,
} from "@catgpt/types";

type GenerationWithTheme = Omit<Generation, "finalPrompt"> & {
  finalPrompt?: string;
  theme?: Pick<Theme, "id" | "slug" | "label" | "icon"> | null;
};

export function toThemeDto(t: Theme): ThemeDto {
  return {
    id: t.id,
    slug: t.slug,
    label: t.label,
    description: t.description,
    promptTemplate: t.promptTemplate,
    styleGuide: t.styleGuide as ThemeDto["styleGuide"],
    icon: t.icon,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
  };
}

export function toGenerationDto(g: GenerationWithTheme): GenerationDto {
  return {
    id: g.id,
    userId: g.userId,
    themeId: g.themeId,
    theme: g.theme
      ? {
          id: g.theme.id,
          slug: g.theme.slug,
          label: g.theme.label,
          icon: g.theme.icon,
        }
      : null,
    conversationId: g.conversationId,
    kind: g.kind as GenerationDto["kind"],
    prompt: g.prompt,
    finalPrompt: g.finalPrompt,
    textResponse: g.textResponse,
    provider: g.provider,
    model: g.model,
    imageUrls: g.imageUrls,
    status: g.status as GenerationDto["status"],
    error: g.error,
    metadata: g.metadata as GenerationDto["metadata"],
    parentId: g.parentId,
    createdAt: g.createdAt.toISOString(),
  };
}

type ConversationWithPreview = Conversation & {
  generations?: Array<
    Pick<Generation, "id" | "prompt" | "imageUrls" | "status">
  >;
  workspace?: Pick<Workspace, "id" | "name"> | null;
  _count?: { generations: number };
};

export function toConversationDto(c: ConversationWithPreview): ConversationDto {
  const last = c.generations?.[0];
  return {
    id: c.id,
    userId: c.userId,
    title: c.title,
    pinned: c.pinned,
    archived: c.archived,
    workspaceId: c.workspaceId,
    workspace: c.workspace
      ? { id: c.workspace.id, name: c.workspace.name }
      : null,
    generationCount: c._count?.generations ?? c.generations?.length ?? 0,
    preview: last
      ? {
          id: last.id,
          prompt: last.prompt,
          imageUrl: last.imageUrls[0] ?? null,
          status: last.status as GenerationDto["status"],
        }
      : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toDocumentDto(d: Document): DocumentDto {
  return {
    id: d.id,
    userId: d.userId,
    conversationId: d.conversationId,
    filename: d.filename,
    storageUrl: d.storageUrl,
    pageCount: d.pageCount,
    chunkCount: d.chunkCount,
    status: d.status as DocumentDto["status"],
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toWorkspaceDto(
  w: Workspace & { _count?: { documents: number; members?: number } },
  viewerId: string,
): WorkspaceDto {
  return {
    id: w.id,
    userId: w.userId,
    name: w.name,
    role: w.userId === viewerId ? "owner" : "member",
    memberCount: (w._count?.members ?? 0) + 1,
    documentCount: w._count?.documents ?? 0,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export function toWorkspaceDetailDto(
  w: Workspace & {
    documents: Document[];
    _count?: { documents: number; members?: number };
  },
  viewerId: string,
): WorkspaceDetailDto {
  return {
    ...toWorkspaceDto(w, viewerId),
    documents: w.documents.map(toDocumentDto),
  };
}

export function toMemoryDto(
  m: Memory & { sourceGen?: { imageUrls: string[] } | null },
): MemoryDto {
  return {
    id: m.id,
    userId: m.userId,
    type: m.type,
    content: m.content,
    sourceGenId: m.sourceGenId,
    previewImage: m.sourceGen?.imageUrls[0] ?? null,
    metadata: (m.metadata as MemoryDto["metadata"]) ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
