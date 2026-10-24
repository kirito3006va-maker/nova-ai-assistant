import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { OUTBOX_DIR, ROOT_DIR } from "../config.mjs";
import { runOnInteractiveDesktop } from "./system-service.mjs";

const execAsync = promisify(exec);
const DESKTOP_DOCS_DIR = "C:\\Users\\USER\\Desktop\\Documentos_Nova";

function parseLineToRuns(line) {
  const runs = [];
  const parts = line.split(/(\*\*.*?\*\*)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22 }));
    } else if (part.length > 0) {
      runs.push(new TextRun({ text: part, size: 22 }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text: line, size: 22 })];
}

/**
 * Convierte texto estructurado en un documento Word (.docx) profesional.
 * Si openOnDesktop es true, también lo abre visiblemente en Microsoft Word en la laptop.
 */
export async function createWordDocument({
  title,
  content,
  author = "Kirito (Ing. Informática) & Nova",
  openOnDesktop = true
}) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.mkdirSync(DESKTOP_DOCS_DIR, { recursive: true });

  const paragraphs = [];

  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 }
    })
  );

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Autor: ${author}  |  Fecha: ${new Date().toLocaleDateString("es-PE")}`,
          italics: true,
          color: "555555"
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 }
    })
  );

  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^#\s+/, ""),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 }
        })
      );
    } else if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^##\s+/, ""),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 }
        })
      );
    } else if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^###\s+/, ""),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 }
        })
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: "•  ", bold: true, color: "0055FF" }),
            ...parseLineToRuns(line.replace(/^[-*]\s+/, ""))
          ],
          spacing: { after: 80 }
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          children: parseLineToRuns(line),
          spacing: { after: 120 }
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs
      }
    ]
  });

  const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 38) || "Documento_Nova";
  const fileName = `${safeTitle}_${Date.now()}.docx`;
  const filePath = path.join(OUTBOX_DIR, fileName);
  const desktopCopy = path.join(DESKTOP_DOCS_DIR, fileName);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  try {
    fs.writeFileSync(desktopCopy, buffer);
  } catch {}

  if (openOnDesktop) {
    try {
      await runOnInteractiveDesktop([`start "" winword.exe "${desktopCopy}"`]);
    } catch {}
  }

  return { filePath, desktopCopy, fileName, sizeBytes: buffer.length };
}

/**
 * Redacta en vivo dentro de la ventana activa de Microsoft Word en la pantalla de Kirito
 * mediante automatización COM de Office, guarda el .docx y lo devuelve para enviarlo a Telegram.
 */
export async function writeLiveInMicrosoftWord({ title, content }) {
  // Primero generamos el archivo .docx estructurado y luego lo inyectamos o abrimos en vivo en Word
  const wordRes = await createWordDocument({ title, content, openOnDesktop: true });

  const psScriptPath = path.join(OUTBOX_DIR, `live_word_${Date.now()}.ps1`);
  const cleanTitle = title.replace(/"/g, "'");
  const cleanText = content.replace(/\r?\n/g, "`r`n").replace(/"/g, "'").slice(0, 6000);

  const psCode = `
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
  $word.Visible = $true
  if ($word.Documents.Count -gt 0) {
    $doc = $word.ActiveDocument
    $sel = $word.Selection
    $sel.Font.Name = "Calibri"
    $sel.Font.Size = 16
    $sel.Font.Bold = 1
    $sel.TypeText("${cleanTitle}\`r\`n\`r\`n")
    $sel.Font.Size = 11
    $sel.Font.Bold = 0
    $sel.TypeText("${cleanText}\`r\`n")
  }
} catch {}
`;
  try {
    fs.writeFileSync(psScriptPath, psCode, "utf8");
    await runOnInteractiveDesktop([`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`]);
  } catch {}

  return wordRes;
}

/**
 * Genera un archivo PDF (.pdf) profesional y limpio usando Brave Headless print-to-pdf
 */
export async function createPdfDocument({ title, content, author = "Kirito (Ing. Informática) & Nova" }) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.mkdirSync(DESKTOP_DOCS_DIR, { recursive: true });

  const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 38) || "Reporte_Nova";
  const ts = Date.now();
  const htmlPath = path.join(OUTBOX_DIR, `${safeTitle}_${ts}.html`);
  const fileName = `${safeTitle}_${ts}.pdf`;
  const filePath = path.join(OUTBOX_DIR, fileName);
  const desktopCopy = path.join(DESKTOP_DOCS_DIR, fileName);

  const formattedBody = content
    .split("\n")
    .map((raw) => {
      const l = raw.trim();
      if (!l) return "<div style='height:8px'></div>";
      if (l.startsWith("# ")) return `<h1>${l.slice(2)}</h1>`;
      if (l.startsWith("## ")) return `<h2>${l.slice(3)}</h2>`;
      if (l.startsWith("### ")) return `<h3>${l.slice(4)}</h3>`;
      if (l.startsWith("- ") || l.startsWith("* ")) {
        return `<li>${l.slice(2).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</li>`;
      }
      return `<p>${l.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 22mm 18mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111827; line-height: 1.6; font-size: 11.5pt; }
  .header { border-bottom: 3px solid #0055FF; padding-bottom: 12px; margin-bottom: 24px; }
  .title { font-size: 22pt; font-weight: 800; color: #050814; margin: 0; }
  .meta { font-size: 9.5pt; color: #4B5563; margin-top: 6px; }
  h1 { font-size: 15pt; color: #0055FF; border-left: 4px solid #FF0033; padding-left: 10px; margin-top: 20px; }
  h2 { font-size: 13pt; color: #1E3A8A; margin-top: 16px; }
  h3 { font-size: 11.5pt; color: #FF0033; margin-top: 12px; }
  p { margin: 8px 0; text-align: justify; }
  li { margin: 5px 0 5px 18px; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">${title}</div>
    <div class="meta">Autor: ${author} &bull; Fecha: ${new Date().toLocaleDateString("es-PE")} &bull; Generado por NOVA</div>
  </div>
  ${formattedBody}
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, "utf8");

  const braveExe = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
  await execAsync(
    `"${braveExe}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${filePath}" "${htmlPath}"`,
    { timeout: 25000 }
  );

  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, desktopCopy);
    }
  } catch {}

  return { filePath, desktopCopy, fileName };
}

/**
 * Genera una presentación de PowerPoint (.pptx) real usando automatización COM de Microsoft PowerPoint
 */
export async function createPowerPointPresentation({
  title,
  content,
  author = "Kirito & Nova",
  openOnDesktop = true
}) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.mkdirSync(DESKTOP_DOCS_DIR, { recursive: true });

  const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 35) || "Presentacion_Nova";
  const fileName = `${safeTitle}_${Date.now()}.pptx`;
  const filePath = path.join(OUTBOX_DIR, fileName);
  const desktopCopy = path.join(DESKTOP_DOCS_DIR, fileName);

  // Dividir contenido en diapositivas por encabezados (# o ##)
  const rawSections = content.split(/\n(?=#{1,3}\s)/g).filter((s) => s.trim().length > 0);
  const slidesData = rawSections.slice(0, 10).map((sec, idx) => {
    const lines = sec.trim().split("\n");
    const slideTitle = lines[0].replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "").trim().slice(0, 80) || `Sección ${idx + 1}`;
    const bodyLines = lines
      .slice(1)
      .map((l) => l.replace(/^[-*]\s*/, "• ").replace(/\*\*/g, "").trim())
      .filter(Boolean)
      .slice(0, 7)
      .join("\r\n");
    return { slideTitle, body: bodyLines || sec.replace(/\*\*/g, "").trim().slice(0, 350) };
  });

  if (slidesData.length === 0) {
    slidesData.push({
      slideTitle: title,
      body: content.replace(/\*\*/g, "").slice(0, 400)
    });
  }

  const jsonSlidesPath = path.join(OUTBOX_DIR, `slides_${Date.now()}.json`);
  fs.writeFileSync(jsonSlidesPath, JSON.stringify({ title, author, slides: slidesData }, null, 2), "utf8");

  const psScriptPath = path.join(OUTBOX_DIR, `build_ppt_${Date.now()}.ps1`);
  const psScript = `
$ErrorActionPreference = "Stop"
$data = Get-Content -Raw -Encoding UTF8 "${jsonSlidesPath}" | ConvertFrom-Json
$ppt = New-Object -ComObject PowerPoint.Application
$pres = $ppt.Presentations.Add()

# Diapositiva 1: Portada
$slide1 = $pres.Slides.Add(1, 1)
$slide1.Shapes.Title.TextFrame.TextRange.Text = [string]$data.title
$slide1.Shapes.Item(2).TextFrame.TextRange.Text = "Autor: " + [string]$data.author + "\`r\`nFecha: $(Get-Date -Format 'dd/MM/yyyy')"

$idx = 2
foreach ($s in $data.slides) {
  $slide = $pres.Slides.Add($idx, 2)
  $slide.Shapes.Title.TextFrame.TextRange.Text = [string]$s.slideTitle
  $slide.Shapes.Item(2).TextFrame.TextRange.Text = [string]$s.body
  $idx++
}

$pres.SaveAs("${filePath}")
try { Copy-Item "${filePath}" "${desktopCopy}" -Force } catch {}
if (-not $${openOnDesktop ? "true" : "false"}) {
  $pres.Close()
  $ppt.Quit()
}
`;
  fs.writeFileSync(psScriptPath, psScript, "utf8");
  await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { timeout: 30000 });

  return { filePath, desktopCopy, fileName };
}

/**
 * Crea un archivo de código o plantilla (.sql, .java, .py, .html, .js, .cpp, .cs, .md, etc.)
 * y opcionalmente lo abre en VS Code o Antigravity en la laptop.
 */
export async function createCodeOrTemplateFile({
  title = "codigo_nova",
  extension = ".txt",
  codeContent = "",
  openInEditor = true
}) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const codeDir = "C:\\Users\\USER\\Desktop\\Codigo_Nova";
  fs.mkdirSync(codeDir, { recursive: true });

  const cleanExt = extension.startsWith(".") ? extension : `.${extension}`;
  const safeBase = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 35) || "script_nova";
  const fileName = `${safeBase}_${Date.now()}${cleanExt}`;
  const filePath = path.join(OUTBOX_DIR, fileName);
  const desktopCopy = path.join(codeDir, fileName);

  // Si el modelo envolvió el código en bloques ```lang ... ```, extraer el código limpio
  let extracted = codeContent.trim();
  const fenceMatch = extracted.match(/```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    extracted = fenceMatch[1].trim();
  }

  fs.writeFileSync(filePath, extracted, "utf8");
  try {
    fs.writeFileSync(desktopCopy, extracted, "utf8");
  } catch {}

  if (openInEditor) {
    try {
      await runOnInteractiveDesktop([
        `start "" "C:\\Users\\USER\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" "${desktopCopy}"`
      ]);
    } catch {}
  }

  return { filePath, desktopCopy, fileName };
}
