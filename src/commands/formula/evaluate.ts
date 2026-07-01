import { readFileSync, watchFile } from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { extract } from '@steedos/formula';
import c from 'chalk';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog, prompts, PromptsQuestion } from 'sfdx-hardis/plugin-api';
import {
  evaluateFormulaForRecords,
  formatEvaluationSummary,
  summaryToJson,
  buildModelJson,
  exitCodeFor,
  type FormulaVariableMap,
  type FormulaEvaluationSummary,
  type FormulaDataType,
  type FormulaEvaluationResult,
  type FormulaVariable,
} from '../../utils/formulaUtils.js';
import {
  describeSObjectFieldTypes,
  pullFormulaField,
  queryRecordVariableMaps,
  type FieldTypeInfo,
} from '../../utils/orgUtils.js';
import { renderSummaryTable, serializeSummaries, writeToFile } from '../../utils/ioUtils.js';
import { type OutputFormat } from '../../utils/reportUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-formula', 'sf-plugin-formula.evaluate');

type InputFileJson = { formula: string; records: FormulaVariableMap[] };
type PromptAnswer = Record<string, unknown>;

export default class FormulaEvaluate extends SfCommand<AnyJson> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = [messages.getMessage('examples')];

  public static readonly flags = {
    formula: Flags.string({ char: 'f', summary: messages.getMessage('flags.formula.summary') }),
    records: Flags.string({ char: 'r', summary: messages.getMessage('flags.records.summary') }),
    inputfile: Flags.string({ char: 'x', summary: messages.getMessage('flags.inputfile.summary') }),
    field: Flags.string({ summary: messages.getMessage('flags.field.summary') }),
    sobject: Flags.string({ char: 's', summary: messages.getMessage('flags.sobject.summary') }),
    query: Flags.string({ char: 'q', summary: messages.getMessage('flags.query.summary') }),
    'target-org': Flags.optionalOrg(),
    'output-format': Flags.string({
      summary: messages.getMessage('flags.output-format.summary'),
      options: ['table', 'json', 'csv', 'markdown'],
      default: 'table',
    }),
    outputfile: Flags.string({ summary: messages.getMessage('flags.outputfile.summary') }),
    tolerance: Flags.integer({ summary: messages.getMessage('flags.tolerance.summary') }),
    strict: Flags.boolean({ default: false, summary: messages.getMessage('flags.strict.summary') }),
    watch: Flags.boolean({ default: false, summary: messages.getMessage('flags.watch.summary') }),
    debug: Flags.boolean({ char: 'd', default: false, summary: messages.getMessage('flags.debug.summary') }),
  };

  private static buildVariablePrompt(varName: string, dataType: FormulaDataType): PromptsQuestion {
    const base = { name: varName, description: `Value for the "${varName}" field (${dataType})`, placeholder: '' };
    switch (dataType) {
      case 'checkbox':
        return {
          ...base,
          type: 'select',
          message: `Value for "${varName}" (checkbox)`,
          choices: [
            { title: 'TRUE', value: 'true' },
            { title: 'FALSE', value: 'false' },
          ],
        };
      case 'number':
        return {
          ...base,
          type: 'text',
          message: `Value for "${varName}" (number)`,
          placeholder: '0',
          validate: (v: string) => (v?.trim() === '' || !isNaN(Number(v)) ? true : 'Please enter a valid number'),
        };
      case 'date':
        return {
          ...base,
          type: 'text',
          message: `Value for "${varName}" (date: YYYY-MM-DD)`,
          placeholder: new Date().toISOString().slice(0, 10),
          validate: (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v?.trim()) ? true : 'Use YYYY-MM-DD format'),
        };
      case 'datetime':
        return {
          ...base,
          type: 'text',
          message: `Value for "${varName}" (datetime: ISO 8601)`,
          placeholder: new Date().toISOString(),
          validate: (v: string) => (!isNaN(Date.parse(v?.trim())) ? true : 'Enter a valid ISO 8601 datetime string'),
        };
      case 'time':
        return {
          ...base,
          type: 'text',
          message: `Value for "${varName}" (time: HH:MM:SS)`,
          placeholder: '09:00:00',
          validate: (v: string) => (/^\d{2}:\d{2}(:\d{2})?$/.test(v?.trim()) ? true : 'Use HH:MM or HH:MM:SS format'),
        };
      case 'null':
        return { ...base, type: 'confirm', message: `"${varName}" will be set to null. Confirm?`, initial: true };
      default:
        return { ...base, type: 'text', message: `Value for "${varName}" (text)` };
    }
  }

  private static coerceValue(raw: unknown, dataType: FormulaDataType): unknown {
    switch (dataType) {
      case 'checkbox':
        return raw === 'true' || raw === true;
      case 'number':
        return raw === '' || raw === undefined ? 0 : Number(raw);
      case 'date':
      case 'datetime':
      case 'time':
        return new Date(raw as string);
      case 'null':
        return null;
      default:
        return raw ?? '';
    }
  }

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(FormulaEvaluate);
    const debugMode: boolean = flags.debug ?? false;
    const outputFormat = flags['output-format'] as OutputFormat;
    const org = flags['target-org'];
    // eslint-disable-next-line sf-plugin/get-connection-with-version
    const conn = org?.getConnection();

    let formula: string | undefined = flags.formula;
    let sobject: string | undefined = flags.sobject;

    if (flags.field) {
      if (!conn) throw new Error('--field requires a --target-org connection.');
      const pulled = await pullFormulaField(conn, flags.field);
      formula = pulled.formula;
      sobject = sobject ?? pulled.sobject;
      uxLog('action', this, c.cyan(`Pulled formula from ${flags.field}: ${formula}`));
    }

    if (flags.inputfile && !flags.field) {
      const inputPath: string = flags.inputfile;
      const runOnce = (): FormulaEvaluationSummary => {
        const raw = JSON.parse(readFileSync(inputPath, 'utf-8')) as InputFileJson;
        if (typeof raw?.formula !== 'string') throw new Error(`"formula" key (string) is required in ${inputPath}`);
        if (!Array.isArray(raw?.records)) throw new Error(`"records" key (array) is required in ${inputPath}`);
        const summary = this.evaluate(raw.formula, raw.records, flags.tolerance);
        this.display(summary, debugMode, outputFormat, flags.outputfile);
        return summary;
      };

      let summary = runOnce();
      if (flags.watch) {
        uxLog('action', this, c.cyan(`Watching ${inputPath} for changes (Ctrl+C to stop)…`));
        watchFile(inputPath, { interval: 400 }, () => {
          try {
            summary = runOnce();
          } catch (e) {
            uxLog('error', this, c.red((e as Error).message));
          }
        });
        return summaryToJson(summary) as AnyJson;
      }
      process.exitCode = exitCodeFor(summary, flags.strict);
      return summaryToJson(summary) as AnyJson;
    }

    let typeMap = new Map<string, FieldTypeInfo>();
    if (conn && sobject) {
      typeMap = await describeSObjectFieldTypes(conn, sobject);
      uxLog('log', this, c.grey(`Described ${sobject}: ${typeMap.size} fields.`));
    }

    if (formula) {
      let records: FormulaVariableMap[] | null = null;
      const referenced = this.safeExtract(formula);

      if (flags.query) {
        if (!conn) throw new Error('--query requires a --target-org connection.');
        records = await queryRecordVariableMaps(conn, flags.query, typeMap, referenced);
        uxLog('action', this, c.cyan(`Pulled ${records.length} record(s) from the org.`));
      } else if (flags.records) {
        try {
          const parsed = JSON.parse(flags.records) as unknown;
          if (!Array.isArray(parsed)) throw new Error('--records must be a JSON array.');
          records = parsed as FormulaVariableMap[];
        } catch (e) {
          throw new Error(`Failed to parse --records as JSON: ${(e as Error).message}`);
        }
      }

      records = records ?? [{}];
      const summary = this.evaluate(formula, records, flags.tolerance);
      this.display(summary, debugMode, outputFormat, flags.outputfile);
      process.exitCode = exitCodeFor(summary, flags.strict);
      return summaryToJson(summary) as AnyJson;
    }

    const modeAnswer = await prompts({
      type: 'select',
      name: 'mode',
      message: 'How do you want to evaluate the formula?',
      description:
        'Interactive mode lets you fill in values manually and repeat. JSON mode evaluates a set of records.',
      choices: [
        { title: '✏️  [Interactive] fill in values manually (repeatable)', value: 'interactive' },
        { title: '📄  [JSON format] evaluate a set of records from a JSON file', value: 'json' },
      ],
    });

    let lastSummary: FormulaEvaluationSummary;
    if (modeAnswer.mode === 'json') {
      lastSummary = await this.runJsonContent(debugMode, outputFormat, flags.outputfile, flags.tolerance);
    } else {
      const formulaAnswer = await prompts({
        type: 'text',
        name: 'formula',
        message: 'Enter the Salesforce formula to evaluate',
        description: 'Example: IF(IsActive__c, Amount__c * 1.1, Amount__c)',
        placeholder: 'IF(Active__c, "Yes", "No")',
        validate: (v: string) => (v?.trim() ? true : 'Formula cannot be empty'),
      });
      const enteredFormula = (formulaAnswer.formula as string).trim();
      const referencedVariables = this.safeExtract(enteredFormula);
      lastSummary = await this.runInteractiveLoop(
        enteredFormula,
        referencedVariables,
        debugMode,
        outputFormat,
        flags.outputfile,
        flags.tolerance,
        typeMap
      );
    }
    process.exitCode = exitCodeFor(lastSummary, flags.strict);
    return summaryToJson(lastSummary) as AnyJson;
  }

  // eslint-disable-next-line class-methods-use-this
  private safeExtract(formula: string): string[] {
    try {
      return (extract as (f: string) => string[])(formula);
    } catch (_) {
      return [];
    }
  }

  private async runInteractiveLoop(
    formula: string,
    referencedVariables: string[],
    debugMode: boolean,
    outputFormat: OutputFormat,
    outputfile: string | undefined,
    tolerance: number | undefined,
    typeMap: Map<string, FieldTypeInfo>
  ): Promise<FormulaEvaluationSummary> {
    let summary: FormulaEvaluationSummary | null = null;
    let keepGoing = true;
    let iterationCount = 0;
    const evaluatedRecords: FormulaEvaluationResult[] = [];

    while (keepGoing) {
      iterationCount++;
      uxLog('log', this, c.cyan(`\n[Evaluation ${iterationCount}]`));
      const record: FormulaVariableMap = {};

      if (referencedVariables.length > 0) {
        for (const varName of referencedVariables) {
          const inferred = typeMap.get(varName)?.dataType;
          let dataType: FormulaDataType;
          if (inferred) {
            dataType = inferred;
            uxLog('log', this, c.grey(`  ${varName}: using org-inferred type "${dataType}".`));
          } else {
            // eslint-disable-next-line no-await-in-loop
            const typeAnswer: PromptAnswer = await prompts({
              type: 'select',
              name: 'dataType',
              message: `Data type for "${varName}"`,
              description: `Select the Salesforce field type that matches ${varName}`,
              choices: [
                { title: 'Text', value: 'text' },
                { title: 'Number', value: 'number' },
                { title: 'Checkbox', value: 'checkbox' },
                { title: 'Date', value: 'date' },
                { title: 'Time', value: 'time' },
                { title: 'Datetime', value: 'datetime' },
                { title: 'Picklist', value: 'picklist' },
                { title: 'MultiPicklist', value: 'multipicklist' },
                { title: 'Null', value: 'null' },
              ],
            });
            dataType = typeAnswer.dataType as FormulaDataType;
          }

          const varQuestion = FormulaEvaluate.buildVariablePrompt(varName, dataType);
          // eslint-disable-next-line no-await-in-loop
          const varAnswer: PromptAnswer = await prompts(varQuestion);
          record[varName] = {
            type: 'literal',
            dataType,
            value: FormulaEvaluate.coerceValue(varAnswer[varName], dataType),
            options: typeMap.get(varName)?.options ?? {},
          } as FormulaVariable;
        }
      } else {
        uxLog('log', this, c.grey('No field variables detected. Evaluating as a constant formula.'));
      }

      const iterationSummary = this.evaluate(formula, [record], tolerance);
      evaluatedRecords.push(...iterationSummary.results);
      const mergedResults = evaluatedRecords.map((r, idx) => ({ ...r, recordIndex: idx }));
      summary = {
        ...iterationSummary,
        results: mergedResults,
        successCount: mergedResults.filter((r) => !r.isError).length,
        errorCount: mergedResults.filter((r) => r.isError).length,
        assertionsEvaluated: mergedResults.filter((r) => r.assertion !== undefined).length,
        assertionFailures: mergedResults.filter((r) => r.assertion !== undefined && !r.assertion.passed).length,
      };
      this.display(summary, debugMode, outputFormat, outputfile);

      // eslint-disable-next-line no-await-in-loop
      const repeatAnswer: PromptAnswer = await prompts({
        type: 'confirm',
        name: 'repeat',
        message: 'Evaluate again with different values?',
        description: 'Select Yes to enter new variable values and re-evaluate the same formula.',
        initial: false,
      });
      keepGoing = repeatAnswer.repeat === true;
    }
    return summary!;
  }

  private async runJsonContent(
    debugMode: boolean,
    outputFormat: OutputFormat,
    outputfile: string | undefined,
    tolerance: number | undefined
  ): Promise<FormulaEvaluationSummary> {
    const modelContent = JSON.stringify(buildModelJson("IF(MyField__c, 'Yes', 'No')"), null, 2);
    const fileAnswer: PromptAnswer = await prompts({
      type: 'text',
      name: 'fileContent',
      message: 'JSON content for multi-evaluation',
      description: 'Edit the "records" array. Each field key maps to a formula variable.',
      placeholder: modelContent,
      initial: modelContent,
      validate: (v: string) => {
        try {
          const parsed = JSON.parse(v) as Record<string, unknown>;
          if (typeof parsed?.formula !== 'string') return '"formula" key (string) is required';
          if (!Array.isArray(parsed?.records)) return '"records" key (array) is required';
          return true;
        } catch (_) {
          return 'Invalid JSON';
        }
      },
    });

    const raw = JSON.parse(fileAnswer.fileContent as string) as InputFileJson;
    const fileRecords: FormulaVariableMap[] = Array.isArray(raw?.records) ? raw.records : [];
    if (fileRecords.length === 0)
      throw new Error('No records found. Provide a "records" array with at least one entry.');
    const summary = this.evaluate(raw.formula, fileRecords, tolerance);
    this.display(summary, debugMode, outputFormat, outputfile);
    return summary;
  }

  private evaluate(
    formula: string,
    records: FormulaVariableMap[],
    tolerance: number | undefined
  ): FormulaEvaluationSummary {
    uxLog('log', this, c.grey(`\nEvaluating formula against ${records.length} record(s)…`));
    const normalized: FormulaVariableMap[] = records.map((record) =>
      Object.fromEntries(
        Object.entries(record).map(([key, descriptor]) => [key, { ...descriptor, type: 'literal' } as FormulaVariable])
      )
    );
    return evaluateFormulaForRecords(formula, normalized, { tolerance });
  }

  private display(
    summary: FormulaEvaluationSummary,
    debugMode: boolean,
    outputFormat: OutputFormat,
    outputfile: string | undefined
  ): void {
    renderSummaryTable(this, summary);

    if (outputFormat !== 'table') {
      const serialized = serializeSummaries([summary], outputFormat);
      if (outputfile) writeToFile(this, outputfile, serialized);
      else uxLog('other', this, serialized);
    } else if (outputfile) {
      writeToFile(this, outputfile, serializeSummaries([summary], 'json'));
    }

    if (debugMode) uxLog('log', this, c.grey(formatEvaluationSummary(summary)));
  }
}
