export function displayTaskDate(value: string): string {
  return value ? value.split('-').reverse().join('/') : '';
}

// Validate the actual calendar date, including leap years, before sending ISO to the API.
export function parseTaskDate(value: string): string | null {
  if (!value) return '';
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number(year) >= 1 && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
