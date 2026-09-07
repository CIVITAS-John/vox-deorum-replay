/**
 * strategy-parser.ts
 * Parses strategy change events and formats them for display
 */

export interface StrategyChange {
	key: string;
	from: string;
	to: string;
}

export interface ParsedStrategyEvent {
	type: string;
	/** Event level title, e.g. "AI preferences", present when the text is a titled list of changes */
	label?: string;
	changes: StrategyChange[];
	rationale: string | null;
}

/**
 * Configuration for parsing different patterns
 */
interface PatternConfig {
	/** Unique identifier for this pattern type */
	type: string;
	/** The prefix to match at the start of the text */
	prefix: string;
	/** Display label for the change (used in simple patterns) */
	displayLabel?: string;
	/** Whether this is a complex pattern with multiple changes */
	isComplex?: boolean;
}

/**
 * Configurable patterns for different strategy change types
 * Add new patterns here to support additional event types
 */
const PATTERN_CONFIGS: PatternConfig[] = [
	{
		type: 'strategies',
		prefix: 'Changed strategies:',
		isComplex: true
	},
	{
		type: 'persona',
		prefix: 'Changed persona values:',
		isComplex: true
	},
	{
		type: 'research',
		prefix: 'Changed next research:',
		displayLabel: 'Next Research'
	},
	{
		type: 'policy_branch',
		prefix: 'Changed next policy branch:',
		displayLabel: 'Next Policy Branch'
	},
	{
		type: 'policy',
		prefix: 'Changed next policy:',
		displayLabel: 'Next Policy'
	}
];

/**
 * Parse rationale from text
 * Extracts the rationale portion after "Rationale:" marker
 */
function parseRationale(text: string): { mainText: string; rationale: string | null } {
	const rationaleMatch = text.match(/\.\s*Rationale:\s*(.+?)$/);

	if (rationaleMatch) {
		const mainText = text.substring(0, rationaleMatch.index);
		const rationale = rationaleMatch[1].trim();
		return { mainText, rationale };
	}

	return { mainText: text, rationale: null };
}

/**
 * Parse complex strategy changes from the main text
 * Handles format: "GrandStrategy: None → Conquest; EconomicStrategies: [None] → [EarlyExpansion]"
 */
function parseComplexChanges(text: string): StrategyChange[] {
	const changes: StrategyChange[] = [];

	// Split by semicolon to get individual strategy changes
	const parts = text.split(';');

	for (const part of parts) {
		const colonIndex = part.indexOf(':');
		if (colonIndex === -1) continue;

		const key = part.substring(0, colonIndex).trim();
		const values = part.substring(colonIndex + 1).trim();

		// Look for arrow
		const arrowMatch = values.match(/(.+?)\s*→\s*(.+)/);
		if (arrowMatch) {
			changes.push({
				key: key,
				from: arrowMatch[1].trim(),
				to: arrowMatch[2].trim()
			});
		}
	}

	return changes;
}

/**
 * Parse keyless changes from the main text
 * Handles titled lists where each part carries its own metric name before the
 * arrow, e.g. "CityDefense: 82 → 85; Mobilization: 65 → 60"
 */
function parseKeylessChanges(text: string): StrategyChange[] {
	const changes: StrategyChange[] = [];

	// Split by semicolon to get individual changes
	const parts = text.split(';');

	for (const part of parts) {
		const arrowMatch = part.trim().match(/(.+?)\s*→\s*(.+)/);

		if (arrowMatch) {
			changes.push({
				key: '',
				from: arrowMatch[1].trim(),
				to: arrowMatch[2].trim()
			});
		}
	}

	return changes;
}

/**
 * Count the colons before the first arrow in one semicolon separated part
 */
function colonsBeforeArrow(part: string): number {
	const arrowIndex = part.indexOf('→');
	const head = arrowIndex === -1 ? part : part.substring(0, arrowIndex);
	return head.split(':').length - 1;
}

/**
 * Check whether a text is a titled list of changes, e.g.
 * "AI preferences: CityDefense: 82 → 85; Mobilization: 65 → 60"
 * A text is titled when the first part carries a title plus a metric name
 * (two colons before the arrow), or when a later part has no colon at all
 * (its metric name rides along in the from value, like "Private -15 → 0")
 */
function isTitledChanges(text: string): boolean {
	const parts = text.split(';');

	if (colonsBeforeArrow(parts[0]) >= 2) {
		return true;
	}

	return parts.slice(1).some(part => colonsBeforeArrow(part) === 0);
}

/**
 * Parse a simple change
 * Handles format: "None → Pottery" or "None → Tradition"
 */
function parseSimpleChange(text: string, displayLabel: string): StrategyChange[] {
	const arrowMatch = text.match(/(.+?)\s*→\s*(.+)/);

	if (arrowMatch) {
		return [{
			key: displayLabel,
			from: arrowMatch[1].trim(),
			to: arrowMatch[2].trim()
		}];
	}

	return [];
}

/**
 * Parse strategy event text containing arrow notation
 * Returns null if the text doesn't match expected patterns
 */
export function parseStrategyEvent(text: string): ParsedStrategyEvent | null {
	// Check if text contains arrow notation
	if (!text.includes('→')) {
		return null;
	}

	// First, extract rationale if present
	const { mainText, rationale } = parseRationale(text);

	// Try each configured pattern
	for (const config of PATTERN_CONFIGS) {
		if (mainText.startsWith(config.prefix)) {
			const contentText = mainText.substring(config.prefix.length).trim();

			let changes: StrategyChange[];

			if (config.isComplex) {
				// Complex pattern with multiple possible changes
				changes = parseComplexChanges(contentText);
			} else {
				// Simple pattern with single change
				changes = parseSimpleChange(contentText, config.displayLabel!);
			}

			if (changes.length > 0) {
				return {
					type: config.type,
					changes,
					rationale
				};
			}
		}
	}

	// Fallback: try to parse as generic strategy changes if it has colons and arrows
	if (mainText.includes(':') && mainText.includes('→')) {
		// Titled texts lead with an event level label, e.g. "AI preferences: ..."
		if (isTitledChanges(mainText)) {
			const colonIndex = mainText.indexOf(':');
			const label = mainText.substring(0, colonIndex).trim();
			const contentText = mainText.substring(colonIndex + 1).trim();

			const titledChanges = parseKeylessChanges(contentText);

			if (titledChanges.length > 0 && label) {
				return {
					type: 'other',
					label: label,
					changes: titledChanges,
					rationale
				};
			}
		}

		const changes = parseComplexChanges(mainText);

		if (changes.length > 0) {
			return {
				type: 'other',
				changes,
				rationale
			};
		}
	}

	return null;
}

/**
 * Create DOM elements for a parsed strategy event
 */
export function renderStrategyEvent(parsed: ParsedStrategyEvent): HTMLElement {
	const container = document.createElement('div');
	container.className = 'strategy-change';

	// Render the event level title, e.g. "AI preferences"
	if (parsed.label) {
		const headerEl = document.createElement('div');
		headerEl.className = 'strategy-key strategy-header';
		headerEl.textContent = parsed.label + ':';
		container.appendChild(headerEl);
	}

	// Render each change
	parsed.changes.forEach(change => {
		const item = document.createElement('div');
		item.className = 'strategy-change-item';

		// Key (titled events keep the metric name inside the from value instead)
		if (change.key) {
			const keyEl = document.createElement('span');
			keyEl.className = 'strategy-key';
			keyEl.textContent = change.key + ':';
			item.appendChild(keyEl);
		}

		// From value
		const fromEl = document.createElement('span');
		fromEl.className = 'strategy-from';
		fromEl.textContent = change.from;
		item.appendChild(fromEl);

		// Arrow
		const arrowEl = document.createElement('span');
		arrowEl.className = 'strategy-arrow';
		arrowEl.textContent = '→';
		item.appendChild(arrowEl);

		// To value
		const toEl = document.createElement('span');
		toEl.className = 'strategy-to';
		toEl.textContent = change.to;
		item.appendChild(toEl);

		container.appendChild(item);
	});

	// Render rationale if present
	if (parsed.rationale) {
		const rationaleEl = document.createElement('div');
		rationaleEl.className = 'strategy-rationale';

		const label = document.createElement('span');
		label.className = 'rationale-label';
		label.textContent = 'Rationale: ';
		rationaleEl.appendChild(label);

		const text = document.createElement('span');
		text.textContent = parsed.rationale;
		rationaleEl.appendChild(text);

		container.appendChild(rationaleEl);
	}

	return container;
}

/**
 * Add a new pattern configuration at runtime
 * Useful for extending the parser without modifying the source
 */
export function addPatternConfig(config: PatternConfig): void {
	PATTERN_CONFIGS.push(config);
}

/**
 * Get all configured patterns
 * Useful for debugging or displaying supported patterns
 */
export function getPatternConfigs(): ReadonlyArray<PatternConfig> {
	return PATTERN_CONFIGS;
}