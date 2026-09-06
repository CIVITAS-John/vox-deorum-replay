/**
 * arrays.ts
 * Array helpers shared across the app
 */

/**
 * Split an array into fixed-size chunks, with the last chunk taking the remainder
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

/**
 * Binary search for the last item whose turn is at or before the given turn
 * The items must be sorted by turn
 */
export function lastAtOrBefore<T extends { turn: number }>(items: T[], turn: number): T | undefined {
  let low = 0;
  let high = items.length - 1;
  let found: T | undefined;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (items[mid].turn <= turn) {
      found = items[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}
