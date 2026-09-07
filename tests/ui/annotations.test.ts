/**
 * annotations.test.ts
 * Checks the parsing of playerN URL parameters, the formatting of the
 * annotation summary line, and the resolution of the winner parameter
 */

import { describe, it, expect } from 'vitest';
import { parseCivAnnotations, annotationFor, formatAnnotationLine, resolveWinnerCivId } from '../../src/ui/annotations';

describe('parseCivAnnotations', () => {
  it('maps player0 to the first civilization', () => {
    const params = new URLSearchParams('?player0=Qwen');
    expect(parseCivAnnotations(params)).toEqual({ 0: 'Qwen' });
  });

  it('maps several players in order', () => {
    const params = new URLSearchParams('?player0=Qwen&player1=GLM');
    expect(parseCivAnnotations(params)).toEqual({ 0: 'Qwen', 1: 'GLM' });
  });

  it('ignores malformed and empty parameters', () => {
    const params = new URLSearchParams('?playerX=GPT&player2=&player3=%20%20&other=1&player4=Claude');
    expect(parseCivAnnotations(params)).toEqual({ 4: 'Claude' });
  });

  it('trims surrounding whitespace and decodes values', () => {
    const params = new URLSearchParams('?player0=%20GLM%20');
    expect(parseCivAnnotations(params)).toEqual({ 0: 'GLM' });
  });

  it('caps long labels so the header stays readable', () => {
    const params = new URLSearchParams('?player0=' + 'x'.repeat(80));
    const annotations = parseCivAnnotations(params);
    expect(annotations[0].length).toBe(40);
  });

  it('returns an empty map without player parameters', () => {
    expect(parseCivAnnotations(new URLSearchParams('?file=a&turn=5'))).toEqual({});
  });
});

describe('annotationFor', () => {
  it('returns the label for an annotated civilization', () => {
    expect(annotationFor({ 1: 'GLM' }, 1)).toBe('GLM');
  });

  it('returns null for unknown or missing ids', () => {
    expect(annotationFor({ 1: 'GLM' }, 0)).toBeNull();
    expect(annotationFor({ 1: 'GLM' }, undefined)).toBeNull();
    expect(annotationFor({}, 0)).toBeNull();
  });
});

describe('formatAnnotationLine', () => {
  it('joins annotated civilizations with their names', () => {
    const civNames = ['Rome', 'Egypt', 'Songhai'];
    const annotations = { 0: 'GLM', 1: 'Qwen' };
    expect(formatAnnotationLine(civNames, annotations)).toBe('Rome: GLM · Egypt: Qwen');
  });

  it('returns an empty string when nothing is annotated', () => {
    expect(formatAnnotationLine(['Rome'], {})).toBe('');
  });

  it('skips annotations beyond the civilization list', () => {
    expect(formatAnnotationLine(['Rome'], { 3: 'GLM' })).toBe('');
  });
});

describe('resolveWinnerCivId', () => {
  // The example game: 24 civilizations, GLM played the second one
  const civCount = 24;
  const annotations = parseCivAnnotations(new URLSearchParams('?player0=Qwen&player1=GLM'));

  it('reads a plain number as the civilization index', () => {
    expect(resolveWinnerCivId('6', annotations, civCount)).toBe(6);
    expect(resolveWinnerCivId('0', annotations, civCount)).toBe(0);
  });

  it('rejects numbers outside the civilization list', () => {
    expect(resolveWinnerCivId('24', annotations, civCount)).toBe(-1);
    expect(resolveWinnerCivId('99', annotations, civCount)).toBe(-1);
  });

  it('matches a playerN label, so winner=GLM names the civilization that player1 labeled', () => {
    expect(resolveWinnerCivId('GLM', annotations, civCount)).toBe(1);
    expect(resolveWinnerCivId('Qwen', annotations, civCount)).toBe(0);
  });

  it('rejects labels no playerN parameter carries', () => {
    expect(resolveWinnerCivId('Claude', annotations, civCount)).toBe(-1);
  });

  it('ignores an absent, empty, or blank parameter', () => {
    expect(resolveWinnerCivId(null, annotations, civCount)).toBe(-1);
    expect(resolveWinnerCivId('', annotations, civCount)).toBe(-1);
    expect(resolveWinnerCivId('   ', annotations, civCount)).toBe(-1);
  });

  it('trims surrounding whitespace like the annotations do', () => {
    expect(resolveWinnerCivId(' 6 ', annotations, civCount)).toBe(6);
    expect(resolveWinnerCivId(' GLM ', annotations, civCount)).toBe(1);
  });

  it('rejects a playerN label whose civilization is not in the loaded file', () => {
    const sparse = parseCivAnnotations(new URLSearchParams('?player30=GLM'));
    expect(resolveWinnerCivId('GLM', sparse, civCount)).toBe(-1);
  });
});
