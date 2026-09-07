/**
 * strategy-parser.test.ts
 * Checks the parsing of inline change events: titled lists (AI preferences,
 * Diplomatic persona, civ opinions), keyed fallbacks, and simple patterns
 */

import { describe, it, expect } from 'vitest';
import { parseStrategyEvent } from '../../src/ui/utils/strategy-parser';

describe('parseStrategyEvent', () => {
	it('parses a multi change AI preferences event into a label and keyless changes', () => {
		const parsed = parseStrategyEvent(
			'AI preferences: CityDefense: 82 → 85; Mobilization: 65 → 60; Mobile: 30 → 40. Rationale: Shift toward defense.'
		);

		expect(parsed).toEqual({
			type: 'other',
			label: 'AI preferences',
			changes: [
				{ key: '', from: 'CityDefense: 82', to: '85' },
				{ key: '', from: 'Mobilization: 65', to: '60' },
				{ key: '', from: 'Mobile: 30', to: '40' }
			],
			rationale: 'Shift toward defense.'
		});
	});

	it('keeps a two word metric name inside the from value', () => {
		const parsed = parseStrategyEvent(
			'AI preferences: Grand Strategy: Conquest → Domination. Rationale: Commit to conquest.'
		);

		expect(parsed?.label).toBe('AI preferences');
		expect(parsed?.changes).toEqual([
			{ key: '', from: 'Grand Strategy: Conquest', to: 'Domination' }
		]);
	});

	it('parses a Diplomatic persona event into a label and keyless changes', () => {
		const parsed = parseStrategyEvent(
			'Diplomatic persona: Boldness: 3 → 2; WarBias: 2 → 1; Chattiness: 7 → 8. Rationale: Stay calm.'
		);

		expect(parsed?.label).toBe('Diplomatic persona');
		expect(parsed?.changes).toEqual([
			{ key: '', from: 'Boldness: 3', to: '2' },
			{ key: '', from: 'WarBias: 2', to: '1' },
			{ key: '', from: 'Chattiness: 7', to: '8' }
		]);
	});

	it('parses a multi part civ opinion event into a label and keyless changes', () => {
		const parsed = parseStrategyEvent(
			'The Zulus: Public -10 → 5; Private -15 → 0. Rationale: The Zulus are still distrustful.'
		);

		expect(parsed?.label).toBe('The Zulus');
		expect(parsed?.changes).toEqual([
			{ key: '', from: 'Public -10', to: '5' },
			{ key: '', from: 'Private -15', to: '0' }
		]);
	});

	it('parses a single part civ opinion event as a keyed change without a label', () => {
		const parsed = parseStrategyEvent(
			'Arabia: Private 95 → 100. Rationale: Arabia is a declared friend.'
		);

		expect(parsed?.label).toBeUndefined();
		expect(parsed?.changes).toEqual([
			{ key: 'Arabia', from: 'Private 95', to: '100' }
		]);
	});

	it('keeps the keyed fallback for untitled change lists', () => {
		const parsed = parseStrategyEvent(
			'GrandStrategy: None → Conquest; EconomicStrategies: None → EarlyExpansion. Rationale: Expand.'
		);

		expect(parsed?.label).toBeUndefined();
		expect(parsed?.changes).toEqual([
			{ key: 'GrandStrategy', from: 'None', to: 'Conquest' },
			{ key: 'EconomicStrategies', from: 'None', to: 'EarlyExpansion' }
		]);
	});

	it('keeps the configured simple pattern for research changes', () => {
		const parsed = parseStrategyEvent(
			'Changed next research: None → Pottery. Rationale: Need pottery.'
		);

		expect(parsed).toEqual({
			type: 'research',
			changes: [{ key: 'Next Research', from: 'None', to: 'Pottery' }],
			rationale: 'Need pottery.'
		});
	});

	it('accepts titled events without a rationale', () => {
		const parsed = parseStrategyEvent('AI preferences: Culture: 60 → 70');

		expect(parsed).toEqual({
			type: 'other',
			label: 'AI preferences',
			changes: [{ key: '', from: 'Culture: 60', to: '70' }],
			rationale: null
		});
	});

	it('returns null for text without arrow notation', () => {
		expect(parseStrategyEvent('AI preferences: No changes. Rationale: Nothing to do.')).toBeNull();
	});
});
