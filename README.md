# EventSnap — campus event posters → calendar

GE2340 *Artificial Intelligence: Past, Present, and Future* — group project (City University of Hong Kong, 2026/27 Sem A).
VLASKALIC Milica · MAULETKALI Nurassyl · KOSZHANOV Bekzat

Students miss campus and hall events because the details are scattered across posters, emails and Instagram.
EventSnap takes a **photo or screenshot of an English event poster** and turns it into a **calendar event**
(title, date, time, location, registration link). The student reviews the fields, then adds the event to
Google Calendar or downloads an `.ics` file.

## How it works

```
poster image ──► OCR (OCR.space engine) ──► Gemini maps text → JSON ─────┐
      │                                                                  ├─► validation ─► review screen ─► Google Calendar / .ics
      └────────► QR-code decoding (jsQR) ───────────────────────────────┘     (flags missing / suspicious fields)
```

We implemented approach B from the Phase 1 proposal (OCR + language model):
stage 1 is a dedicated OCR engine (the OCR.space API, engine 2) that turns the image into plain text; stage 2 sends
only that text to Gemini, which maps it to event fields using a fixed JSON schema (no model training). Phase 1 planned
Mistral OCR for stage 1, but Mistral's free API plan does not include OCR, so we switched to OCR.space's free plan.
Images are shrunk automatically below OCR.space's 1 MB free-plan limit.

Two extra safeguards: (1) **not-a-poster detection** - images with almost no readable text are rejected before Gemini
is called, and Gemini also decides whether the text announces an event at all; (2) **year inference in code** - when a
poster prints no year (e.g. "21/11"), the app picks the year that puts the date closest to today, so a recent past
date is flagged as "may already be over" instead of jumping to next year.

The pipeline adds QR decoding, validation (invalid or past dates, end before start, missing fields, QR/printed link
mismatch) and calendar output. The app never signs in to the student's Google account: it opens a pre-filled
Google Calendar "add event" page, so the student confirms every event themselves.

## Run it

Requirements: [Node.js 18+](https://nodejs.org), a free OCR.space key (https://ocr.space/ocrapi/freekey) and a free Gemini API key (https://aistudio.google.com/apikey).

```bash
cp .env.example .env        # Windows PowerShell: copy .env.example .env  -> then: notepad .env
npm install                 # required: image shrinking + QR decoding (3 small pure-JS packages)
npm start                   # open http://localhost:3000
npm test                    # unit tests (no keys needed)
```

The front end is a single React page (`public/index.html`, loaded via CDN, no build step). The server is plain
Node.js with no framework (`server.js`).

## Evaluation

1. Put poster images in `data/posters/` (JPG or PNG; export iPhone HEIC photos as JPG).
2. Label every poster in `data/labels.csv` (rules below).
3. Run:
   ```bash
   npm run eval      # every labelled poster → results/predictions.jsonl (resumable)
   npm run score     # metrics → results/summary.json, tables.tex, per_poster.csv, failures.md
   python eval/plots.py   # figures → results/fig_*.pdf / .png (needs matplotlib)
   ```
   `npm run eval -- --limit 3` runs a quick test on 3 posters.
   To compare speed vs accuracy, run the evaluation twice into different folders, e.g. set `GEMINI_THINKING=minimal`
   in `.env` and run `npm run eval -- --out results-minimal`, then `npm run score -- --out results-minimal`.
   OCR results are cached in `results/cache/`, so re-running after changing the extraction prompt skips stage 1.

**Metrics:** non-poster rejection rate and wrongly rejected posters; per-field accuracy; *event accuracy* (title, date, start time and location all correct) with a 95%
Wilson interval; *calendar-ready* rate (all six fields correct); *hallucination rate* (a field filled in although
it is not on the poster); *flag recall* (share of wrong events that the review screen flagged); latency; tokens and cost.
Title match = token F1 ≥ 0.7; location match = token F1 ≥ 0.6 or one contains the other; dates, times and links must match exactly after normalisation.

### Labelling rules (`data/labels.csv`)

| Column | Rule |
|--------|------|
| `file` | file name in `data/posters/`, e.g. `photo_07.jpg`, `ig_03.png`, `email_02.png` |
| `source` | `photo` (phone photo of a physical poster), `instagram` (screenshot), `email` (email / website poster), or `other` (non-poster image) |
| `is_poster` | `1` for an event poster; `0` for a non-poster image (menu, notice, sign, random photo) - leave the event columns empty |
| `collected_on` | date you collected it, `YYYY-MM-DD` (when the poster has no year, the app picks the year closest to this date) |
| `title` | event name as printed |
| `start_date` | `YYYY-MM-DD`; first session if there are several |
| `start_time`, `end_time` | 24-hour `HH:MM`; **leave empty if not on the poster** |
| `location` | venue as printed (e.g. `LT-15, AC1`); empty if none |
| `registration_link` | the printed sign-up URL; if there is only a QR code, scan it with your phone and paste its URL; empty if none |
| `has_qr` | `1` or `0` |
| `notes` | anything tricky: multiple sessions, Chinese text, dark background, glare, handwriting, two events on one poster |

Label each poster **without looking at the model's output**, and have a second team member check every row.
Only use public posters; don't photograph people, and crop out anything personal.

## Repository layout

```
server.js            web server + API
public/index.html    React front end
lib/ocr.js           stage 1: OCR.space OCR engine
lib/image.js         image decode / resize (fits the 1 MB OCR.space limit)
lib/gemini.js        stage 2: Gemini extraction (JSON schema) + API client
lib/qr.js            QR decoding
lib/validate.js      checks + review flags
lib/calendar.js      .ics (RFC 5545) and Google Calendar link
eval/                run.js, score.js, plots.py
test/                unit tests
```
