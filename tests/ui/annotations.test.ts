/**
 * annotations.test.ts
 * Checks the parsing of playerN URL parameters and the formatting of the
 * annotation summary line
 */

import { describe, it, expect } from 'vitest';
import { parseCivAnnotations, annotationFor, formatAnnotationLine } from '../../src/ui/annotations';

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
