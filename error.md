# Resume Analyzer Error Diagnosis & Technical Solution

## 1. Root Cause Analysis

### The Problem
When uploading valid PDF resumes (e.g., `SHRI_KRISHNA_S_Resume.pdf`), the application returned a generic, incorrect assessment:
- Overall Score: `25`
- ATS Score: `20`
- Content / Structure / Skills / Tone & Style Scores: `0`
- Feedback message: *"Resume appears to be unreadable or corrupted..."*

### Technical Root Cause
1. **Direct File Reference to AI without Text Extraction**:
   In `app/routes/upload.tsx`, the code was calling `ai.feedback(uploadedFile.path, prepareInstructions({ jobTitle, jobDescription }))`. Under the hood in `app/lib/puter.ts`, `ai.feedback` attempted to pass a Puter cloud file path (`{ type: "file", puter_path: path }`) directly to `puter.ai.chat(..., { model: "claude-sonnet-4" })`.
2. **Missing Text Parsing Pipeline**:
   The application had no client-side or server-side parser extracting text from uploaded PDFs before calling the AI model.
3. **Puter AI File Attachment Failure**:
   The Puter AI chat service could not extract readable text from the raw virtual cloud file reference. As a result, the LLM received empty or inaccessible document contents.
4. **LLM Hallucination of Low Scores**:
   Because the AI model received no actual resume text, it hallucinated that the file was unreadable/corrupted and returned low scores (`25` overall, `20` ATS, `0` for remaining categories).
5. **Lack of Failure State Separation**:
   The system treated this extraction/pipeline failure as a normal analysis result and saved `overallScore: 25` to the Puter KV store, confounding document reading failures with actual resume quality assessments.

---

## 2. Solution Summary

To solve this end-to-end without relying on superficial message overrides, we implemented a robust, multi-stage text extraction and analysis pipeline.

### Steps Implemented

#### A. Client-Side Text Extraction (`app/lib/resumeParser.ts`)
- Built `extractResumeText` utilizing `pdfjs-dist` to iterate through all pages of uploaded PDFs and extract line-by-line text.
- Added support for `.docx` and `.txt` files.
- Implemented text normalization (`normalizeText`) to strip non-printable control characters, normalize whitespace, and preserve meaningful line breaks.
- Set a validation threshold (`>= 50` characters).
- Implemented **OCR Fallback** using Puter's `ai.img2txt` on rendered canvas preview images if normal PDF text extraction returns insufficient text (scanned image-only PDFs).

#### B. Extracted Text Prompting (`constants/index.ts` & `app/lib/puter.ts`)
- Added `analyzeResumeText` in `puter.ts` to pass extracted text directly in the prompt payload instead of relying on broken file path attachments.
- Updated `prepareInstructions` in `constants/index.ts` to embed the extracted `resumeText` alongside `jobTitle` and `jobDescription`.
- Added explicit directives instructing the AI that text extraction was successful and forbidding false "unreadable or corrupted file" claims.

#### C. Response Parsing & Score Validation (`app/lib/puter.ts`)
- Created `parseAndValidateAIResponse` to:
  - Strip markdown code blocks (````json ... ````).
  - Safely isolate JSON boundaries.
  - Validate and clamp category scores within `0–100`.
  - Calculate a weighted average overall score if missing or invalid:
    $$\text{Overall Score} = \text{round}(0.35 \times \text{ATS} + 0.25 \times \text{Content} + 0.20 \times \text{Skills} + 0.10 \times \text{Structure} + 0.10 \times \text{Tone})$$

#### D. Explicit Error States (`app/routes/upload.tsx`)
- Updated `upload.tsx` to handle failures explicitly:
  - If text extraction fails (< 50 chars after OCR), the pipeline stops **before calling AI** and saves `status: "PARSING_FAILED"`.
  - The UI displays an error message explaining that text extraction failed. **No fake 0 or 25 score is generated.**

#### E. Detailed Results View & KV Integration (`app/routes/resume.tsx`, `app/routes.ts`, `app/routes/home.tsx`)
- Created `/resume/:id` route to render full analysis feedback, score circles, score badges, and category tips.
- Updated `home.tsx` to list user-analyzed resumes directly from Puter KV store (`kv.list("resume:*")`).

---

## 3. Pipeline Flow Comparison

### Before
```text
Upload PDF ──> Upload path to Puter FS ──> Pass path to AI ──> AI file read failure ──> Fake Score 25
```

### After
```text
Upload PDF ──> File Validation ──> pdfjs-dist Text Extraction ──> Text Normalization
                                                                        │
                                       ┌────────────────────────────────┴────────────────────────────────┐
                                       ▼                                                                 ▼
                            Text length >= 50 chars                                           Text length < 50 chars
                                       │                                                                 │
                                       ▼                                                                 ▼
                          Pass text to Puter AI Prompt                                        OCR Fallback (img2txt)
                                       │                                                                 │
                                       ▼                                                ┌────────────────┴────────────────┐
                          Validate & Format AI JSON                                     ▼                                 ▼
                                       │                                           OCR Success                       OCR Fail
                                       ▼                                                │                                 │
                          Save status: COMPLETED to KV                                  ▼                                 ▼
                                       │                                    Pass text to AI               Save status: PARSING_FAILED
                                       ▼                                                                   (No AI call, No fake 25)
                          Display Real Analysis in UI
```
