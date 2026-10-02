import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface TextExtractionResult {
  success: boolean;
  status: "TEXT_EXTRACTION_SUCCESS" | "OCR_FALLBACK_USED" | "TEXT_EXTRACTION_FAILED" | "UNSUPPORTED_FORMAT";
  extractedText: string;
  characterCount: number;
  pageCount: number;
  durationMs: number;
  method: "PDF_TEXT" | "TXT_TEXT" | "DOCX_TEXT" | "OCR" | "NONE";
  error?: string;
  errorCode?: string;
}

let pdfjsLib: any = null;
let loadPromise: Promise<any> | null = null;

async function loadPdfJs(): Promise<any> {
  if (pdfjsLib) return pdfjsLib;
  if (loadPromise) return loadPromise;

  // @ts-expect-error - pdfjs-dist/build/pdf.mjs is not typed
  loadPromise = import("pdfjs-dist/build/pdf.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    pdfjsLib = lib;
    return lib;
  });

  return loadPromise;
}

/**
 * Normalizes extracted text by removing control characters, excess spaces,
 * and standardizing line breaks.
 */
export function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Extracts text from a PDF file using pdfjs-dist.
 */
export async function extractTextFromPdf(file: File): Promise<{ text: string; pages: number }> {
  const lib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  let fullText = "";

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageStrings: string[] = [];

    let lastY: number | null = null;
    for (const item of textContent.items as any[]) {
      if (!item.str) continue;
      // If Y coordinate changed significantly, insert a line break
      const currentY = item.transform ? item.transform[5] : null;
      if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 5) {
        pageStrings.push("\n");
      }
      pageStrings.push(item.str);
      lastY = currentY;
    }

    fullText += pageStrings.join(" ") + "\n\n";
  }

  return {
    text: normalizeText(fullText),
    pages: numPages,
  };
}

/**
 * Extracts text from a DOCX file by reading string contents of word/document.xml.
 */
export async function extractTextFromDocx(file: File): Promise<{ text: string; pages: number }> {
  try {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const rawContent = decoder.decode(buffer);

    // Extract text inside <w:t> tags
    const textMatches = rawContent.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
    if (textMatches && textMatches.length > 0) {
      const extracted = textMatches
        .map((m) => m.replace(/<[^>]+>/g, ""))
        .join(" ");
      return { text: normalizeText(extracted), pages: 1 };
    }
  } catch (e) {
    console.warn("[Docx Parser] Fallback extraction failed", e);
  }
  return { text: "", pages: 1 };
}

/**
 * Extracts text from a plain text file.
 */
export async function extractTextFromTxt(file: File): Promise<{ text: string; pages: number }> {
  const text = await file.text();
  return { text: normalizeText(text), pages: 1 };
}

/**
 * Main entry point for file extraction with OCR fallback capability.
 */
export async function extractResumeText(
  file: File,
  options?: {
    imageFile?: File | null;
    ocrService?: (image: File | Blob) => Promise<string | undefined>;
  }
): Promise<TextExtractionResult> {
  const startTime = Date.now();
  const fileExt = file.name.split(".").pop()?.toLowerCase() || "";
  const mimeType = file.type.toLowerCase();

  console.log(`[Resume Upload] File: ${file.name} | Size: ${file.size} bytes | MIME: ${file.type} | Ext: ${fileExt}`);

  if (file.size === 0) {
    return {
      success: false,
      status: "TEXT_EXTRACTION_FAILED",
      extractedText: "",
      characterCount: 0,
      pageCount: 0,
      durationMs: Date.now() - startTime,
      method: "NONE",
      error: "The uploaded file is empty (0 bytes).",
      errorCode: "EMPTY_FILE",
    };
  }

  let extractedText = "";
  let pageCount = 1;
  let method: "PDF_TEXT" | "TXT_TEXT" | "DOCX_TEXT" | "OCR" | "NONE" = "NONE";

  try {
    if (fileExt === "pdf" || mimeType.includes("pdf")) {
      console.log("[Resume Parser] Attempting PDF text extraction...");
      const result = await extractTextFromPdf(file);
      extractedText = result.text;
      pageCount = result.pages;
      method = "PDF_TEXT";
    } else if (fileExt === "docx" || mimeType.includes("wordprocessingml")) {
      console.log("[Resume Parser] Attempting DOCX text extraction...");
      const result = await extractTextFromDocx(file);
      extractedText = result.text;
      pageCount = result.pages;
      method = "DOCX_TEXT";
    } else if (fileExt === "txt" || mimeType.includes("text/plain")) {
      console.log("[Resume Parser] Attempting TXT text extraction...");
      const result = await extractTextFromTxt(file);
      extractedText = result.text;
      pageCount = result.pages;
      method = "TXT_TEXT";
    } else {
      return {
        success: false,
        status: "UNSUPPORTED_FORMAT",
        extractedText: "",
        characterCount: 0,
        pageCount: 0,
        durationMs: Date.now() - startTime,
        method: "NONE",
        error: `Unsupported file format (.${fileExt}). Please upload a PDF, DOCX, or TXT file.`,
        errorCode: "UNSUPPORTED_FILE_TYPE",
      };
    }
  } catch (err) {
    console.error("[Resume Parser] Text extraction threw error:", err);
  }

  const minCharThreshold = 50;

  // If text extraction yielded sufficient text
  if (extractedText.length >= minCharThreshold) {
    const durationMs = Date.now() - startTime;
    console.log(`[Resume Parser] Success via ${method}. Extracted ${extractedText.length} characters in ${durationMs}ms.`);
    return {
      success: true,
      status: "TEXT_EXTRACTION_SUCCESS",
      extractedText,
      characterCount: extractedText.length,
      pageCount,
      durationMs,
      method,
    };
  }

  // If text is below threshold and OCR service is provided (e.g. for scanned PDFs)
  if (options?.ocrService && options?.imageFile) {
    console.log(`[Resume Parser] Low text extracted (${extractedText.length} chars). Attempting OCR fallback on rendered page image...`);
    try {
      const ocrText = await options.ocrService(options.imageFile);
      if (ocrText) {
        const normalizedOcr = normalizeText(ocrText);
        if (normalizedOcr.length >= minCharThreshold) {
          const durationMs = Date.now() - startTime;
          console.log(`[Resume Parser] OCR Success. Extracted ${normalizedOcr.length} characters in ${durationMs}ms.`);
          return {
            success: true,
            status: "OCR_FALLBACK_USED",
            extractedText: normalizedOcr,
            characterCount: normalizedOcr.length,
            pageCount,
            durationMs,
            method: "OCR",
          };
        }
      }
    } catch (ocrErr) {
      console.warn("[Resume Parser] OCR Fallback failed:", ocrErr);
    }
  }

  const durationMs = Date.now() - startTime;
  console.warn(`[Resume Parser] Failed to extract readable text layer. Character count: ${extractedText.length}`);

  return {
    success: false,
    status: "TEXT_EXTRACTION_FAILED",
    extractedText: "",
    characterCount: extractedText.length,
    pageCount,
    durationMs,
    method: "NONE",
    error: "We could not extract readable text from this file. It may be an unreadable scanned document or protected PDF.",
    errorCode: "EMPTY_EXTRACTED_TEXT",
  };
}
