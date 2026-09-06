/**
 * types.ts
 * Type definitions for the binary parser
 */

// Config for a single schema entry
export interface ItemConfig {
  type: string;           // Data type to parse (e.g., 'int32', 'str', 'byte', 'array')
  length?: number;        // Length for strings and byte blobs
  value?: unknown;        // Fixed value (e.g., the terminator for 'until')
  items?: ParserConfig;   // Nested items for array types
}

// A single schema entry: a type name, a config object, a nested schema, or a custom function
export type ParserConfig = string | ItemConfig | FileConfig | Function;

// Schema for a whole file (or a nested record): named fields parsed in order
export interface FileConfig {
  [key: string]: ParserConfig;
}
