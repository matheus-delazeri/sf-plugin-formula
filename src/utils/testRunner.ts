import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  evaluateFormulaForRecords,
  type FormulaVariableMap,
  type FormulaEvaluationSummary,
  type FormulaLiteralResult,
} from './formulaUtils.js';

export type TestCase = {
  name: string;
  formula: string;
  records: FormulaVariableMap[];
  sourceFile: string;
};

type RawCase = { name?: string; formula: unknown; records?: unknown };

function coerceCases(raw: unknown, sourceFile: string): TestCase[] {
  const asCase = (obj: RawCase, idx?: number): TestCase => {
    if (typeof obj.formula !== 'string') {
      throw new Error(`Each test case needs a string "formula" (in ${sourceFile})`);
    }
    return {
      name: obj.name ?? `${sourceFile}${idx !== undefined ? ` [${idx}]` : ''}`,
      formula: obj.formula,
      records: Array.isArray(obj.records) ? (obj.records as FormulaVariableMap[]) : [{}],
      sourceFile,
    };
  };

  if (Array.isArray(raw)) {
    return (raw as RawCase[]).map((c, i) => asCase(c, i));
  }
  const obj = raw as { tests?: RawCase[]; formula?: unknown; records?: unknown; name?: string };
  if (Array.isArray(obj.tests)) {
    return obj.tests.map((c, i) => asCase(c, i));
  }
  return [asCase(obj as RawCase)];
}

function collectFiles(pathOrDir: string): string[] {
  if (!existsSync(pathOrDir)) {
    throw new Error(`Path not found: ${pathOrDir}`);
  }
  const stat = statSync(pathOrDir);
  if (stat.isDirectory()) {
    return readdirSync(pathOrDir)
      .filter((f) => extname(f) === '.json')
      .map((f) => join(pathOrDir, f))
      .sort();
  }
  return [pathOrDir];
}

export function loadTestCases(pathOrDir: string): TestCase[] {
  const files = collectFiles(pathOrDir);
  const cases: TestCase[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    cases.push(...coerceCases(parsed, file));
  }
  return cases;
}

export type SuiteRun = {
  summaries: FormulaEvaluationSummary[];
  totalRecords: number;
  totalErrors: number;
  totalAssertions: number;
  totalAssertionFailures: number;
  passed: boolean;
};

export function runTestCases(cases: TestCase[], defaults: { tolerance?: number } = {}): SuiteRun {
  const summaries = cases.map((c) => {
    const summary = evaluateFormulaForRecords(c.formula, c.records, defaults);
    summary.name = c.name;
    for (let i = 0; i < summary.results.length; i++) {
      summary.results[i].name = `${c.name} · record #${i + 1}`;
    }
    return summary;
  });

  const totalRecords = summaries.reduce((n, s) => n + s.results.length, 0);
  const totalErrors = summaries.reduce((n, s) => n + s.errorCount, 0);
  const totalAssertions = summaries.reduce((n, s) => n + s.assertionsEvaluated, 0);
  const totalAssertionFailures = summaries.reduce((n, s) => n + s.assertionFailures, 0);

  return {
    summaries,
    totalRecords,
    totalErrors,
    totalAssertions,
    totalAssertionFailures,
    passed: totalAssertionFailures === 0 && totalErrors === 0,
  };
}

export type Snapshot = Record<string, unknown[]>;

export function buildSnapshot(summaries: FormulaEvaluationSummary[]): Snapshot {
  const snap: Snapshot = {};
  for (const summary of summaries) {
    const key = summary.name ?? summary.formula;
    snap[key] = summary.results.map((r) =>
      r.isError ? { error: (r.result as { errorType: string }).errorType } : (r.result as FormulaLiteralResult).value
    );
  }
  return snap;
}

export type SnapshotDiff = {
  key: string;
  index: number;
  previous: unknown;
  current: unknown;
};

export function diffSnapshots(previous: Snapshot, current: Snapshot): SnapshotDiff[] {
  const diffs: SnapshotDiff[] = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const key of keys) {
    const prevArr = previous[key] ?? [];
    const currArr = current[key] ?? [];
    const len = Math.max(prevArr.length, currArr.length);
    for (let i = 0; i < len; i++) {
      if (JSON.stringify(prevArr[i]) !== JSON.stringify(currArr[i])) {
        diffs.push({ key, index: i, previous: prevArr[i], current: currArr[i] });
      }
    }
  }
  return diffs;
}
