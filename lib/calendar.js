// Stage 4: calendar output.
//  - toICS(): an RFC 5545 .ics file (works with Google, Apple and Outlook calendars)
//  - googleCalendarUrl(): a pre-filled "add event" link; the student confirms in Google Calendar,
//    so the app never needs access to their Google account.

const HK_OFFSET_H = 8; // Hong Kong is UTC+8 all year

function utcStamp(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - HK_OFFSET_H, mi)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addHours(time, h) {
  const [hh, mm] = time.split(':').map(Number);
  const t = Math.min(hh + h, 23);
  return `${String(t).padStart(2, '0')}:${String(t === 23 && hh + h > 23 ? 59 : mm).padStart(2, '0')}`;
}

// Returns { allDay, start, end } in calendar format.
export function eventTimes(e) {
  if (!e.start_date) throw new Error('Event has no date');
  if (!e.start_time) {
    const endDate = addDays(e.end_date || e.start_date, 1);
    return { allDay: true, start: e.start_date.replace(/-/g, ''), end: endDate.replace(/-/g, '') };
  }
  const endTime = e.end_time || addHours(e.start_time, 1); // default length: 1 hour
  // "10pm-2am": an end time at or before the start time means the event ends the next day
  const endDate = e.end_date || (e.end_time && e.end_time <= e.start_time ? addDays(e.start_date, 1) : e.start_date);
  return { allDay: false, start: utcStamp(e.start_date, e.start_time), end: utcStamp(endDate, endTime) };
}

function description(e) {
  return [e.registration_link && `Register: ${e.registration_link}`, e.organizer && `Organiser: ${e.organizer}`, 'Added with EventSnap']
    .filter(Boolean)
    .join('\n');
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Fold lines longer than 75 octets (RFC 5545 section 3.1)
function fold(line) {
  const out = [];
  let buf = '';
  for (const ch of line) {
    if (Buffer.byteLength(buf + ch) > (out.length ? 74 : 75)) {
      out.push(buf);
      buf = '';
    }
    buf += ch;
  }
  out.push(buf);
  return out.join('\r\n ');
}

export function toICS(e) {
  const t = eventTimes(e);
  const uid = `${t.start}-${Buffer.from(e.title || 'event').toString('hex').slice(0, 16)}@eventsnap`;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventSnap//GE2340//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    t.allDay ? `DTSTART;VALUE=DATE:${t.start}` : `DTSTART:${t.start}`,
    t.allDay ? `DTEND;VALUE=DATE:${t.end}` : `DTEND:${t.end}`,
    `SUMMARY:${esc(e.title || 'Campus event')}`,
    e.location && `LOCATION:${esc(e.location)}`,
    `DESCRIPTION:${esc(description(e))}`,
    e.registration_link && `URL:${e.registration_link}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(e) {
  const t = eventTimes(e);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title || 'Campus event',
    dates: `${t.start}/${t.end}`,
    details: description(e),
    ctz: 'Asia/Hong_Kong',
  });
  if (e.location) p.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
