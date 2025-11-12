/**
 * parser.types.ts
 * Type definitions for binary parser
 */

// Item configuration for parser
export interface ItemConfig {
  type: string;
  length?: number;
  value?: unknown;
  items?: ItemConfig | Record<string, ItemConfig | string | Function>;
}

// Parser result
export interface ParseResult {
  value?: unknown;
  items?: unknown[];
}

// Binary parser configuration - simplified to avoid circular reference
export type ParserConfig = string | ItemConfig | Function;

// Array configuration for parser
export interface ArrayConfig {
  type: 'array';
  items: ParserConfig;
}

// Byte configuration
export interface ByteConfig {
  type: 'byte';
  length: number;
}

// String configuration
export interface StringConfig {
  type: 'str';
  length: number;
}