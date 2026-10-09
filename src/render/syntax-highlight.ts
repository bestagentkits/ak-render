/**
 * Compile-time syntax highlighting for code blocks.
 *
 * Each grammar is a small table read by one scanner, so highlighting stays
 * deterministic, needs no dependency and costs nothing at runtime. A token is a
 * `<span class="ak-tk-…">` whose colour comes from theme tokens in the `syntax`
 * feature sheet. An unknown language renders as plain text, as before.
 */

import { escapeText } from './escape.js';

type TokenKind =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'type'
  | 'function'
  | 'variable'
  | 'attribute'
  | 'inserted'
  | 'deleted'
  | 'hunk'
  | 'meta';

const TOKEN_CLASS: Readonly<Record<TokenKind, string>> = {
  keyword: 'ak-tk-k',
  string: 'ak-tk-s',
  number: 'ak-tk-n',
  comment: 'ak-tk-c',
  type: 'ak-tk-t',
  function: 'ak-tk-f',
  variable: 'ak-tk-v',
  attribute: 'ak-tk-a',
  inserted: 'ak-tk-ins',
  deleted: 'ak-tk-del',
  hunk: 'ak-tk-hunk',
  meta: 'ak-tk-meta',
};

interface Token {
  readonly kind: TokenKind | null;
  readonly text: string;
}

interface Grammar {
  readonly keywords: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
  readonly caseInsensitive?: boolean;
  readonly lineComments: readonly string[];
  readonly blockComments: readonly (readonly [open: string, close: string])[];
  /** String delimiters, longest first. Only multi-character and backtick delimiters span lines. */
  readonly strings: readonly string[];
  /** `$name` (and `${name}`) is a variable. */
  readonly dollarVariables?: boolean;
  /** `@name` is an annotation or decorator. */
  readonly atAttributes?: boolean;
  /** `#[...]` is an attribute. */
  readonly hashAttributes?: boolean;
  /** A capitalized identifier is a type. */
  readonly capitalizedTypes?: boolean;
  /** An identifier or string followed by `:` is a key, as in JSON and YAML. */
  readonly keysBeforeColon?: boolean;
  /** Literal markers highlighted as keywords, such as `<?php`. */
  readonly markers?: readonly string[];
  readonly identifier?: RegExp;
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '));

const C_COMMENTS = { lineComments: ['//'], blockComments: [['/*', '*/']] as const };

const JS_KEYWORDS =
  'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface keyof let namespace new of private protected public readonly return satisfies set static super switch this throw try type typeof var void while with yield';

const GRAMMARS: Readonly<Record<string, Grammar>> = {
  php: {
    keywords: words(
      'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or parent print private protected public readonly require require_once return self static switch throw trait try unset use var while xor yield int float bool string void mixed never object iterable',
    ),
    literals: words('true false null'),
    caseInsensitive: true,
    lineComments: ['//', '#'],
    blockComments: [['/*', '*/']],
    strings: ['"', "'"],
    dollarVariables: true,
    hashAttributes: true,
    capitalizedTypes: true,
    markers: ['<?php', '?>'],
  },
  javascript: {
    keywords: words(JS_KEYWORDS),
    literals: words('true false null undefined NaN Infinity'),
    ...C_COMMENTS,
    strings: ['"', "'", '`'],
    atAttributes: true,
    capitalizedTypes: true,
    identifier: /[A-Za-z_$][\w$]*/y,
  },
  python: {
    keywords: words(
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield self',
    ),
    literals: words('True False None'),
    lineComments: ['#'],
    blockComments: [],
    strings: ['"""', "'''", '"', "'"],
    atAttributes: true,
    capitalizedTypes: true,
  },
  go: {
    keywords: words(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    ),
    literals: words('true false nil iota'),
    ...C_COMMENTS,
    strings: ['"', "'", '`'],
  },
  rust: {
    keywords: words(
      'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
    ),
    literals: words('true false None Some Ok Err'),
    ...C_COMMENTS,
    strings: ['"'],
    hashAttributes: true,
    capitalizedTypes: true,
  },
  java: {
    keywords: words(
      'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return short static strictfp super switch synchronized this throw throws transient try var void volatile while yield',
    ),
    literals: words('true false null'),
    ...C_COMMENTS,
    strings: ['"""', '"', "'"],
    atAttributes: true,
    capitalizedTypes: true,
  },
  kotlin: {
    keywords: words(
      'as break class continue data do else enum fun if import in interface is object open override package private protected public return sealed super this throw try typealias val var when while',
    ),
    literals: words('true false null'),
    ...C_COMMENTS,
    strings: ['"""', '"', "'"],
    atAttributes: true,
    capitalizedTypes: true,
  },
  csharp: {
    keywords: words(
      'abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach get if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly record ref return sealed set short sizeof static string struct switch this throw try typeof uint ulong using var virtual void volatile while',
    ),
    literals: words('true false null'),
    ...C_COMMENTS,
    strings: ['"', "'"],
    capitalizedTypes: true,
  },
  c: {
    keywords: words(
      'auto bool break case char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new operator private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while #include #define #ifdef #ifndef #endif #pragma',
    ),
    literals: words('true false NULL nullptr'),
    ...C_COMMENTS,
    strings: ['"', "'"],
    capitalizedTypes: true,
    identifier: /#?[A-Za-z_]\w*/y,
  },
  swift: {
    keywords: words(
      'as associatedtype break case catch class continue default defer do else enum extension fallthrough for func guard if import in init inout internal is let private protocol public repeat return self Self static struct subscript switch throw throws try typealias var where while',
    ),
    literals: words('true false nil'),
    ...C_COMMENTS,
    strings: ['"""', '"'],
    atAttributes: true,
    capitalizedTypes: true,
  },
  ruby: {
    keywords: words(
      'alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_accessor attr_reader',
    ),
    literals: words('true false nil'),
    lineComments: ['#'],
    blockComments: [],
    strings: ['"', "'"],
    atAttributes: true,
    capitalizedTypes: true,
  },
  bash: {
    keywords: words(
      'if then else elif fi for in do done while until case esac function return local export readonly declare unset shift exit source set',
    ),
    literals: words('true false'),
    lineComments: ['#'],
    blockComments: [],
    strings: ['"', "'"],
    dollarVariables: true,
    identifier: /[A-Za-z_][\w-]*/y,
  },
  sql: {
    keywords: words(
      'add all alter and as asc begin between by case check column commit constraint create cross database default delete desc distinct drop else end exists foreign from full group having if in index inner insert into is join key left like limit not null offset on or order outer primary references returning right rollback select set table then transaction union unique update using values view when where with bigint boolean char date decimal integer int numeric serial text timestamp timestamptz uuid varchar',
    ),
    literals: words('true false'),
    caseInsensitive: true,
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    strings: ["'"],
  },
  json: {
    keywords: new Set(),
    literals: words('true false null'),
    lineComments: [],
    blockComments: [],
    strings: ['"'],
    keysBeforeColon: true,
  },
  yaml: {
    keywords: new Set(),
    literals: words('true false null yes no on off'),
    lineComments: ['#'],
    blockComments: [],
    strings: ['"', "'"],
    keysBeforeColon: true,
    identifier: /[A-Za-z_][\w.-]*/y,
  },
};

const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  typescript: 'javascript',
  py: 'python',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  cs: 'csharp',
  'c#': 'csharp',
  cpp: 'c',
  'c++': 'c',
  h: 'c',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  patch: 'diff',
};

/** The languages the compiler highlights, with their aliases. */
export const HIGHLIGHTED_LANGUAGES: readonly string[] = [
  ...Object.keys(GRAMMARS),
  'diff',
  ...Object.keys(ALIASES),
].sort();

function canonical(language: string): string {
  const name = language.trim().toLowerCase();
  return ALIASES[name] ?? name;
}

/** Whether a code block in this language gets highlighted. */
export function isHighlighted(language: string): boolean {
  const name = canonical(language);
  return name === 'diff' || GRAMMARS[name] !== undefined;
}

const NUMBER = /0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENTIFIER = /[A-Za-z_]\w*/y;
const IDENTIFIER_CHAR = /[\w$]/u;

function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0] ?? null;
}

/** The end of a string that opens at `index` with `delimiter`. */
function stringEnd(text: string, index: number, delimiter: string): number {
  const spansLines = delimiter.length > 1 || delimiter === '`';
  let cursor = index + delimiter.length;
  while (cursor < text.length) {
    if (text.startsWith(delimiter, cursor)) return cursor + delimiter.length;
    const character = text[cursor];
    if (character === '\n' && !spansLines) return cursor;
    cursor += character === '\\' ? 2 : 1;
  }
  return text.length;
}

/** The index of `character` at or after `from` on the same line, or -1. */
function indexOnLine(text: string, character: string, from: number): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === character) return cursor;
    if (text[cursor] === '\n') return -1;
  }
  return -1;
}

/** Whether a key ends at `index`: a `:` follows, after optional spaces, and then whitespace or the end. */
function keyEndsAt(text: string, index: number, colonMayTouch: boolean): boolean {
  let cursor = index;
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor += 1;
  if (text[cursor] !== ':') return false;
  const after = text[cursor + 1];
  return colonMayTouch || after === undefined || /\s/u.test(after);
}

function wordKind(grammar: Grammar, word: string, text: string, end: number): TokenKind | null {
  if (grammar.keysBeforeColon === true && keyEndsAt(text, end, false)) return 'type';
  const key = grammar.caseInsensitive === true ? word.toLowerCase() : word;
  if (grammar.literals.has(key)) return 'number';
  if (grammar.keywords.has(key)) return 'keyword';
  if (grammar.capitalizedTypes === true && /^[A-Z][A-Z\d_]+$/u.test(word)) return 'number';
  if (grammar.capitalizedTypes === true && /^[A-Z]/u.test(word)) return 'type';
  if (text[end] === '(') return 'function';
  return null;
}

function tokenize(text: string, grammar: Grammar): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  const push = (kind: TokenKind, value: string): void => {
    if (plain !== '') tokens.push({ kind: null, text: plain });
    plain = '';
    tokens.push({ kind, text: value });
  };
  const identifier = grammar.identifier ?? IDENTIFIER;
  let index = 0;
  while (index < text.length) {
    const previous = text[index - 1] ?? '';
    const marker = grammar.markers?.find((candidate) => text.startsWith(candidate, index));
    if (marker !== undefined) {
      push('keyword', marker);
      index += marker.length;
      continue;
    }
    if (grammar.hashAttributes === true && text.startsWith('#[', index)) {
      const close = indexOnLine(text, ']', index);
      if (close !== -1) {
        push('attribute', text.slice(index, close + 1));
        index = close + 1;
        continue;
      }
    }
    const block = grammar.blockComments.find(([open]) => text.startsWith(open, index));
    if (block !== undefined) {
      const close = text.indexOf(block[1], index + block[0].length);
      const end = close === -1 ? text.length : close + block[1].length;
      push('comment', text.slice(index, end));
      index = end;
      continue;
    }
    const line = grammar.lineComments.find(
      (open) => text.startsWith(open, index) && (open !== '#' || !IDENTIFIER_CHAR.test(previous)),
    );
    if (line !== undefined) {
      const lineEnd = text.indexOf('\n', index);
      const end = lineEnd === -1 ? text.length : lineEnd;
      push('comment', text.slice(index, end));
      index = end;
      continue;
    }
    const quote = grammar.strings.find((delimiter) => text.startsWith(delimiter, index));
    if (quote !== undefined) {
      const end = stringEnd(text, index, quote);
      const isKey = grammar.keysBeforeColon === true && keyEndsAt(text, end, true);
      push(isKey ? 'type' : 'string', text.slice(index, end));
      index = end;
      continue;
    }
    if (grammar.dollarVariables === true && text[index] === '$') {
      const braced = text.startsWith('${', index) ? indexOnLine(text, '}', index) : -1;
      const name =
        braced !== -1 ? text.slice(index, braced + 1) : matchAt(IDENTIFIER, text, index + 1);
      if (name !== null) {
        const value = braced !== -1 ? name : `$${name}`;
        push('variable', value);
        index += value.length;
        continue;
      }
    }
    if (grammar.atAttributes === true && text[index] === '@' && !IDENTIFIER_CHAR.test(previous)) {
      const name = matchAt(IDENTIFIER, text, index + 1);
      if (name !== null) {
        push('attribute', `@${name}`);
        index += name.length + 1;
        continue;
      }
    }
    if (!IDENTIFIER_CHAR.test(previous)) {
      const number = matchAt(NUMBER, text, index);
      if (number !== null && !IDENTIFIER_CHAR.test(text[index + number.length] ?? '')) {
        push('number', number);
        index += number.length;
        continue;
      }
      const word = matchAt(identifier, text, index);
      if (word !== null) {
        const kind = wordKind(grammar, word, text, index + word.length);
        if (kind === null) plain += word;
        else push(kind, word);
        index += word.length;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  if (plain !== '') tokens.push({ kind: null, text: plain });
  return tokens;
}

function diffLineKind(line: string): TokenKind | null {
  if (/^(?:diff |index |--- |\+\+\+ )/u.test(line)) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'inserted';
  if (line.startsWith('-')) return 'deleted';
  return null;
}

function tokenizeDiff(text: string): Token[] {
  return text.split('\n').flatMap((line, index): Token[] => {
    const tokens: Token[] = index === 0 ? [] : [{ kind: null, text: '\n' }];
    if (line !== '') tokens.push({ kind: diffLineKind(line), text: line });
    return tokens;
  });
}

/** Markup that only a highlighted token emits; spec text is escaped and cannot forge it. */
export const SYNTAX_TOKEN_MARKUP = '<span class="ak-tk-';

function renderPiece(kind: TokenKind | null, text: string): string {
  if (text === '') return '';
  return kind === null
    ? escapeText(text)
    : `<span class="${TOKEN_CLASS[kind]}">${escapeText(text)}</span>`;
}

/**
 * Split code into one `.ak-line` span per line so the stylesheet can number
 * lines; newlines stay in the text. A token that spans lines is closed and
 * reopened on each line, so every line span holds balanced markup.
 */
export function codeLines(text: string, language: string): string {
  const source = text.replace(/\n$/u, '');
  const name = canonical(language);
  const grammar = GRAMMARS[name];
  const tokens: Token[] =
    name === 'diff'
      ? tokenizeDiff(source)
      : grammar === undefined
        ? [{ kind: null, text: source }]
        : tokenize(source, grammar);
  const lines: string[] = [''];
  for (const token of tokens) {
    const pieces = token.text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push('');
      lines[lines.length - 1] += renderPiece(token.kind, piece);
    });
  }
  return lines.map((line) => `<span class="ak-line">${line}</span>`).join('\n');
}
