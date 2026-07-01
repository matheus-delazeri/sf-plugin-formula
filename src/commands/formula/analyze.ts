import { readFileSync } from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog, uxLogTable } from 'sfdx-hardis/plugin-api';
import {
  analyzeFormula,
  lintFormula,
  computeBranchCoverage,
  type FormulaContext,
  type BranchCoverage,
} from '../../utils/analyzeUtils.js';
import { pullFormulaField } from '../../utils/orgUtils.js';
import type { FormulaVariableMap } from '../../utils/formulaUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-formula', 'sf-plugin-formula.analyze');

export default class FormulaAnalyze extends SfCommand<AnyJson> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = [messages.getMessage('examples')];

  public static readonly flags = {
    formula: Flags.string({ char: 'f', summary: messages.getMessage('flags.formula.summary') }),
    inputfile: Flags.string({ char: 'x', summary: messages.getMessage('flags.inputfile.summary') }),
    field: Flags.string({ summary: messages.getMessage('flags.field.summary') }),
    'target-org': Flags.optionalOrg(),
    context: Flags.string({
      summary: messages.getMessage('flags.context.summary'),
      options: ['formulaField', 'validationRule', 'flow', 'default'],
      default: 'default',
    }),
    strict: Flags.boolean({ default: false, summary: messages.getMessage('flags.strict.summary') }),
    debug: Flags.boolean({ char: 'd', default: false, summary: messages.getMessage('flags.debug.summary') }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FormulaAnalyze);
    const context = flags.context as FormulaContext;

    let formula = flags.formula;
    let records: FormulaVariableMap[] = [];

    if (flags.field) {
      const org = flags['target-org'];
      if (!org) throw new Error('--field requires a --target-org connection.');
      // eslint-disable-next-line sf-plugin/get-connection-with-version
      const pulled = await pullFormulaField(org.getConnection(), flags.field);
      formula = pulled.formula;
      uxLog('action', this, c.cyan(`Pulled formula from ${flags.field}.`));
    } else if (flags.inputfile) {
      const raw = JSON.parse(readFileSync(flags.inputfile, 'utf-8')) as {
        formula: string;
        records?: FormulaVariableMap[];
      };
      formula = raw.formula;
      records = Array.isArray(raw.records) ? raw.records : [];
    }

    if (!formula) throw new Error('Provide a formula via --formula, --inputfile, or --field.');

    const analysis = analyzeFormula(formula);
    const findings = lintFormula(analysis, context);

    uxLog('success', this, c.green('Formula analysis'));
    uxLog('other', this, c.white(`Formula: ${formula}`));

    // Metrics.
    uxLogTable(
      this,
      [
        { metric: 'Characters', value: String(analysis.characterCount) },
        { metric: 'Referenced fields', value: String(analysis.referencedFields.length) },
        { metric: 'Cross-object fields', value: String(analysis.crossObjectFields.length) },
        { metric: 'Distinct functions', value: String(Object.keys(analysis.functions).length) },
        { metric: 'Max nesting depth', value: String(analysis.maxNestingDepth) },
        { metric: 'Branches (IF/CASE)', value: String(analysis.branchCount) },
        { metric: 'Literals', value: String(analysis.literalCount) },
      ],
      ['metric', 'value']
    );

    if (analysis.referencedFields.length > 0) {
      uxLogTable(
        this,
        analysis.referencedFields.map((field) => ({
          field,
          kind: analysis.crossObjectFields.includes(field) ? 'cross-object' : 'direct',
        })),
        ['field', 'kind']
      );
    }

    if (Object.keys(analysis.functions).length > 0) {
      uxLogTable(
        this,
        Object.entries(analysis.functions).map(([name, count]) => ({ function: name, count: String(count) })),
        ['function', 'count']
      );
    }

    if (findings.length > 0) {
      uxLog('warning', this, c.yellow(`${findings.length} lint finding(s):`));
      uxLogTable(
        this,
        findings.map((f) => ({ severity: f.severity.toUpperCase(), rule: f.rule, message: f.message })),
        ['severity', 'rule', 'message']
      );
    } else {
      uxLog('action', this, c.green('No lint findings.'));
    }

    let branchCoverage: BranchCoverage | undefined;
    if (records.length > 0 && analysis.functions.IF) {
      branchCoverage = computeBranchCoverage(formula, records);
      uxLog('other', this, c.white(`Branch coverage across ${records.length} record(s):`));
      uxLogTable(
        this,
        branchCoverage.branches.map((b, i) => ({
          branch: `IF #${i + 1}`,
          condition: b.condition.length > 40 ? `${b.condition.slice(0, 37)}…` : b.condition,
          true: String(b.trueHits),
          false: String(b.falseHits),
          errors: String(b.errorHits),
          covered: b.trueHits > 0 && b.falseHits > 0 ? '✅' : '⚠️',
        })),
        ['branch', 'condition', 'true', 'false', 'errors', 'covered']
      );
      if (branchCoverage.uncoveredCount > 0) {
        uxLog(
          'warning',
          this,
          c.yellow(`${branchCoverage.uncoveredCount} branch(es) not exercised in both directions.`)
        );
      }
    }

    const hasErrors = findings.some((f) => f.severity === 'error');
    process.exitCode = flags.strict && hasErrors ? 1 : 0;

    return {
      formula,
      analysis,
      findings,
      branchCoverage,
      hasErrors,
    } as AnyJson;
  }
}
