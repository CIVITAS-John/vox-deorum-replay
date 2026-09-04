/**
 * civ-names.ts
 * Derives human readable civilization names from the database type strings
 * stored in save files. Replay files carry localized display names, but
 * saves only carry type keys like CIVILIZATION_ARABIA or MINOR_CIV_KABUL,
 * so the display names are rebuilt from the key with a small override
 * table for the names that do not follow mechanically.
 */

// Overrides for names that cannot be derived by title casing the type key.
// The articles ("The Zulus") match the names the game itself uses, and the
// renamings match the current localization ("Kyiv").
const civNameOverrides: Record<string, string> = {
  AZTEC: 'The Aztecs',
  CELTS: 'The Celts',
  HUNS: 'The Huns',
  INCA: 'The Inca',
  IROQUOIS: 'The Iroquois',
  KIEV: 'Kyiv',
  MAYA: 'The Maya',
  NETHERLANDS: 'The Netherlands',
  OTTOMANS: 'The Ottomans',
  SHOSHONE: 'The Shoshone',
  ZULU: 'The Zulus'
};

/**
 * Convert a civilization type key to its display name
 * @param type The type key, e.g. CIVILIZATION_ARABIA or MINOR_CIV_BAN_CHIANG
 * @returns The display name, e.g. "Arabia" or "Ban Chiang"
 */
export function getCivNameFromType(type: string): string {
  const stripped = type.replace(/^(CIVILIZATION_|MINOR_CIV_)/, '');

  if (civNameOverrides[stripped]) {
    return civNameOverrides[stripped];
  }

  // Title case each underscore separated word
  return stripped
    .split('_')
    .filter(word => word.length > 0)
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
