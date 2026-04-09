import { parse, extract } from '@steedos/formula';

export type FormulaDataType = 'text' | 'number' | 'checkbox' | 'date' | 'time' | 'datetime' | 'geolocation' | 'null';

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

export type FormulaEvaluationResult = {
  recordIndex: number;
  variables: FormulaVariableMap;
  result: FormulaParseResult;
  isError: boolean;
  expected?: unknown;
};

export type FormulaEvaluationSummary = {
  formula: string;
  referencedVariables: string[];
  results: FormulaEvaluationResult[];
  successCount: number;
  errorCount: number;
};

export function evaluateFormulaForRecords(formula: string, records: FormulaVariableMap[]): FormulaEvaluationSummary {
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
        Object.fromEntries(
          Object.entries(variables).map(([key, v]) => [
            key,
            { ...v, options: v.options ?? {} },
          ]) /** Add options even if not used for Formulon compatibility */
        )
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
    return { recordIndex, variables, result: rawResult, isError, expected };
  });

  const errorCount = results.filter((r) => r.isError).length;

  return {
    formula,
    referencedVariables,
    results,
    successCount: results.length - errorCount,
    errorCount,
  };
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
      lines.push(`${prefix} ${lit.dataType} → ${JSON.stringify(lit.value)}`);
    }
  }

  return lines.join('\n');
}

export function summaryToJson(summary: FormulaEvaluationSummary): Record<string, unknown> {
  return {
    formula: summary.formula,
    referencedVariables: summary.referencedVariables,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
    results: summary.results.map((r) => ({
      recordIndex: r.recordIndex,
      variables: r.variables,
      isError: r.isError,
      result: r.result,
    })),
  };
}

export const EXPECTED_KEY = '_expected';

export function extractExpected(record: FormulaVariableMap): { expected: unknown; clean: FormulaVariableMap } {
  const { [EXPECTED_KEY]: expectedVar, ...clean } = record;
  return {
    expected: expectedVar !== undefined ? expectedVar.value : undefined,
    clean: clean as FormulaVariableMap,
  };
}

export function buildModelJson(formula: string): Record<string, unknown> {
  const placeholderRecord: FormulaVariableMap = {};
  const referencedVariables = (extract as (f: string) => string[])(formula);
  for (const varName of referencedVariables) {
    placeholderRecord[varName] = {
      type: 'literal',
      dataType: 'text',
      value: '',
      options: {},
    };
  }

  return {
    formula,
    records: [placeholderRecord],
  };
}
