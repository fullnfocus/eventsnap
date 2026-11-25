// Stage 2: Gemini maps the OCR text to structured event fields (JSON schema).
import { config } from './config.js';

// JSON schema the model must follow (Gemini "responseSchema", OpenAPI subset).
const EVENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_event_poster: { type: 'BOOLEAN', description: 'true only if the text announces a specific event (something happening at a date/time/place)' },
    not_poster_reason: { type: 'STRING', nullable: true, description: 'If is_event_poster is false: one short sentence why' },
    year_printed: { type: 'BOOLEAN', description: 'true if the year of start_date is printed on the poster' },
    title: { type: 'STRING', nullable: true, description: 'Event name as printed on the poster' },
    start_date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD of the (first) session' },
    start_time: { type: 'STRING', nullable: true, description: '24-hour HH:MM, null if not printed' },
    end_date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD, null if same day or not printed' },
    end_time: { type: 'STRING', nullable: true, description: '24-hour HH:MM, null if not printed' },
    location: { type: 'STRING', nullable: true, description: 'Venue exactly as printed, e.g. "LT-15, AC1"' },
    registration_link: { type: 'STRING', nullable: true, description: 'Printed registration/sign-up URL' },
    organizer: { type: 'STRING', nullable: true },
    other_sessions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Other dates/times if the event repeats' },
    confidence: { type: 'NUMBER', description: '0-1 overall confidence in the extraction' },
    notes: { type: 'STRING', nullable: true, description: 'Ambiguities the user should check' },
  },
  required: ['is_event_poster', 'year_printed', 'title', 'start_date', 'start_time', 'end_time', 'location', 'registration_link', 'confidence'],
};

function instructions(refDate) {
  return `You extract calendar event details from university event posters (City University of Hong Kong).
Today's date is ${refDate}; the timezone is Hong Kong (UTC+8).
The input is OCR text, so expect line-break and spelling noise.
Rules:
- Only use information that is actually on the poster. Never invent values; use null when a field is missing.
- First decide is_event_poster: true only if the text announces a specific event (talk, party, workshop, meeting, competition...).
  Menus, notices, product ads, signs, screenshots of chats, random photos and text with no event are false - then leave the other fields null and explain in not_poster_reason.
- Dates: output YYYY-MM-DD. If the year is not printed, use the current year and set year_printed to false (the app fixes the year).
- Times: output 24-hour HH:MM. "7-9pm" means start 19:00, end 21:00.
- If the event has several sessions, put the first one in start_date/start_time and list the others in other_sessions.
- registration_link: a printed URL for registering/signing up (not social-media handles). Keep it exactly as printed.
- location: the venue as printed (room, building, hall). Keep CityU codes such as "LT-15", "AC1", "CMC".
- Describe any uncertainty in notes.`;
}

// Low-level Gemini call with retries on rate limits (429) and server errors (5xx).
export async function geminiGenerate(parts, generationConfig = {}, model = config.geminiModel) {
  if (!config.geminiKey) throw new Error('GEMINI_API_KEY is not set - add it to the .env file and restart the server');
  const url = `${config.geminiBase}/v1beta/models/${model}:generateContent`;
  const payload = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig });
  const t0 = Date.now();
  let res, body;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { method: 'POST', headers: { 'x-goog-api-key': config.geminiKey, 'Content-Type': 'application/json' }, body: payload });
    body = await res.text();
    if (res.ok || !(res.status === 429 || res.status >= 500)) break;
    const wait = 2000 * 2 ** attempt;
    console.log(`  Gemini ${res.status}, retrying in ${wait / 1000} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${body.slice(0, 400)}`);
  const json = JSON.parse(body);
  const text = (json.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const u = json.usageMetadata || {};
  return {
    text,
    ms: Date.now() - t0,
    usage: { inTokens: u.promptTokenCount || 0, outTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

let thinkingSupported = true; // switched off automatically if the model rejects the setting

export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'default'];

async function callGemini(parts, thinking = config.geminiThinking) {
  const base = { responseMimeType: 'application/json', responseSchema: EVENT_SCHEMA };
  const level = THINKING_LEVELS.includes(thinking) ? thinking : config.geminiThinking;
  let r;
  if (level !== 'default' && thinkingSupported) {
    try {
      r = await geminiGenerate(parts, { ...base, thinkingConfig: { thinkingLevel: level.toUpperCase() } });
    } catch (e) {
      if (!/\b400\b/.test(e.message) || !/think/i.test(e.message)) throw e;
      console.log(`  ! Model does not accept GEMINI_THINKING=${level}; using the model's default instead`);
      thinkingSupported = false;
    }
  }
  r ??= await geminiGenerate(parts, base);
  let event;
  try {
    event = JSON.parse(r.text.replace(/^```(?:json)?|```$/g, '').trim());
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${r.text.slice(0, 200)}`);
  }
  return { event, ms: r.ms, usage: r.usage, thinking: level !== 'default' && thinkingSupported ? level : 'default' };
}

export async function extractFromText(ocrText, refDate, { thinking } = {}) {
  return callGemini([{ text: `${instructions(refDate)}\n\nOCR text of the poster:\n"""\n${ocrText}\n"""` }], thinking);
}
