// One display standard for lens powers everywhere in the app: exactly two decimal places.
//   1 -> 1.00   0.5 -> 0.50   -1 -> -1.00   -0.5 -> -0.50   0 -> 0.00   -2.25 -> -2.25   " +0.25+0.5" -> " +0.25+0.50"
// DISPLAY ONLY. Stored labels, keys, numeric columns and calculations are never changed; call this where a value is shown or exported.
// A label is reformatted only when it consists purely of signed numbers (a single power, or a compound like "+0.25+0.50"); any other text
// is returned untouched. An explicit "+" / "-" sign and surrounding spaces are kept exactly as stored.

const NUMBER = /[+-]?\d+(?:\.\d+)?/g;
const ONLY_NUMBERS = /^\s*(?:[+-]?\d+(?:\.\d+)?\s*)+$/;

function two(token: string): string {
  const sign = token[0] === '+' || token[0] === '-' ? token[0] : '';
  const body = sign ? token.slice(1) : token;
  const [int, dec = ''] = body.split('.');
  if (dec.length <= 2) return `${sign}${int}.${dec.padEnd(2, '0')}`;     // pad only: the digits themselves are untouched
  return `${sign === '+' ? '+' : ''}${Number(token).toFixed(2)}`;        // more than 2 decimals (not expected for lenses): round for display
}

/** Format a lens power label or number for display. null/undefined -> ''. Non-numeric text is returned as is. */
export function fmtPower(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : String(v);
  return ONLY_NUMBERS.test(v) ? v.replace(NUMBER, two) : v;
}