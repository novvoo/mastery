/**
 * Centralized regex patterns for data identification and filtering.
 *
 * Usage:
 *   import { EMAIL } from '../utils/regex-patterns';
 *   text.replace(EMAIL, '<redacted>');
 *
 * Patterns are derived from well-known sources:
 *   - OWASP Validation Regex Repository
 *   - CommonRegex (https://github.com/topics/commonregex)
 *   - IETF RFC standards (email, URL)
 *   - validator.js (npm package)
 *   - regexlib.com
 *
 * Each pattern exports both base and `_G` (global flag) variants.
 * Add new patterns here instead of inlining regex in business logic.
 */

// ─── Contact Information ───────────────────────────────────────

/**
 * Email address (RFC 5322 simplified).
 * Source: OWASP Email Validation, emailregex.com
 * Matches: user@domain.com, user.name@domain.co.uk, user+tag@domain.org
 * Does not catch every valid RFC 5322 address but covers >99% of real-world use.
 */
export const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
export const EMAIL_G = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * URL with protocol (http/https).
 * Matches: http://example.com, https://a.b/c?q=1#frag
 */
export const URL_PATTERN = /https?:\/\/[^\s"'<>]+/;
export const URL_PATTERN_G = /https?:\/\/[^\s"'<>]+/g;

/**
 * International phone number (basic).
 * Matches: +1 (555) 123-4567, 021 5555 1234, 86-13800138000
 * Source: CommonRegex phone pattern, simplified.
 */
export const PHONE = /[\+]?[\d\-\(\)\s\.]{7,20}(?:ext|内线|分机)?[\d]{0,5}/i;
export const PHONE_G = /[\+]?[\d\-\(\)\s\.]{7,20}(?:ext|内线|分机)?[\d]{0,5}/gi;

// ─── Network ───────────────────────────────────────────────────

/**
 * IPv4 address.
 * Source: OWASP Validation Regex Repository
 * Matches: 192.168.1.1, 8.8.8.8, 255.255.255.0
 */
export const IPV4 =
  /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?!\d)/;
export const IPV4_G =
  /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?!\d)/g;

/**
 * IPv6 address (simplified).
 * Source: CommonRegex
 * Matches: 2001:db8::1, fe80::1, ::1
 */
export const IPV6 =
  /(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?:(?::[a-fA-F0-9]{1,4}){1,7}|:)/;
export const IPV6_G =
  /(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:|(?:[a-fA-F0-9]{1,4}:){1,6}:[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,5}(?::[a-fA-F0-9]{1,4}){1,2}|(?:[a-fA-F0-9]{1,4}:){1,4}(?::[a-fA-F0-9]{1,4}){1,3}|(?:[a-fA-F0-9]{1,4}:){1,3}(?::[a-fA-F0-9]{1,4}){1,4}|(?:[a-fA-F0-9]{1,4}:){1,2}(?::[a-fA-F0-9]{1,4}){1,5}|[a-fA-F0-9]{1,4}:(?::[a-fA-F0-9]{1,4}){1,6}|:(?:(?::[a-fA-F0-9]{1,4}){1,7}|:)/g;

/**
 * Domain name (including subdomains, no protocol).
 * Source: OWASP Validation Regex
 * Matches: example.com, sub.domain.co.uk, localhost
 */
export const DOMAIN = /(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}/;
export const DOMAIN_G = /(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}/g;

/**
 * MAC address (colon or hyphen separated).
 * Matches: 00:1A:2B:3C:4D:5E, 00-1A-2B-3C-4D-5E
 */
export const MAC_ADDRESS = /(?:[0-9A-Fa-f]{2}[:\\-]){5}[0-9A-Fa-f]{2}/;
export const MAC_ADDRESS_G = /(?:[0-9A-Fa-f]{2}[:\\-]){5}[0-9A-Fa-f]{2}/g;

// ─── Identifiers ───────────────────────────────────────────────

/**
 * UUID/GUID (8-4-4-4-12 hex format).
 * Source: CommonRegex, OWASP
 * Matches: 550e8400-e29b-41d4-a716-446655440000
 */
export const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
export const UUID_G =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * Semantic Versioning (semver).
 * Source: semver.org
 * Matches: 1.2.3, 2.0.0-beta.1, 1.0.0-alpha+001
 */
export const SEMVER = /(?:^|(?<=\s))\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?(?=\s|$|)/;
export const SEMVER_G =
  /(?:^|(?<=\s))\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?(?=\s|$|)/g;

/**
 * Hexadecimal color code.
 * Matches: #fff, #aabbcc, #123
 */
export const HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;
export const HEX_COLOR_G = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

/**
 * US Social Security Number (for PII detection).
 * Source: CommonRegex
 * Matches: 123-45-6789, 123 45 6789
 */
export const SSN = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/;
export const SSN_G = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g;

/**
 * Credit card number (major brands, simplified Luhn pattern).
 * Source: OWASP Validation Regex, CommonRegex
 * Matches: 4111-1111-1111-1111, 4111111111111111
 * Does NOT perform Luhn check — use a validation library for that.
 */
export const CREDIT_CARD = /\b(?:\d{4}[- ]?){3}\d{4}\b/;
export const CREDIT_CARD_G = /\b(?:\d{4}[- ]?){3}\d{4}\b/g;

// ─── Document Structure ────────────────────────────────────────

/**
 * Markdown code fence (opening or closing).
 * Matches: ``` ```json ```
 */
export const MD_CODE_FENCE = /```[\w]*\n?/;
export const MD_CODE_FENCE_G = /```[\w]*\n?/g;

/**
 * Markdown inline code.
 * Matches: `code`, `var x = 1`
 */
export const MD_INLINE_CODE = /`[^`]+`/;
export const MD_INLINE_CODE_G = /`[^`]+`/g;

/**
 * Markdown link.
 * Matches: [text](url), [text](url "title")
 */
export const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/;
export const MD_LINK_G = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * HTML/XML tag.
 * Matches: <div>, </div>, <br/>, <a href="...">
 */
export const HTML_TAG = /<\/?[\w]+(?:\s+[^>]*)?\/?>/;
export const HTML_TAG_G = /<\/?[\w]+(?:\s+[^>]*)?\/?>/g;

/**
 * HTML comment.
 * Matches: <!-- comment -->
 */
export const HTML_COMMENT = /<!--[\s\S]*?-->/;
export const HTML_COMMENT_G = /<!--[\s\S]*?-->/g;

/**
 * Unix file path.
 * Matches: /usr/bin/env, /home/user/file.txt, /tmp
 */
export const UNIX_PATH = /\/(?:[\w.\-+]+\/?)*/;
export const UNIX_PATH_G = /\/(?:[\w.\-+]+\/?)*/g;

/**
 * Windows file path.
 * Matches: C:\Users\user\file.txt, D:\path\
 */
export const WINDOWS_PATH = /[A-Za-z]:\\(?:[\w.\-+\\ ]+)*/;
export const WINDOWS_PATH_G = /[A-Za-z]:\\(?:[\w.\-+\\ ]+)*/g;

// ─── Temporal ──────────────────────────────────────────────────

/**
 * ISO 8601 date.
 * Source: CommonRegex
 * Matches: 2024-01-15, 2024-01-15T12:30:00Z
 */
export const ISO_DATE = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
export const ISO_DATE_G =
  /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;

/**
 * Common date formats.
 * Matches: 01/15/2024, 15/01/2024, Jan 15, 2024, 2024年1月15日
 */
export const COMMON_DATE =
  /(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2}|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}|\d{4}年\d{1,2}月\d{1,2}日)/;
export const COMMON_DATE_G =
  /(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2}|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}|\d{4}年\d{1,2}月\d{1,2}日)/g;

/**
 * Time (HH:MM:SS or HH:MM).
 * Matches: 12:30, 12:30:00, 12:30:00.123
 */
export const TIME = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b/;
export const TIME_G = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b/g;

// ─── Numeric & Finance ─────────────────────────────────────────

/**
 * Currency amount (with optional symbol).
 * Matches: $1,234.56, ¥500, €1.000, 100元
 */
export const CURRENCY =
  /[\$€£¥￥]?\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:元|円|ドル|ユーロ)/;
export const CURRENCY_G =
  /[\$€£¥￥]?\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:元|円|ドル|ユーロ)/g;

/**
 * Percentage value.
 * Matches: 12.5%, 0.5%, 100%
 */
export const PERCENTAGE = /\d+(?:\.\d+)?%/;
export const PERCENTAGE_G = /\d+(?:\.\d+)?%/g;

/**
 * Base64 encoded string (minimum 20 chars to avoid false positives).
 * Matches: base64 text blocks
 */
export const BASE64 = /(?:[A-Za-z0-9+\/]{4}){5,}(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?/;
export const BASE64_G = /(?:[A-Za-z0-9+\/]{4}){5,}(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?/g;

/**
 * JWT token (three base64url segments separated by dots).
 * Matches: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN...
 */
export const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
export const JWT_G = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
