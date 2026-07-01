import type {
  FormulaEvaluationSummary,
  FormulaEvaluationResult,
  FormulaLiteralResult,
  FormulaErrorResult,
} from './formulaUtils.js';

export type OutputFormat = 'table' | 'json' | 'csv' | 'markdown' | 'junit';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resultValueString(r: FormulaEvaluationResult): string {
  if (r.isError) {
    const err = r.result as FormulaErrorResult;
    return `${err.errorType}: ${err.message}`;
  }
  const lit = r.result as FormulaLiteralResult;
  return JSON.stringify(lit.value);
}

/** JUnit XML for CI systems. Each summary becomes a <testsuite>, each record a <testcase>. */
export function toJUnitXml(summaries: FormulaEvaluationSummary[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const totalTests = summaries.reduce((n, s) => n + s.results.length, 0);
  const totalFailures = summaries.reduce((n, s) => n + s.assertionFailures, 0);
  const totalErrors = summaries.reduce((n, s) => n + s.errorCount, 0);

  lines.push(`<testsuites tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}">`);
  for (const summary of summaries) {
    const suiteName = summary.name ?? summary.formula;
    lines.push(
      `  <testsuite name="${escapeXml(suiteName)}" tests="${summary.results.length}" ` +
        `failures="${summary.assertionFailures}" errors="${summary.errorCount}">`
    );
    for (const r of summary.results) {
      const caseName = r.name ?? `record #${r.recordIndex + 1}`;
      lines.push(`    <testcase name="${escapeXml(caseName)}" classname="${escapeXml(suiteName)}">`);
      if (r.assertion && !r.assertion.passed) {
        lines.push(`      <failure message="${escapeXml(r.assertion.reason ?? 'assertion failed')}"></failure>`);
      } else if (r.isError && !r.assertion) {
        const err = r.result as FormulaErrorResult;
        lines.push(`      <error message="${escapeXml(`${err.errorType}: ${err.message}`)}"></error>`);
      }
      lines.push('    </testcase>');
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return lines.join('\n');
}

export function toCsv(summary: FormulaEvaluationSummary): string {
  const variableColumns = [...new Set(summary.results.flatMap((r) => Object.keys(r.variables)))];
  const header = ['record', ...variableColumns, 'result_type', 'result_value', 'status'];
  const hasAssertion = summary.results.some((r) => r.assertion);
  if (hasAssertion) header.push('assertion');

  const rows = summary.results.map((r) => {
    const cells: string[] = [`#${r.recordIndex + 1}`];
    for (const v of variableColumns) {
      const descriptor = r.variables[v];
      cells.push(descriptor !== undefined ? JSON.stringify(descriptor.value) : '');
    }
    if (r.isError) {
      cells.push((r.result as FormulaErrorResult).errorType ?? 'error', resultValueString(r), 'ERROR');
    } else {
      cells.push((r.result as FormulaLiteralResult).dataType ?? '', resultValueString(r), 'OK');
    }
    if (hasAssertion)
      cells.push(r.assertion ? (r.assertion.passed ? 'PASS' : `FAIL: ${r.assertion.reason ?? ''}`) : '-');
    return cells;
  });

  const escapeCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((row) => row.map((c) => escapeCell(String(c))).join(',')).join('\n');
}

export function toMarkdown(summary: FormulaEvaluationSummary): string {
  const variableColumns = [...new Set(summary.results.flatMap((r) => Object.keys(r.variables)))];
  const header = ['Record', ...variableColumns, 'Result', 'Status'];
  const hasAssertion = summary.results.some((r) => r.assertion);
  if (hasAssertion) header.push('Assertion');

  const lines: string[] = [];
  lines.push(`**Formula:** \`${summary.formula}\``);
  lines.push('');
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);

  for (const r of summary.results) {
    const cells: string[] = [`#${r.recordIndex + 1}`];
    for (const v of variableColumns) {
      const descriptor = r.variables[v];
      cells.push(descriptor !== undefined ? `\`${JSON.stringify(descriptor.value)}\`` : '-');
    }
    cells.push(`\`${resultValueString(r)}\``);
    cells.push(r.isError ? '❌ ERROR' : '✅ OK');
    if (hasAssertion) {
      cells.push(r.assertion ? (r.assertion.passed ? '✅ PASS' : `❌ ${r.assertion.reason ?? ''}`) : '-');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}
