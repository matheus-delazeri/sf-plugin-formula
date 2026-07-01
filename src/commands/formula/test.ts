import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog, uxLogTable } from 'sfdx-hardis/plugin-api';
import { loadTestCases, runTestCases, buildSnapshot, diffSnapshots, type Snapshot } from '../../utils/testRunner.js';
import { serializeSummaries } from '../../utils/ioUtils.js';
import { type OutputFormat } from '../../utils/reportUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-formula', 'sf-plugin-formula.test');

export default class FormulaTest extends SfCommand<AnyJson> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = [messages.getMessage('examples')];

  public static readonly flags = {
    suite: Flags.string({ char: 's', required: true, summary: messages.getMessage('flags.suite.summary') }),
    'output-format': Flags.string({
      summary: messages.getMessage('flags.output-format.summary'),
      options: ['table', 'json', 'junit'],
      default: 'table',
    }),
    outputfile: Flags.string({ summary: messages.getMessage('flags.outputfile.summary') }),
    snapshot: Flags.string({ summary: messages.getMessage('flags.snapshot.summary') }),
    'update-snapshot': Flags.boolean({ default: false, summary: messages.getMessage('flags.update-snapshot.summary') }),
    tolerance: Flags.integer({ summary: messages.getMessage('flags.tolerance.summary') }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FormulaTest);
    const outputFormat = flags['output-format'] as OutputFormat;

    const cases = loadTestCases(flags.suite);
    uxLog('action', this, c.cyan(`Loaded ${cases.length} test case(s) from ${flags.suite}.`));

    const run = runTestCases(cases, { tolerance: flags.tolerance });

    const rows = run.summaries.map((s) => ({
      test: s.name ?? s.formula,
      records: s.results.length,
      errors: s.errorCount,
      assertions: s.assertionsEvaluated,
      failures: s.assertionFailures,
      status: s.errorCount === 0 && s.assertionFailures === 0 ? '✅ PASS' : '❌ FAIL',
    }));
    uxLogTable(this, rows, ['test', 'records', 'errors', 'assertions', 'failures', 'status']);

    for (const s of run.summaries) {
      for (const r of s.results) {
        if (r.assertion && !r.assertion.passed) {
          uxLog('warning', this, c.red(`  ✗ ${r.name ?? ''}: ${r.assertion.reason ?? ''}`));
        } else if (r.isError && !r.assertion) {
          const err = r.result as { errorType: string; message: string };
          uxLog('warning', this, c.yellow(`  ! ${r.name ?? ''}: ${err.errorType}: ${err.message}`));
        }
      }
    }

    let snapshotMismatches = 0;
    if (flags.snapshot) {
      const current = buildSnapshot(run.summaries);
      if (flags['update-snapshot'] || !existsSync(flags.snapshot)) {
        writeFileSync(flags.snapshot, JSON.stringify(current, null, 2), 'utf-8');
        uxLog('success', this, c.green(`Snapshot written to ${flags.snapshot}.`));
      } else {
        const previous = JSON.parse(readFileSync(flags.snapshot, 'utf-8')) as Snapshot;
        const diffs = diffSnapshots(previous, current);
        snapshotMismatches = diffs.length;
        for (const d of diffs) {
          uxLog(
            'warning',
            this,
            c.red(`  Δ ${d.key}[${d.index}]: ${JSON.stringify(d.previous)} → ${JSON.stringify(d.current)}`)
          );
        }
        if (diffs.length === 0) uxLog('success', this, c.green('Snapshot matches.'));
      }
    }

    if (outputFormat !== 'table' && flags.outputfile) {
      writeFileSync(flags.outputfile, serializeSummaries(run.summaries, outputFormat), 'utf-8');
      uxLog('success', this, c.green(`Wrote ${outputFormat} report to ${flags.outputfile}.`));
    }

    const passed = run.passed && snapshotMismatches === 0;
    if (passed) {
      uxLog('action', this, c.green(`All ${run.totalRecords} record(s) across ${cases.length} case(s) passed.`));
    } else {
      uxLog(
        'error',
        this,
        c.red(
          `FAILED: ${run.totalAssertionFailures} assertion failure(s), ${run.totalErrors} error(s), ${snapshotMismatches} snapshot mismatch(es).`
        )
      );
    }
    process.exitCode = passed ? 0 : 1;

    return {
      passed,
      cases: cases.length,
      totalRecords: run.totalRecords,
      totalErrors: run.totalErrors,
      totalAssertions: run.totalAssertions,
      totalAssertionFailures: run.totalAssertionFailures,
      snapshotMismatches,
    } as AnyJson;
  }
}
