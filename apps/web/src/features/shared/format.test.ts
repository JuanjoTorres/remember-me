import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDay } from './format';

// The API locks a gift at an instant; the creator must read that instant on their own clock.
const DEADLINE = '2030-01-03T10:00:00.000Z';

// The joining words and the kind of space before "AM" depend on the runtime's locale data, so the
// tests pin the day and the hour, which are what must be right.
describe('formatDateTime', () => {
  it('shows the same instant on the clock of each time zone', () => {
    expect(formatDateTime(DEADLINE, 'en', 'UTC')).toMatch(/^January 3, 2030\D+10:00\sAM$/);
    expect(formatDateTime(DEADLINE, 'en', 'America/Bogota')).toMatch(
      /^January 3, 2030\D+5:00\sAM$/,
    );
    expect(formatDateTime(DEADLINE, 'en', 'Europe/Madrid')).toMatch(
      /^January 3, 2030\D+11:00\sAM$/,
    );
  });

  it('crosses midnight with the time zone', () => {
    expect(formatDateTime('2030-01-03T02:00:00.000Z', 'en', 'America/Bogota')).toMatch(
      /^January 2, 2030\D+9:00\sPM$/,
    );
  });

  it('writes the date in the language of the page', () => {
    expect(formatDateTime(DEADLINE, 'es', 'Europe/Madrid')).toMatch(/^3 de enero de 2030\D+11:00$/);
  });

  it('uses the time zone of the device when none is given', () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatDateTime(DEADLINE, 'en')).toBe(formatDateTime(DEADLINE, 'en', device));
  });
});

describe('formatDay', () => {
  it('gives the day in that time zone', () => {
    expect(formatDay('2031-01-01T02:00:00.000Z', 'en', 'UTC')).toBe('January 1, 2031');
    expect(formatDay('2031-01-01T02:00:00.000Z', 'en', 'America/Bogota')).toBe('December 31, 2030');
  });
});
