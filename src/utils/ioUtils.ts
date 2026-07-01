import { writeFileSync } from 'node:fs';
import c from 'chalk';
import { uxLog, uxLogTable } from 'sfdx-hardis/plugin-api';
import {
  EXPECTED_KEY,
  type FormulaEvaluationSummary,
  type FormulaLiteralResult,
  type FormulaErrorResult,
} from './formulaUtils.js';
import { toCsv, toMarkdown, toJUnitXml, type OutputFormat } from './reportUtils.js';

/** Render an evaluation summary as a rich terminal / VS Code table. */
export function renderSummaryTable(command: unknown, summary: FormulaEvaluationSummary): void {
  const variableColumns = [
    ...new Set(summary.results.flatMap((r) => Object.keys(r.variables).filter((k) => k !== EXPECTED_KEY))),
  ];
  const hasAssertion = summary.results.some((r) => r.assertion !== undefined);

  const columns = [
    'record',
    ...variableColumns.map((v) => `${v}_type`),
    ...variableColumns.map((v) => `${v}_value`),
    'result_type',
    'result_value',
    'status',
    ...(hasAssertion ? ['assertion'] : []),
  ];

  uxLog('success', command, c.green('Formula evaluation results'));
  uxLog('other', command, c.white(`Formula: ${summary.formula}`));

  const tableRows = summary.results.map((r) => {
    const row: Record<string, string> = { record: `#${r.recordIndex + 1}` };
    for (const varName of variableColumns) {
      const descriptor = r.variables[varName];
      row[`${varName}_type`] = descriptor?.dataType ?? '-';
      row[`${varName}_value`] = descriptor !== undefined ? JSON.stringify(descriptor.value) : '-';
    }
    if (r.isError) {
      const err = r.result as FormulaErrorResult;
      row['result_type'] = err.errorType ?? 'error';
      row['result_value'] = err.message ?? '';
      row['status'] = 'ERROR';
    } else {
      const lit = r.result as FormulaLiteralResult;
      row['result_type'] = lit.dataType ?? '';
      row['result_value'] = JSON.stringify(lit.value);
      row['status'] = 'OK';
    }
    if (hasAssertion) {
      row['assertion'] = r.assertion ? (r.assertion.passed ? '✅ PASS' : `❌ FAIL - ${r.assertion.reason ?? ''}`) : '-';
    }
    return row;
  });

  uxLogTable(command, tableRows, columns);

  if (summary.errorCount === 0 && summary.assertionFailures === 0) {
    uxLog('action', command, c.green(`Formula evaluated successfully for all ${summary.successCount} record(s).`));
  } else {
    if (summary.errorCount > 0) {
      uxLog(
        'warning',
        command,
        c.yellow(`Evaluation complete: ${summary.successCount} succeeded, ${summary.errorCount} failed.`)
      );
    }
    if (summary.assertionFailures > 0) {
      uxLog(
        'warning',
        command,
        c.red(`Assertion failures: ${summary.assertionFailures} record(s) did not match the expected value.`)
      );
    }
  }
}

/** Produce the serialized string for a non-table output format. */
export function serializeSummaries(summaries: FormulaEvaluationSummary[], format: OutputFormat): string {
  switch (format) {
    case 'csv':
      return summaries.map((s) => toCsv(s)).join('\n\n');
    case 'markdown':
      return summaries.map((s) => toMarkdown(s)).join('\n\n');
    case 'junit':
      return toJUnitXml(summaries);
    case 'json':
    default:
      return JSON.stringify(summaries, null, 2);
  }
}

export function writeToFile(command: unknown, path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
  uxLog('success', command, c.green(`Wrote output to ${path}`));
}
