/**
 * hex-border-utils.ts
 * Utility functions for calculating hex border properties
 */

/**
 * Calculate the appropriate line width for a hex border based on hex size
 * Uses the hex width to determine a proportional line width that scales properly with zoom
 *
 * @param hexWidth - The width of the hex (typically x2 - x1)
 * @param maxWidth - Maximum line width to use (default: 4)
 * @param scaleFactor - Scale factor for the calculation (default: 0.5)
 * @returns The calculated line width
 */
export function calculateHexBorderWidth(
	hexWidth: number,
	maxWidth: number = 4,
	scaleFactor: number = 0.5
): number {
	// Calculate proportional width based on hex size
	// Using square root provides better scaling across different zoom levels
	const proportionalWidth = Math.sqrt(hexWidth) * scaleFactor;

	// Cap at maximum width to prevent borders from becoming too thick
	return Math.min(maxWidth, proportionalWidth);
}

/**
 * Calculate text outline width for hex labels based on hex size
 * Similar to border width but typically smaller for better readability
 *
 * @param hexWidth - The width of the hex
 * @param maxWidth - Maximum outline width (default: 3)
 * @param scaleFactor - Scale factor for the calculation (default: 0.5)
 * @returns The calculated outline width
 */
export function calculateTextOutlineWidth(
	hexWidth: number,
	maxWidth: number = 3,
	scaleFactor: number = 0.5
): number {
	return calculateHexBorderWidth(hexWidth, maxWidth, scaleFactor);
}