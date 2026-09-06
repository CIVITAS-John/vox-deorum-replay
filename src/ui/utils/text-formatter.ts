/**
 * text-formatter.ts
 * Formats game text with icons and colors
 * Converts game-specific markup to HTML with Font Awesome icons and styled spans
 */

/**
 * Mapping of game icons to Font Awesome icon classes (v4.4.0)
 * Based on Civilization V icon conventions
 */
const ICON_MAP: Record<string, string> = {
	// Resources and Yields
	'ICON_FOOD': 'fa-leaf',
	'ICON_PRODUCTION': 'fa-cog',
	'ICON_GOLD': 'fa-circle',  // Will style as gold coin
	'ICON_RESEARCH': 'fa-flask',
	'ICON_SCIENCE': 'fa-flask',
	'ICON_CULTURE': 'fa-music',
	'ICON_PEACE': 'fa-dove',  // Faith/Religion icon
	'ICON_FAITH': 'fa-star',
	'ICON_HAPPINESS': 'fa-smile-o',
	'ICON_HAPPINESS_1': 'fa-smile-o',
	'ICON_HAPPINESS_2': 'fa-smile-o',
	'ICON_HAPPINESS_3': 'fa-smile-o',
	'ICON_HAPPINESS_4': 'fa-smile-o',
	'ICON_UNHAPPY': 'fa-frown-o',
	'ICON_GOLDEN_AGE': 'fa-sun',
	'ICON_GREAT_PEOPLE': 'fa-user',
	'ICON_GREAT_PERSON': 'fa-user',
	'ICON_TOURISM': 'fa-suitcase',
	'ICON_INFLUENCE': 'fa-star-o',

	// Military
	'ICON_STRENGTH': 'fa-shield',
	'ICON_RANGED_STRENGTH': 'fa-crosshairs',
	'ICON_MOVES': 'fa-arrows',
	'ICON_MOVEMENT': 'fa-arrows',
	'ICON_HP': 'fa-heart',

	// City and Territory
	'ICON_CITIZEN': 'fa-user',
	'ICON_CAPITAL': 'fa-star',  // Capital star
	'ICON_CITY': 'fa-building-o',
	'ICON_OCCUPIED': 'fa-flag',
	'ICON_BLOCKADED': 'fa-ban',
	'ICON_POPULATION': 'fa-users',

	// Trade and Diplomacy
	'ICON_TRADE': 'fa-exchange',
	'ICON_TRADE_ROUTE': 'fa-road',
	'ICON_INTERNATIONAL_TRADE': 'fa-globe',
	'ICON_CARGO_SHIP': 'fa-ship',
	'ICON_CARAVAN': 'fa-truck',

	// Units
	'ICON_WORKER': 'fa-wrench',
	'ICON_SPY': 'fa-user-secret',
	'ICON_MISSIONARY': 'fa-book',
	'ICON_GREAT_GENERAL': 'fa-star',
	'ICON_GREAT_ADMIRAL': 'fa-anchor',

	// Improvements and Buildings
	'ICON_GREAT_WORK': 'fa-picture-o',
	'ICON_ARTIFACT': 'fa-archive',
	'ICON_WONDER': 'fa-university',

	// Default fallback
	'DEFAULT': 'fa-circle-o'
};

/**
 * Color definitions for text styling
 */
const COLOR_MAP: Record<string, string> = {
	// Positive/Negative
	'COLOR_POSITIVE_TEXT': '#4CAF50',
	'COLOR_NEGATIVE_TEXT': '#F44336',
	'COLOR_WARNING_TEXT': '#FF9800',
	'COLOR_HIGHLIGHT_TEXT': '#FFD700',

	// Player colors
	'COLOR_PLAYER_BLUE_TEXT': '#2196F3',
	'COLOR_PLAYER_RED_TEXT': '#FF5252',
	'COLOR_PLAYER_GREEN_TEXT': '#66BB6A',
	'COLOR_PLAYER_YELLOW_TEXT': '#FFC107',
	'COLOR_PLAYER_PURPLE_TEXT': '#9C27B0',
	'COLOR_PLAYER_CYAN_TEXT': '#00BCD4',
	'COLOR_PLAYER_ORANGE_TEXT': '#FF9800',
	'COLOR_PLAYER_PINK_TEXT': '#E91E63',

	// Yield-specific colors
	'COLOR_YIELD_FOOD': '#8BC34A',
	'COLOR_YIELD_GOLD': '#FFC107',
	'COLOR_YIELD_PRODUCTION': '#FF9800',
	'COLOR_YIELD_SCIENCE': '#00BCD4',
	'COLOR_YIELD_CULTURE': '#9C27B0',
	'COLOR_YIELD_FAITH': '#FFFFC8',

	// Basic colors
	'COLOR_WHITE': '#FFFFFF',
	'COLOR_BLACK': '#000000',
	'COLOR_GREEN': '#4CAF50',
	'COLOR_RED': '#F44336',
	'COLOR_BLUE': '#2196F3',
	'COLOR_YELLOW': '#FFC107',

	// Game-specific colors (legacy)
	'COLOR_SCIENCE_TEXT': '#00BCD4',
	'COLOR_CULTURE_TEXT': '#9C27B0',
	'COLOR_GOLD_TEXT': '#FFC107',
	'COLOR_FAITH_TEXT': '#FFFFC8',
	'COLOR_PRODUCTION_TEXT': '#FF9800',
	'COLOR_FOOD_TEXT': '#8BC34A',

	// Default
	'COLOR_DEFAULT': '#FFFFC8'
};

/**
 * Parse and format text with game markup
 * Converts [ICON_XXX], [COLOR_XXX]...[ENDCOLOR], and other markup to HTML
 */
export function formatGameText(text: string): HTMLElement {
	const container = document.createElement('div');
	container.className = 'formatted-text';

	// Process the text in segments
	let remaining = text;
	let currentParent = container;

	while (remaining.length > 0) {
		// Check for color tags
		const colorMatch = remaining.match(/\[([A-Z_]+)\](.*?)\[END\1\]/);
		if (colorMatch && remaining.indexOf(colorMatch[0]) === 0) {
			const [fullMatch, colorTag, content] = colorMatch;

			// Create colored span
			const coloredSpan = document.createElement('span');
			coloredSpan.className = 'colored-text';
			const color = COLOR_MAP[colorTag] || COLOR_MAP['COLOR_DEFAULT'];
			coloredSpan.style.color = color;

			// Process content within color tags for icons
			processTextSegment(content, coloredSpan);
			currentParent.appendChild(coloredSpan);

			remaining = remaining.substring(fullMatch.length);
			continue;
		}

		// Alternative color format: [COLOR_XXX]...[ENDCOLOR]
		const altColorMatch = remaining.match(/\[(COLOR_[A-Z_]+)\](.*?)\[ENDCOLOR\]/);
		if (altColorMatch && remaining.indexOf(altColorMatch[0]) === 0) {
			const [fullMatch, colorTag, content] = altColorMatch;

			// Create colored span
			const coloredSpan = document.createElement('span');
			coloredSpan.className = 'colored-text';
			const color = COLOR_MAP[colorTag] || COLOR_MAP['COLOR_DEFAULT'];
			coloredSpan.style.color = color;

			// Process content within color tags for icons
			processTextSegment(content, coloredSpan);
			currentParent.appendChild(coloredSpan);

			remaining = remaining.substring(fullMatch.length);
			continue;
		}

		// Check for icon tags
		const iconMatch = remaining.match(/\[(ICON_[A-Z_0-9]+)\]/);
		if (iconMatch && remaining.indexOf(iconMatch[0]) === 0) {
			const [fullMatch, iconTag] = iconMatch;

			// Create icon element
			const icon = createIconElement(iconTag);
			currentParent.appendChild(icon);

			remaining = remaining.substring(fullMatch.length);
			continue;
		}

		// Find next special tag
		const nextIconIndex = remaining.search(/\[ICON_[A-Z_0-9]+\]/);
		const nextColorIndex = remaining.search(/\[(COLOR_[A-Z_]+|[A-Z_]+)\]/);

		let nextSpecialIndex = -1;
		if (nextIconIndex >= 0 && nextColorIndex >= 0) {
			nextSpecialIndex = Math.min(nextIconIndex, nextColorIndex);
		} else if (nextIconIndex >= 0) {
			nextSpecialIndex = nextIconIndex;
		} else if (nextColorIndex >= 0) {
			nextSpecialIndex = nextColorIndex;
		}

		// Add plain text up to next special tag
		if (nextSpecialIndex > 0) {
			const textNode = document.createTextNode(remaining.substring(0, nextSpecialIndex));
			currentParent.appendChild(textNode);
			remaining = remaining.substring(nextSpecialIndex);
		} else if (nextSpecialIndex === -1) {
			// No more special tags, add rest as text
			const textNode = document.createTextNode(remaining);
			currentParent.appendChild(textNode);
			remaining = '';
		} else {
			// Should not reach here, but handle edge case
			remaining = remaining.substring(1);
		}
	}

	return container;
}

/**
 * Process a text segment for icons only (used within colored spans)
 */
function processTextSegment(text: string, parent: HTMLElement): void {
	let remaining = text;

	while (remaining.length > 0) {
		const iconMatch = remaining.match(/\[(ICON_[A-Z_0-9]+)\]/);

		if (iconMatch && remaining.indexOf(iconMatch[0]) === 0) {
			const [fullMatch, iconTag] = iconMatch;

			// Create icon element
			const icon = createIconElement(iconTag);
			parent.appendChild(icon);

			remaining = remaining.substring(fullMatch.length);
		} else {
			// Find next icon
			const nextIconIndex = remaining.search(/\[ICON_[A-Z_0-9]+\]/);

			if (nextIconIndex > 0) {
				const textNode = document.createTextNode(remaining.substring(0, nextIconIndex));
				parent.appendChild(textNode);
				remaining = remaining.substring(nextIconIndex);
			} else {
				// No more icons, add rest as text
				const textNode = document.createTextNode(remaining);
				parent.appendChild(textNode);
				remaining = '';
			}
		}
	}
}

/**
 * Create an icon element for a given icon tag
 */
function createIconElement(iconTag: string): HTMLElement {
	const iconClass = ICON_MAP[iconTag] || ICON_MAP['DEFAULT'];

	const icon = document.createElement('i');
	icon.className = `fa ${iconClass} game-icon`;
	icon.setAttribute('aria-label', iconTag.replace('ICON_', '').toLowerCase().replace(/_/g, ' '));
	icon.setAttribute('title', iconTag.replace('ICON_', '').replace(/_/g, ' ').toLowerCase());

	// Add specific styling based on icon type
	if (iconTag === 'ICON_GOLD') {
		icon.style.color = '#FFC107';
	} else if (iconTag === 'ICON_SCIENCE' || iconTag === 'ICON_RESEARCH') {
		icon.style.color = '#00BCD4';
	} else if (iconTag === 'ICON_CULTURE') {
		icon.style.color = '#9C27B0';
	} else if (iconTag === 'ICON_FAITH' || iconTag === 'ICON_PEACE') {
		icon.style.color = '#FFFFC8';
	} else if (iconTag === 'ICON_PRODUCTION') {
		icon.style.color = '#FF9800';
	} else if (iconTag === 'ICON_FOOD') {
		icon.style.color = '#8BC34A';
	} else if (iconTag.includes('ICON_HAPPINESS')) {
		icon.style.color = '#FFD700';
	} else if (iconTag === 'ICON_UNHAPPY') {
		icon.style.color = '#F44336';
	} else if (iconTag === 'ICON_GOLDEN_AGE') {
		icon.style.color = '#FFD700';
	}

	return icon;
}

/**
 * Check if text contains game markup
 */
export function hasGameMarkup(text: string): boolean {
	return /\[(ICON_[A-Z_0-9]+|COLOR_[A-Z_]+|ENDCOLOR)\]/.test(text);
}