import { readFileSync } from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import c from 'chalk';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog, uxLogTable } from 'sfdx-hardis/plugin-api';
import {
  evaluateFormulaForRecords,
  valuesMatch,
  type FormulaVariableMap,
  type FormulaLiteralResult,
  type FormulaErrorResult,
} from '../../utils/formulaUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-formula', 'sf-plugin-formula.diff');

function resultCell(r: { isError: boolean; result: unknown }): string {
  if (r.isError) return `ERR:${(r.result as FormulaErrorResult).errorType}`;
  return JSON.stringify((r.result as FormulaLiteralResult).value);
}

export default class FormulaDiff extends SfCommand<AnyJson> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = [messages.getMessage('examples')];

  public static readonly flags = {
    formula: Flags.string({ char: 'a', summary: messages.getMessage('flags.formula.summary') }),
    'formula-b': Flags.string({ char: 'b', summary: messages.getMessage('flags.formula-b.summary') }),
    records: Flags.string({ char: 'r', summary: messages.getMessage('flags.records.summary') }),
    inputfile: Flags.string({ char: 'x', summary: messages.getMessage('flags.inputfile.summary') }),
    strict: Flags.boolean({ default: false, summary: messages.getMessage('flags.strict.summary') }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FormulaDiff);

    let formulaA = flags.formula;
    let formulaB = flags['formula-b'];
    let records: FormulaVariableMap[] = [{}];

    if (flags.inputfile) {
      const raw = JSON.parse(readFileSync(flags.inputfile, 'utf-8')) as {
        formula?: string;
        formulaB?: string;
        records?: FormulaVariableMap[];
      };
      formulaA = formulaA ?? raw.formula;
      formulaB = formulaB ?? raw.formulaB;
      if (Array.isArray(raw.records)) records = raw.records;
    } else if (flags.records) {
      const parsed = JSON.parse(flags.records) as unknown;
      if (!Array.isArray(parsed)) throw new Error('--records must be a JSON array.');
      records = parsed as FormulaVariableMap[];
    }

    if (!formulaA || !formulaB) {
      throw new Error('Provide both formulas (--formula/--formula-b) or an --inputfile with "formula" and "formulaB".');
    }

    const summaryA = evaluateFormulaForRecords(formulaA, records);
    const summaryB = evaluateFormulaForRecords(formulaB, records);

    uxLog('success', this, c.green('Formula diff'));
    uxLog('other', this, c.white(`A: ${formulaA}`));
    uxLog('other', this, c.white(`B: ${formulaB}`));

    let differences = 0;
    const rows = summaryA.results.map((ra, i) => {
      const rb = summaryB.results[i];
      const aVal = ra.isError ? undefined : (ra.result as FormulaLiteralResult).value;
      const bVal = rb.isError ? undefined : (rb.result as FormulaLiteralResult).value;
      const same = !ra.isError && !rb.isError ? valuesMatch(aVal, bVal) : ra.isError === rb.isError;
      if (!same) differences++;
      return {
        record: `#${i + 1}`,
        A: resultCell(ra),
        B: resultCell(rb),
        match: same ? '✅' : '❌',
      };
    });

    uxLogTable(this, rows, ['record', 'A', 'B', 'match']);

    if (differences === 0) {
      uxLog('action', this, c.green(`Formulas are equivalent across all ${records.length} record(s).`));
    } else {
      uxLog('warning', this, c.yellow(`${differences} of ${records.length} record(s) differ.`));
    }

    process.exitCode = flags.strict && differences > 0 ? 1 : 0;
    return { formulaA, formulaB, differences, total: records.length, equivalent: differences === 0 } as AnyJson;
  }
}
