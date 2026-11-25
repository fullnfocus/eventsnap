// Stage 3: validation. Normalises model output and flags anything the student should check
// on the review screen before the event goes into their calendar.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function normTime(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function realDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function normaliseLink(u) {
  if (!u) return null;
  u = String(u).trim().replace(/[.,;)\]]+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

export function validateEvent(raw, { refDate, qrLinks = [] } = {}) {
  const e = {
    title: raw.title?.trim() || null,
    start_date: raw.start_date || null,
    start_time: normTime(raw.start_time),
    end_date: raw.end_date || null,
    end_time: normTime(raw.end_time),
    location: raw.location?.trim() || null,
    registration_link: normaliseLink(raw.registration_link),
    organizer: raw.organizer || null,
    other_sessions: Array.isArray(raw.other_sessions) ? raw.other_sessions : [],
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    notes: raw.notes || null,
    link_source: raw.registration_link ? 'printed' : null,
    year_inferred: raw.year_printed === false,
  };
  const warnings = [];

  // QR codes are read directly from the image, so a decoded URL is more reliable than OCR'd text.
  const qrUrl = qrLinks.map(normaliseLink).find(Boolean);
  if (qrUrl && !e.registration_link) {
    e.registration_link = qrUrl;
    e.link_source = 'qr';
  } else if (qrUrl && e.registration_link && qrUrl !== e.registration_link) {
    warnings.push({ field: 'registration_link', msg: 'Printed link differs from the QR code link — check which one is correct.' });
  }

  if (!e.title) warnings.push({ field: 'title', msg: 'No event title found.' });
  if (!e.start_date) warnings.push({ field: 'start_date', msg: 'No date found — please enter it.' });
  else if (!realDate(e.start_date)) {
    warnings.push({ field: 'start_date', msg: `"${e.start_date}" is not a valid date.` });
    e.start_date = null;
  } else if (refDate) {
    const days = (new Date(e.start_date) - new Date(refDate)) / 864e5;
    if (days < -1) warnings.push({ field: 'start_date', msg: 'This date has already passed — the event may be over.' });
    if (days > 300) warnings.push({ field: 'start_date', msg: 'This date is far in the future — check the year.' });
  }
  if (e.start_date && e.year_inferred) warnings.push({ field: 'start_date', msg: `The poster does not show a year — assumed ${e.start_date.slice(0, 4)} (closest to today).` });
  if (e.end_date && !realDate(e.end_date)) e.end_date = null;
  if (!e.start_time) warnings.push({ field: 'start_time', msg: 'No start time found — it will be added as an all-day event.' });
  if (e.start_time && e.end_time && !e.end_date && e.end_time <= e.start_time)
    warnings.push({ field: 'end_time', msg: 'Ends after midnight (next day) — check the end time.' });
  if (!e.location) warnings.push({ field: 'location', msg: 'No venue found.' });
  if (raw.registration_link && !e.registration_link) warnings.push({ field: 'registration_link', msg: 'Link could not be parsed.' });
  if (e.other_sessions.length) warnings.push({ field: 'start_date', msg: `Poster lists ${e.other_sessions.length + 1} sessions; only the first is added.` });
  if (e.confidence != null && e.confidence < 0.6) warnings.push({ field: '*', msg: 'The model is not confident about this poster.' });

  const critical = ['title', 'start_date', 'start_time', 'location'];
  return { event: e, warnings, needsReview: warnings.length > 0 || critical.some((f) => !e[f]) };
}
