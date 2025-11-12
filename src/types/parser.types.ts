/**
 * parser.types.ts
 * Type definitions for binary parser
 */

// Item configuration for parser
export interface ItemConfig {
  type: string;                                                     // Data type to parse (e.g., 'int', 'str', 'byte', 'array')
  length?: number;                                                  // Length for strings/bytes
  value?: unknown;                                                  // Fixed value or default
  items?: ItemConfig | Record<string, ItemConfig | string | Function>;  // Nested items for complex types
}

// Parser result
export interface ParseResult {
  value?: unknown;                                                  // Parsed value for simple types
  items?: unknown[];                                                // Array of parsed items for array types
}

// Binary parser configuration - simplified to avoid circular reference
export type ParserConfig = string | ItemConfig | Function;         // Parser config can be type string, config object, or custom function

// Array configuration for parser
export interface ArrayConfig {
  type: 'array';                                                    // Array type indicator
  items: ParserConfig;                                              // Configuration for each array item
}

// Byte configuration
export interface ByteConfig {
  type: 'byte';                                                     // Byte array type
  length: number;                                                   // Number of bytes to read
}

// String configuration
export interface StringConfig {
  type: 'str';                                                      // String type
  length: number;                                                   // String length in bytes
}