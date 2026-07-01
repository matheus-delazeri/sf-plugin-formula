import { parse, extract } from '@steedos/formula';

export type FormulaDataType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'time'
  | 'datetime'
  | 'picklist'
  | 'multipicklist'
  | 'geolocation'
  | 'null';

export type FormulaVariable = {
  type: 'literal';
  dataType: FormulaDataType;
  value: unknown;
  options?: Record<string, unknown>;
};

export type FormulaVariableMap = Record<string, FormulaVariable>;

export type FormulaLiteralResult = {
  type: 'literal';
  value: unknown;
  dataType: FormulaDataType;
  options?: Record<string, unknown>;
};

export type FormulaErrorResult = {
  [key: string]: unknown;
  type: 'error';
  errorType: string;
  message: string;
};

export type FormulaParseResult = FormulaLiteralResult | FormulaErrorResult;

export type FormulaExpected = {
  value?: unknown;
  assertDataType?: FormulaDataType;
  errorType?: string;
  /** Numeric tolerance (absolute) applied when comparing numbers. */
  tolerance?: number;
  hasValue?: boolean;
};

export type FormulaAssertion = {
  evaluated: true;
  passed: boolean;
  reason?: string;
  expected: FormulaExpected;
};

export type FormulaEvaluationResult = {
  recordIndex: number;
  name?: string;
  variables: FormulaVariableMap;
  result: FormulaParseResult;
  isError: boolean;
  /** Kept for backwards compatibility: the raw expected value (if any). */
  expected?: unknown;
  assertion?: FormulaAssertion;
};

export type FormulaEvaluationSummary = {
  formula: string;
  name?: string;
  referencedVariables: string[];
  results: FormulaEvaluationResult[];
  successCount: number;
  errorCount: number;
  assertionsEvaluated: number;
  assertionFailures: number;
};

export const EXPECTED_KEY = '_expected';

export function extractExpected(record: FormulaVariableMap): {
  expected: FormulaExpected | undefined;
  clean: FormulaVariableMap;
} {
  const { [EXPECTED_KEY]: expectedVar, ...clean } = record as Record<string, unknown>;
  if (expectedVar === undefined) {
    return { expected: undefined, clean: clean as FormulaVariableMap };
  }

  const raw = expectedVar as Record<string, unknown>;
  const options = (raw.options as Record<string, unknown> | undefined) ?? {};
  const hasValue = Object.prototype.hasOwnProperty.call(raw, 'value');

  const expected: FormulaExpected = {
    hasValue,
    value: hasValue ? raw.value : undefined,
    assertDataType: (raw.assertDataType as FormulaDataType | undefined) ?? undefined,
    errorType: (raw.errorType as string | undefined) ?? undefined,
    tolerance: (raw.tolerance as number | undefined) ?? (options.tolerance as number | undefined) ?? undefined,
  };

  return { expected, clean: clean as FormulaVariableMap };
}

function normalizeForCompare(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  return value;
}

export function valuesMatch(actual: unknown, expected: unknown, tolerance = 1e-9): boolean {
  const a = normalizeForCompare(actual);
  const e = normalizeForCompare(expected);

  if (typeof a === 'number' && typeof e === 'number') {
    return Math.abs(a - e) <= tolerance;
  }
  if (typeof a !== typeof e) return false;
  return Object.is(a, e);
}

export function evaluateAssertion(
  result: FormulaParseResult,
  isError: boolean,
  expected: FormulaExpected
): FormulaAssertion {
  // Error expectation
  if (expected.errorType !== undefined) {
    if (!isError) {
      return { evaluated: true, passed: false, reason: 'expected an error but formula succeeded', expected };
    }
    const errType = (result as FormulaErrorResult).errorType;
    const passed = expected.errorType === '*' || errType === expected.errorType;
    return {
      evaluated: true,
      passed,
      reason: passed ? undefined : `expected error "${expected.errorType}", got "${errType}"`,
      expected,
    };
  }

  if (isError) {
    const err = result as FormulaErrorResult;
    return { evaluated: true, passed: false, reason: `unexpected error: ${err.errorType}: ${err.message}`, expected };
  }

  const lit = result as FormulaLiteralResult;

  if (expected.assertDataType !== undefined && lit.dataType !== expected.assertDataType) {
    return {
      evaluated: true,
      passed: false,
      reason: `expected result type "${expected.assertDataType}", got "${lit.dataType}"`,
      expected,
    };
  }

  if (expected.hasValue) {
    const passed = valuesMatch(lit.value, expected.value, expected.tolerance ?? 1e-9);
    return {
      evaluated: true,
      passed,
      reason: passed ? undefined : `expected ${JSON.stringify(expected.value)}, got ${JSON.stringify(lit.value)}`,
      expected,
    };
  }

  return { evaluated: true, passed: true, expected };
}

export function evaluateFormulaForRecords(
  formula: string,
  records: FormulaVariableMap[],
  defaults: { tolerance?: number } = {}
): FormulaEvaluationSummary {
  let referencedVariables: string[] = [];
  try {
    referencedVariables = (extract as (f: string) => string[])(formula);
  } catch (_) {
    // even if not parseable, we still want to return a structured error
  }

  const results: FormulaEvaluationResult[] = records.map((rawVariables, recordIndex) => {
    const { expected, clean: variables } = extractExpected(rawVariables);
    let isError = false;
    let rawResult: FormulaParseResult;
    try {
      rawResult = (parse as (f: string, vars: FormulaVariableMap) => FormulaParseResult)(
        formula,
        Object.fromEntries(Object.entries(variables).map(([key, v]) => [key, { ...v, options: v.options ?? {} }]))
      );

      const maxScale = Math.max(
        0,
        ...Object.values(variables).map((v) => (v.options?.scale as number | undefined) ?? 0)
      );

      if (rawResult.dataType === 'number' && typeof rawResult.value === 'number') {
        rawResult = { ...rawResult, value: parseFloat(rawResult.value.toFixed(maxScale)) };
      }

      isError = rawResult.type === 'error';
    } catch (e: unknown) {
      rawResult = {
        type: 'error',
        errorType: 'Unparsable formula',
        message: "The formula couldn't be parsed.",
      };
      isError = true;
    }

    let assertion: FormulaAssertion | undefined;
    if (expected !== undefined) {
      const withTol: FormulaExpected = { ...expected, tolerance: expected.tolerance ?? defaults.tolerance };
      assertion = evaluateAssertion(rawResult, isError, withTol);
    }

    return {
      recordIndex,
      variables,
      result: rawResult,
      isError,
      expected: expected?.hasValue ? expected.value : undefined,
      assertion,
    };
  });

  const errorCount = results.filter((r) => r.isError).length;
  const assertionsEvaluated = results.filter((r) => r.assertion !== undefined).length;
  const assertionFailures = results.filter((r) => r.assertion !== undefined && !r.assertion.passed).length;

  return {
    formula,
    referencedVariables,
    results,
    successCount: results.length - errorCount,
    errorCount,
    assertionsEvaluated,
    assertionFailures,
  };
}

export function summaryPassed(summary: FormulaEvaluationSummary): boolean {
  return summary.errorCount === 0 && summary.assertionFailures === 0;
}

export function exitCodeFor(summary: FormulaEvaluationSummary, strict: boolean): number {
  if (summary.assertionFailures > 0) return 1;
  if (strict && summary.errorCount > 0) return 1;
  return 0;
}

export function formatEvaluationSummary(summary: FormulaEvaluationSummary): string {
  const lines: string[] = [];
  lines.push(`Formula : ${summary.formula}`);
  if (summary.referencedVariables.length > 0) {
    lines.push(`Variables referenced: ${summary.referencedVariables.join(', ')}`);
  }
  lines.push(
    `Records evaluated : ${summary.results.length} (${summary.successCount} ok, ${summary.errorCount} errors)`
  );
  lines.push('');
  for (const r of summary.results) {
    const prefix = `  [Record ${r.recordIndex + 1}]`;
    if (r.isError) {
      const err = r.result as FormulaErrorResult;
      lines.push(`${prefix} ERROR:  ${err.errorType}: ${err.message}`);
    } else {
      const lit = r.result as FormulaLiteralResult;
      lines.push(`${prefix} ${lit.dataType} -> ${JSON.stringify(lit.value)}`);
    }
  }
  return lines.join('\n');
}

export function summaryToJson(summary: FormulaEvaluationSummary): Record<string, unknown> {
  return {
    formula: summary.formula,
    name: summary.name,
    referencedVariables: summary.referencedVariables,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    assertionsEvaluated: summary.assertionsEvaluated,
    assertionFailures: summary.assertionFailures,
    passed: summaryPassed(summary),
    results: summary.results.map((r) => ({
      recordIndex: r.recordIndex,
      name: r.name,
      variables: r.variables,
      isError: r.isError,
      result: r.result,
      assertion: r.assertion ? { passed: r.assertion.passed, reason: r.assertion.reason } : undefined,
    })),
  };
}

export function buildModelJson(formula: string): Record<string, unknown> {
  const placeholderRecord: FormulaVariableMap = {};
  let referencedVariables: string[] = [];
  try {
    referencedVariables = (extract as (f: string) => string[])(formula);
  } catch (_) {
    referencedVariables = [];
  }
  for (const varName of referencedVariables) {
    placeholderRecord[varName] = { type: 'literal', dataType: 'text', value: '', options: {} };
  }
  return { formula, records: [placeholderRecord] };
}
