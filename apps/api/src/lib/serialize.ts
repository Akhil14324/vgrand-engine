import type {
  Board,
  BoardItem,
  Conversation,
  Document,
  Generation,
  Memory,
  Theme,
} from "@catgpt/db";
import type {
  BoardDto,
  BoardItemDto,
  ConversationDto,
  DocumentDto,
  GenerationDto,
  MemoryDto,
  ThemeDto,
} from "@catgpt/types";

type GenerationWithTheme = Generation & {
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

export function toBoardItemDto(
  item: BoardItem & { generation?: GenerationWithTheme | null },
): BoardItemDto {
  return {
    id: item.id,
    boardId: item.boardId,
    generationId: item.generationId,
    generation: item.generation
      ? toGenerationDto(item.generation)
      : undefined,
    addedAt: item.addedAt.toISOString(),
  };
}

export function toBoardDto(
  board: Board & { items?: Array<BoardItem & { generation?: GenerationWithTheme | null }> },
): BoardDto {
  return {
    id: board.id,
    userId: board.userId,
    name: board.name,
    items: (board.items ?? []).map(toBoardItemDto),
    createdAt: board.createdAt.toISOString(),
  };
}

type ConversationWithPreview = Conversation & {
  generations?: Array<
    Pick<Generation, "id" | "prompt" | "imageUrls" | "status">
  >;
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
    pageCount: d.pageCount,
    chunkCount: d.chunkCount,
    status: d.status as DocumentDto["status"],
    error: d.error,
    createdAt: d.createdAt.toISOString(),
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
