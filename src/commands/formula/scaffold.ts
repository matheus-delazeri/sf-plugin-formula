import { writeFileSync, existsSync } from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { extract } from '@steedos/formula';
import c from 'chalk';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from 'sfdx-hardis/plugin-api';
import {
  describeSObjectFieldTypes,
  pullFormulaField,
  queryRecordVariableMaps,
  type FieldTypeInfo,
} from '../../utils/orgUtils.js';
import type { FormulaVariableMap, FormulaVariable, FormulaDataType } from '../../utils/formulaUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-formula', 'sf-plugin-formula.scaffold');

function placeholderValue(dataType: FormulaDataType): unknown {
  switch (dataType) {
    case 'number':
      return 0;
    case 'checkbox':
      return false;
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'datetime':
      return new Date().toISOString();
    case 'time':
      return '09:00:00';
    case 'null':
      return null;
    default:
      return '';
  }
}

export default class FormulaScaffold extends SfCommand<AnyJson> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = [messages.getMessage('examples')];

  public static readonly flags = {
    formula: Flags.string({ char: 'f', summary: messages.getMessage('flags.formula.summary') }),
    field: Flags.string({ summary: messages.getMessage('flags.field.summary') }),
    sobject: Flags.string({ char: 's', summary: messages.getMessage('flags.sobject.summary') }),
    query: Flags.string({ char: 'q', summary: messages.getMessage('flags.query.summary') }),
    'target-org': Flags.optionalOrg(),
    outputfile: Flags.string({ default: './formula.json', summary: messages.getMessage('flags.outputfile.summary') }),
    records: Flags.integer({ default: 1, summary: messages.getMessage('flags.records.summary') }),
    force: Flags.boolean({ default: false, summary: messages.getMessage('flags.force.summary') }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FormulaScaffold);
    const org = flags['target-org'];
    // eslint-disable-next-line sf-plugin/get-connection-with-version
    const conn = org?.getConnection();

    let formula = flags.formula;
    let sobject = flags.sobject;

    if (flags.field) {
      if (!conn) throw new Error('--field requires a --target-org connection.');
      const pulled = await pullFormulaField(conn, flags.field);
      formula = pulled.formula;
      sobject = sobject ?? pulled.sobject;
      uxLog('action', this, c.cyan(`Pulled formula from ${flags.field}.`));
    }

    if (!formula) throw new Error('Provide a formula via --formula or --field.');

    if (existsSync(flags.outputfile) && !flags.force) {
      throw new Error(`${flags.outputfile} already exists. Use --force to overwrite.`);
    }

    let referenced: string[] = [];
    try {
      referenced = (extract as (f: string) => string[])(formula);
    } catch (_) {
      referenced = [];
    }

    let typeMap = new Map<string, FieldTypeInfo>();
    if (conn && sobject) {
      typeMap = await describeSObjectFieldTypes(conn, sobject);
      uxLog('log', this, c.grey(`Inferred types from ${sobject}.`));
    }

    let records: FormulaVariableMap[];
    if (flags.query) {
      if (!conn) throw new Error('--query requires a --target-org connection.');
      records = await queryRecordVariableMaps(conn, flags.query, typeMap, referenced);
      uxLog('action', this, c.cyan(`Prefilled ${records.length} record(s) from the org.`));
    } else {
      const buildRecord = (): FormulaVariableMap => {
        const rec: FormulaVariableMap = {};
        for (const field of referenced) {
          const info = typeMap.get(field);
          const dataType = info?.dataType ?? 'text';
          rec[field] = {
            type: 'literal',
            dataType,
            value: placeholderValue(dataType),
            options: info?.options ?? {},
          } as FormulaVariable;
        }
        return rec;
      };
      records = Array.from({ length: Math.max(1, flags.records) }, buildRecord);
    }

    const scaffold = { formula, records };
    writeFileSync(flags.outputfile, JSON.stringify(scaffold, null, 2), 'utf-8');
    uxLog('success', this, c.green(`Scaffold written to ${flags.outputfile} (${records.length} record(s)).`));

    return scaffold as AnyJson;
  }
}
