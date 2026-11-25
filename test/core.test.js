import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent } from '../lib/validate.js';
import { toICS, googleCalendarUrl, eventTimes } from '../lib/calendar.js';
import { parseCsv } from '../eval/csv.js';

const REF = '2026-11-25';

test('validation flags problems and merges QR links', () => {
  const v = validateEvent({ title: 'X', start_date: '2026-02-30', start_time: '19:00', end_time: '18:00', location: null }, { refDate: REF, qrLinks: ['https://forms.gle/q'] });
  const fields = v.warnings.map((w) => w.field);
  assert.ok(fields.includes('start_date') && fields.includes('location'));
  assert.equal(v.event.start_date, null);
  assert.equal(v.event.registration_link, 'https://forms.gle/q');
  assert.equal(v.event.link_source, 'qr');
  assert.equal(v.needsReview, true);
});

test('calendar outputs use Hong Kong time', () => {
  const e = { title: 'Talk, with commas; and semicolons', start_date: '2026-12-04', start_time: '19:00', end_time: '21:00', location: 'LT-15', registration_link: 'https://forms.gle/x' };
  assert.deepEqual(eventTimes(e), { allDay: false, start: '20261204T110000Z', end: '20261204T130000Z' });
  const ics = toICS(e);
  assert.match(ics, /DTSTART:20261204T110000Z/);
  assert.match(ics, /SUMMARY:Talk\\, with commas\\; and semicolons/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.match(googleCalendarUrl(e), /dates=20261204T110000Z%2F20261204T130000Z/);
  assert.deepEqual(eventTimes({ start_date: '2026-12-31' }), { allDay: true, start: '20261231', end: '20270101' });
});

test('csv parser handles quotes', () => {
  const rows = parseCsv('file,title\n"a.jpg","Hello, ""world"""\n');
  assert.deepEqual(rows, [{ file: 'a.jpg', title: 'Hello, "world"' }]);
});

import { closestYearDate, applyYearRule } from '../lib/dates.js';
test('year inference picks the closest year', () => {
  assert.equal(closestYearDate('2026-11-21', '2026-11-25'), '2026-11-21'); // recent past stays in the past
  assert.equal(closestYearDate('2026-01-10', '2026-11-25'), '2027-01-10'); // January poster seen in November -> next year
  assert.equal(closestYearDate('2026-12-30', '2027-01-05'), '2026-12-30'); // late-December event seen in early January
  assert.equal(applyYearRule({ start_date: '2027-11-21', year_printed: true }, '2026-11-25').start_date, '2027-11-21'); // printed year kept
  assert.equal(applyYearRule({ start_date: '2027-11-21', year_printed: false }, '2026-11-25').start_date, '2026-11-21');
});

test('overnight events end on the next day', () => {
  const t = eventTimes({ start_date: '2026-12-04', start_time: '22:00', end_time: '02:00' });
  assert.deepEqual(t, { allDay: false, start: '20261204T140000Z', end: '20261204T180000Z' });
});
