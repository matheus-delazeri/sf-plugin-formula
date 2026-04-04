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

  const results: FormulaEvaluationResult[] = records.map((variables, recordIndex) => {
    let isError = false;
    let rawResult: FormulaParseResult;
    try {
      rawResult = (parse as (f: string, vars: FormulaVariableMap) => FormulaParseResult)(formula, variables);
      isError = rawResult.type === 'error';
    } catch (_) {
      rawResult = {
        type: 'error',
        errorType: 'Unparsable formula',
        message: "The formula couldn't be parsed.",
      };
      isError = true;
    }
    return { recordIndex, variables, result: rawResult, isError };
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
