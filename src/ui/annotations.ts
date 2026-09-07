/**
 * annotations.ts
 * Civilization annotations supplied through the address bar
 *
 * A shared link can label each civilization with who was playing it, for
 * example "?player0=Qwen&player1=GLM". Player numbering starts at zero, so
 * player0 annotates the first civilization in the file, player1 the second,
 * and so on. The annotations appear next to civilization names in the event
 * log and as a summary line in the header.
 *
 * The same family carries the winner parameter, which asserts who won a
 * game whose file cannot prove the result, for example a save taken one
 * turn before the game was won.
 */

// Annotations by civilization id, parsed from the playerN URL parameters
export type CivAnnotations = Record<number, string>;

// Matches playerN URL parameters, capturing the civilization id N
const playerParamPattern = /^player(\d+)$/;

// Longest annotation we accept, so headers and log entries stay readable
const maxAnnotationLength = 40;

/**
 * Parse playerN parameters (player0, player1, ...) into a civ id to label map
 * @param params The URL search parameters to read from
 * @returns The parsed annotations, empty when none are present
 */
export function parseCivAnnotations(params: URLSearchParams): CivAnnotations {
  const annotations: CivAnnotations = {};

  params.forEach((value, key) => {
    const match = playerParamPattern.exec(key);
    if (!match) {
      return;
    }

    // URLSearchParams already decodes the value; trim and cap its length
    const label = value.trim().slice(0, maxAnnotationLength);
    if (!label) {
      return;
    }

    annotations[Number(match[1])] = label;
  });

  return annotations;
}

/**
 * Look up the annotation for a civilization id
 * @param annotations The parsed annotations
 * @param civId The civilization id to look up
 * @returns The annotation, or null when the civilization has none
 */
export function annotationFor(annotations: CivAnnotations, civId?: number): string | null {
  if (civId === undefined || !(civId in annotations)) {
    return null;
  }
  return annotations[civId];
}

/**
 * Build the header summary line, for example "Rome: GLM · Egypt: Qwen"
 * @param civNames Civilization names indexed by civilization id
 * @param annotations The parsed annotations
 * @returns The joined line, empty when no civilization is annotated
 */
export function formatAnnotationLine(civNames: string[], annotations: CivAnnotations): string {
  const parts: string[] = [];

  for (let civId = 0; civId < civNames.length; civId++) {
    const label = annotations[civId];
    if (label) {
      parts.push(`${civNames[civId]}: ${label}`);
    }
  }

  return parts.join(' · ');
}

/**
 * Resolve the winner parameter to a civilization id
 * A plain number is the civilization index, numbered like the playerN
 * parameters (player0 annotates civilization 0, so winner=0 names the same
 * civilization). Anything else is matched against those annotations, so
 * "winner=GLM" names the civilization that a playerN parameter labeled GLM
 * @param raw The winner parameter value, null when the link carries none
 * @param annotations The parsed playerN annotations
 * @param civCount The number of civilizations in the loaded file
 * @returns The civilization id, or -1 when the parameter is absent or names
 * no civilization of the loaded file
 */
export function resolveWinnerCivId(raw: string | null, annotations: CivAnnotations, civCount: number): number {
  if (raw === null) {
    return -1;
  }

  const value = raw.trim().slice(0, maxAnnotationLength);
  if (!value) {
    return -1;
  }

  // A plain number addresses the civilization directly
  if (/^\d+$/.test(value)) {
    const civId = parseInt(value, 10);
    return civId >= 0 && civId < civCount ? civId : -1;
  }

  // Anything else must be one of the playerN labels
  for (const civId of Object.keys(annotations)) {
    const id = Number(civId);
    if (id < civCount && annotations[id] === value) {
      return id;
    }
  }
  return -1;
}
