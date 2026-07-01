import { parse, extract } from '@steedos/formula';
import type { FormulaVariableMap, FormulaParseResult } from './formulaUtils.js';

export type LintSeverity = 'info' | 'warning' | 'error';
export type FormulaContext = 'formulaField' | 'validationRule' | 'flow' | 'default';

export type LintFinding = {
  rule: string;
  severity: LintSeverity;
  message: string;
};

export type FunctionCall = {
  name: string;
  depth: number;
  index: number;
  argsRaw: string;
};

export type FormulaAnalysis = {
  formula: string;
  characterCount: number;
  referencedFields: string[];
  crossObjectFields: string[];
  functions: Record<string, number>;
  functionCalls: FunctionCall[];
  operators: Record<string, number>;
  literalCount: number;
  maxNestingDepth: number;
  branchCount: number;
  balancedParens: boolean;
  balancedQuotes: boolean;
};

const FORMULA_FIELD_CHAR_WARN = 3900;
const HARD_CHAR_ERROR = 5000;

// Functions that are not valid inside a formula *field* (only in validation
// rules / workflow / flow, which have access to prior values & change context).
const CONTEXT_ONLY_FUNCTIONS: Record<string, FormulaContext[]> = {
  ISCHANGED: ['validationRule', 'flow'],
  ISNEW: ['validationRule', 'flow'],
  PRIORVALUE: ['validationRule', 'flow'],
  REGEX: ['validationRule'],
  VLOOKUP: ['validationRule'],
};

const OPERATOR_TOKENS = ['&&', '||', '<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '&', '<', '>', '='];

/** Split a comma-separated argument list, respecting nested parens and quotes. */
export function splitTopLevelArgs(argString: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let current = '';

  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && argString[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') args.push(current.trim());
  return args;
}

export function findFunctionCalls(formula: string): FunctionCall[] {
  const calls: FunctionCall[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(formula)) !== null) {
    const name = match[1];
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;

    const openParen = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < openParen; i++) {
      const ch = formula[i];
      if (inString) {
        if (ch === stringChar && formula[i - 1] !== '\\') inString = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }

    let d = 0;
    let end = openParen;
    let strIn = false;
    let strCh = '';
    for (let i = openParen; i < formula.length; i++) {
      const ch = formula[i];
      if (strIn) {
        if (ch === strCh && formula[i - 1] !== '\\') strIn = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        strIn = true;
        strCh = ch;
        continue;
      }
      if (ch === '(') d++;
      if (ch === ')') {
        d--;
        if (d === 0) {
          end = i;
          break;
        }
      }
    }

    calls.push({ name, depth, index: match.index, argsRaw: formula.slice(openParen + 1, end) });
  }
  return calls;
}

function countOperators(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const stripped = formula.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let i = 0;
  while (i < stripped.length) {
    let matched = false;
    for (const op of OPERATOR_TOKENS) {
      if (stripped.startsWith(op, i)) {
        counts[op] = (counts[op] ?? 0) + 1;
        i += op.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return counts;
}

function maxParenDepth(formula: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (inString) {
      if (ch === stringChar && formula[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      max = Math.max(max, depth);
    }
    if (ch === ')') depth--;
  }
  return max;
}

function checkBalanced(formula: string): { parens: boolean; quotes: boolean } {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (inString) {
      if (ch === stringChar && formula[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
  }
  return { parens: depth === 0, quotes: !inString };
}

export function analyzeFormula(formula: string): FormulaAnalysis {
  let referencedFields: string[] = [];
  try {
    referencedFields = (extract as (f: string) => string[])(formula);
  } catch (_) {
    referencedFields = [];
  }

  const functionCalls = findFunctionCalls(formula);
  const functions: Record<string, number> = {};
  for (const call of functionCalls) functions[call.name] = (functions[call.name] ?? 0) + 1;

  const crossObjectFields = referencedFields.filter((f) => f.includes('.') || f.includes('__r'));
  const literalCount =
    (formula.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)?.length ?? 0) +
    (formula.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').match(/\b\d+(\.\d+)?\b/g)?.length ?? 0);

  const balanced = checkBalanced(formula);
  const branchCount = (functions.IF ?? 0) + (functions.CASE ?? 0);

  return {
    formula,
    characterCount: formula.length,
    referencedFields,
    crossObjectFields,
    functions,
    functionCalls,
    operators: countOperators(formula),
    literalCount,
    maxNestingDepth: maxParenDepth(formula),
    branchCount,
    balancedParens: balanced.parens,
    balancedQuotes: balanced.quotes,
  };
}

export function lintFormula(analysis: FormulaAnalysis, context: FormulaContext = 'default'): LintFinding[] {
  const findings: LintFinding[] = [];

  if (!analysis.balancedParens) {
    findings.push({ rule: 'balanced-parens', severity: 'error', message: 'Unbalanced parentheses detected.' });
  }
  if (!analysis.balancedQuotes) {
    findings.push({ rule: 'balanced-quotes', severity: 'error', message: 'Unterminated string literal detected.' });
  }

  if (analysis.characterCount > HARD_CHAR_ERROR) {
    findings.push({
      rule: 'compile-size',
      severity: 'error',
      message: `Formula is ${analysis.characterCount} chars, above the ~${HARD_CHAR_ERROR} compile limit.`,
    });
  } else if (context === 'formulaField' && analysis.characterCount > FORMULA_FIELD_CHAR_WARN) {
    findings.push({
      rule: 'compile-size',
      severity: 'warning',
      message: `Formula is ${analysis.characterCount} chars, approaching the ${FORMULA_FIELD_CHAR_WARN}-char formula-field limit.`,
    });
  }

  if (analysis.maxNestingDepth > 10) {
    findings.push({
      rule: 'nesting-depth',
      severity: 'warning',
      message: `Deep nesting (depth ${analysis.maxNestingDepth}). Consider splitting into helper fields.`,
    });
  }

  if (analysis.referencedFields.length > 30) {
    findings.push({
      rule: 'field-count',
      severity: 'warning',
      message: `References ${analysis.referencedFields.length} fields; large formulas are harder to maintain and hit limits.`,
    });
  }

  for (const fnName of Object.keys(analysis.functions)) {
    const allowed = CONTEXT_ONLY_FUNCTIONS[fnName];
    if (allowed && context !== 'default' && !allowed.includes(context)) {
      findings.push({
        rule: 'context-function',
        severity: 'error',
        message: `${fnName}() is not available in a ${context}; valid in: ${allowed.join(', ')}.`,
      });
    }
  }

  return findings;
}

export type BranchCoverage = {
  branches: Array<{
    functionName: string;
    index: number;
    condition: string;
    trueHits: number;
    falseHits: number;
    errorHits: number;
  }>;
  uncoveredCount: number;
};

/**
 * Practical branch coverage: for each IF() call, evaluate its condition (first
 * argument) against every record and tally which side each record took.
 */
export function computeBranchCoverage(formula: string, records: FormulaVariableMap[]): BranchCoverage {
  const ifCalls = findFunctionCalls(formula).filter((c) => c.name === 'IF');
  const branches = ifCalls.map((call) => {
    const condition = splitTopLevelArgs(call.argsRaw)[0] ?? '';
    let trueHits = 0;
    let falseHits = 0;
    let errorHits = 0;

    for (const record of records) {
      try {
        const vars = Object.fromEntries(
          Object.entries(record)
            .filter(([k]) => k !== '_expected')
            .map(([k, v]) => [k, { ...v, options: v.options ?? {} }])
        );
        const res = (parse as (f: string, v: FormulaVariableMap) => FormulaParseResult)(condition, vars);
        if (res.type === 'error') errorHits++;
        else if (res.value === true) trueHits++;
        else falseHits++;
      } catch (_) {
        errorHits++;
      }
    }
    return { functionName: 'IF', index: call.index, condition, trueHits, falseHits, errorHits };
  });

  const uncoveredCount = branches.filter((b) => b.trueHits === 0 || b.falseHits === 0).length;
  return { branches, uncoveredCount };
}
