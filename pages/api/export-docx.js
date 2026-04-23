import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat, HeadingLevel
} from "docx";

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

function parseHtmlSections(html) {
  const sections = [];
  // Extract header info
  const titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '會議記錄';
  const metaMatches = [...html.matchAll(/<span class="meta-label">([^<]+)<\/span><span class="meta-value">([^<]+)<\/span>/g)];
  const meta = metaMatches.map(m => ({ label: m[1].trim(), value: m[2].trim() }));

  // Extract sections
  const sectionMatches = [...html.matchAll(/<div class="section[^"]*">\s*<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)<\/div>/g)];
  for (const m of sectionMatches) {
    const heading = m[1].replace(/<[^>]+>/g, '').trim();
    const body = m[2];
    const items = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(li => li[1].replace(/<[^>]+>/g, '').trim());
    sections.push({ heading, items });
  }
  return { title, meta, sections };
}

const ACCENT = "993556";
const GREEN = "0F6E56";
const GOLD = "c49a3c";
const LIGHT_PINK = "FBEAF0";
const LIGHT_GREEN = "E1F5EE";
const LIGHT_GOLD = "FAEEDA";
const BORDER_COLOR = "D4C9BE";

const cellBorder = (color = BORDER_COLOR) => ({
  top: { style: BorderStyle.SINGLE, size: 1, color },
  bottom: { style: BorderStyle.SINGLE, size: 1, color },
  left: { style: BorderStyle.SINGLE, size: 1, color },
  right: { style: BorderStyle.SINGLE, size: 1, color },
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { title, subtitle, date, html, actions } = req.body;
  const { title: parsedTitle, meta, sections } = parseHtmlSections(html || '');

  const children = [];

  // ── Title ──
  children.push(new Paragraph({
    children: [new TextRun({ text: parsedTitle || title, bold: true, size: 44, font: "Arial", color: "1a1410" })],
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1a1410", space: 4 } },
  }));

  // ── Subtitle ──
  if (subtitle) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "AI 摘要　", bold: true, size: 18, font: "Arial", color: GOLD }),
        new TextRun({ text: subtitle, size: 18, font: "Arial", color: "7a5a1a" }),
      ],
      shading: { fill: LIGHT_GOLD, type: ShadingType.CLEAR },
      spacing: { before: 80, after: 200 },
      indent: { left: 160 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    }));
  }

  // ── Meta rows ──
  for (const m of meta) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${m.label}　`, bold: true, size: 20, font: "Arial", color: ACCENT }),
        new TextRun({ text: m.value, size: 20, font: "Arial", color: "5a4f44" }),
      ],
      spacing: { after: 60 },
    }));
  }
  children.push(new Paragraph({ spacing: { after: 200 } }));

  // ── Sections ──
  for (const sec of sections) {
    const isResolved = sec.heading.includes('決議');
    const headerColor = isResolved ? GREEN : ACCENT;
    const bgColor = isResolved ? LIGHT_GREEN : "EFE8DE";

    children.push(new Paragraph({
      children: [new TextRun({ text: sec.heading, bold: true, size: 22, font: "Arial", color: headerColor })],
      shading: { fill: bgColor, type: ShadingType.CLEAR },
      spacing: { before: 200, after: 100 },
      indent: { left: 160 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: headerColor, space: 4 } },
    }));

    for (const item of sec.items) {
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text: item, size: 20, font: "Arial" })],
        spacing: { after: 60 },
      }));
    }
    children.push(new Paragraph({ spacing: { after: 120 } }));
  }

  // ── Action items table ──
  if (actions && actions.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "行動清單", bold: true, size: 22, font: "Arial", color: GOLD })],
      shading: { fill: LIGHT_GOLD, type: ShadingType.CLEAR },
      spacing: { before: 200, after: 140 },
      indent: { left: 160 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    }));

    const headerRow = new TableRow({
      children: [
        ["完成", 800], ["負責人", 1400], ["事項", 5000], ["期限", 1600]
      ].map(([text, w]) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        borders: cellBorder("C49A3C"),
        shading: { fill: LIGHT_GOLD, type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: "Arial", color: "7a5a1a" })] })]
      }))
    });

    const dataRows = actions.map((a, i) => new TableRow({
      children: [
        [a.done ? "✓" : "", 800, a.done ? GREEN : "888"],
        [a.person, 1400, ACCENT],
        [a.task + (a.done && a.completedAt ? `\n（${a.completedAt.slice(0,10)} 完成）` : ''), 5000, "1a1410"],
        [a.deadline || "—", 1600, "5a4f44"],
      ].map(([text, w, color]) => new TableCell({
        width: { size: w, type: WidthType.DXA },
        borders: cellBorder(),
        shading: { fill: i % 2 === 0 ? "FFFFFF" : "F7F3EE", type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: String(text), size: 18, font: "Arial", color })] })]
      }))
    }));

    children.push(new Table({
      width: { size: 8800, type: WidthType.DXA },
      columnWidths: [800, 1400, 5000, 1600],
      rows: [headerRow, ...dataRows],
    }));
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 440, hanging: 280 } } } }]
      }]
    },
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } }
    },
    sections: [{
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } }
      },
      children
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${date || 'meeting'}_頭目會議.docx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}
