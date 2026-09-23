import type {
  Board,
  BoardItem,
  Generation,
  Memory,
  Theme,
} from "@prompthub/db";
import type {
  BoardDto,
  BoardItemDto,
  GenerationDto,
  MemoryDto,
  ThemeDto,
} from "@prompthub/types";

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
    prompt: g.prompt,
    finalPrompt: g.finalPrompt,
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

export function toMemoryDto(m: Memory): MemoryDto {
  return {
    id: m.id,
    userId: m.userId,
    type: m.type,
    content: m.content,
    sourceGenId: m.sourceGenId,
    createdAt: m.createdAt.toISOString(),
  };
}
