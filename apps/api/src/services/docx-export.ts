import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseBlocks, type Segment } from "./pdf-export.js";

/**
 * Markdown -> Word (.docx). Real Word structures (heading styles, list
 * numbering, tables), so the file opens and edits normally in Word, Pages and
 * Google Docs — and, unlike the built-in-font PDF export, handles any script.
 */

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
];

function runs(
  segments: Segment[],
  base: { bold?: boolean; italics?: boolean } = {},
): (TextRun | ExternalHyperlink)[] {
  return segments.map((seg) => {
    const run = new TextRun({
      text: seg.text,
      bold: base.bold || seg.bold,
      italics: base.italics || seg.italic,
      font: seg.code ? "Courier New" : undefined,
      ...(seg.link ? { color: "2563EB", underline: {} } : {}),
    });
    return seg.link
      ? new ExternalHyperlink({ link: seg.link, children: [run] })
      : run;
  });
}

export async function renderMarkdownDocx(
  title: string,
  markdown: string,
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  let orderedInstance = 0;

  for (const block of parseBlocks(markdown)) {
    switch (block.type) {
      case "heading":
        children.push(
          new Paragraph({
            heading: HEADINGS[Math.min(block.level, 4) - 1],
            children: runs(block.segments),
          }),
        );
        break;
      case "paragraph":
        children.push(
          new Paragraph({
            spacing: { after: 140 },
            children: runs(block.segments),
          }),
        );
        break;
      case "list": {
        const instance = block.ordered ? ++orderedInstance : 0;
        for (const item of block.items) {
          children.push(
            new Paragraph({
              numbering: {
                reference: block.ordered ? "numbers" : "bullets",
                level: 0,
                ...(block.ordered ? { instance } : {}),
              },
              children: runs(item),
            }),
          );
        }
        break;
      }
      case "quote":
        children.push(
          new Paragraph({
            indent: { left: 540 },
            spacing: { after: 140 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 10 },
            },
            children: runs(block.segments, { italics: true }),
          }),
        );
        break;
      case "code":
        for (const line of (block.text || " ").split("\n")) {
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
              children: [
                new TextRun({ text: line || " ", font: "Courier New", size: 19 }),
              ],
            }),
          );
        }
        children.push(new Paragraph({ children: [] }));
        break;
      case "hr":
        children.push(
          new Paragraph({
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 },
            },
            children: [],
          }),
        );
        break;
      case "table": {
        const width = Math.max(...block.rows.map((r) => r.length));
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (cells, ri) =>
                new TableRow({
                  tableHeader: ri === 0,
                  children: Array.from({ length: width }, (_, ci) => {
                    return new TableCell({
                      children: [
                        new Paragraph({
                          children: runs(cells[ci] ?? [{ text: "" }], {
                            bold: ri === 0,
                          }),
                        }),
                      ],
                    });
                  }),
                }),
            ),
          }),
          new Paragraph({ children: [] }),
        );
        break;
      }
    }
  }

  const doc = new Document({
    title,
    creator: "CatGPT",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: "numbers",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
  });
  return Packer.toBuffer(doc);
}
