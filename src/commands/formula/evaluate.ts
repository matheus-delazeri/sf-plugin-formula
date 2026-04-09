import { readFileSync } from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { extract } from '@steedos/formula';
import c from 'chalk';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog, uxLogTable, prompts, PromptsQuestion } from 'sfdx-hardis/plugin-api';
import {
  evaluateFormulaForRecords,
  formatEvaluationSummary,
  summaryToJson,
  buildModelJson,
  type FormulaVariableMap,
  type FormulaEvaluationSummary,
  type FormulaDataType,
  type FormulaEvaluationResult,
  type FormulaVariable,
  type FormulaLiteralResult,
  type FormulaErrorResult,
  EXPECTED_KEY,
} from '../../utils/formulaUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-formula', 'sf-plugin-formula.evaluate');

type InputFileJson = {
  formula: string;
  records: FormulaVariableMap[];
};

type PromptAnswer = Record<string, unknown>;

export default class FormulaEvaluate extends SfCommand<AnyJson> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = [messages.getMessage('examples')];

  public static readonly flags = {
    formula: Flags.string({
      char: 'f',
      summary: messages.getMessage('flags.formula.summary'),
      description: messages.getMessage('flags.formula.description'),
    }),
    records: Flags.string({
      char: 'r',
      summary: messages.getMessage('flags.records.summary'),
      description: messages.getMessage('flags.records.description'),
    }),
    inputfile: Flags.string({
      char: 'x',
      summary: messages.getMessage('flags.inputfile.summary'),
      description: messages.getMessage('flags.inputfile.description'),
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      summary: messages.getMessage('flags.debug.summary'),
    }),
  };

  private static buildVariablePrompt(varName: string, dataType: FormulaDataType): PromptsQuestion {
    const base = {
      name: varName,
      description: `Value for the "${varName}" field (${dataType})`,
      placeholder: '',
    };

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
        return {
          ...base,
          type: 'confirm',
          message: `"${varName}" will be set to null. Confirm?`,
          initial: true,
        };
      default:
        return {
          ...base,
          type: 'text',
          message: `Value for "${varName}" (text)`,
        };
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
    let formula: string;
    let records: FormulaVariableMap[] | null = null;
    let lastSummary: FormulaEvaluationSummary | null = null;

    if (flags.inputfile) {
      uxLog('log', this, c.grey(`Reading formula and records from ${flags.inputfile}…`));
      const fileContent = readFileSync(flags.inputfile, 'utf-8');
      const raw = JSON.parse(fileContent) as InputFileJson;

      if (typeof raw?.formula !== 'string') {
        throw new Error(`"formula" key (string) is required in ${flags.inputfile}`);
      }
      if (!Array.isArray(raw?.records)) {
        throw new Error(`"records" key (array) is required in ${flags.inputfile}`);
      }

      formula = raw.formula;
      records = raw.records;
      lastSummary = this.evaluate(formula, records);
      this.display(lastSummary, debugMode);
      return summaryToJson(lastSummary) as AnyJson;
    }

    if (flags.formula) {
      formula = flags.formula;

      if (flags.records) {
        try {
          const parsed = JSON.parse(flags.records) as unknown;
          if (!Array.isArray(parsed)) throw new Error('--records must be a JSON array.');
          records = parsed as FormulaVariableMap[];
        } catch (e) {
          throw new Error(`Failed to parse --records as JSON: ${(e as Error).message}`);
        }
      }

      records = records ?? [{}];
      lastSummary = this.evaluate(formula, records);
      this.display(lastSummary, debugMode);
      return summaryToJson(lastSummary) as AnyJson;
    }

    const modeAnswer = await prompts({
      type: 'select',
      name: 'mode',
      message: 'How do you want to evaluate the formula?',
      description:
        'Interactive mode lets you fill in values manually and repeat. JSON mode evaluates a set of records from a file.',
      choices: [
        { title: '✏️  [Interactive] fill in values manually (repeatable)', value: 'interactive' },
        { title: '📄  [JSON format] evaluate a set of records from a JSON file', value: 'json' },
      ],
    });

    if (modeAnswer.mode === 'json') {
      lastSummary = await this.runJsonContent(debugMode);
    } else {
      const formulaAnswer = await prompts({
        type: 'text',
        name: 'formula',
        message: 'Enter the Salesforce formula to evaluate',
        description: 'Example: IF(IsActive__c, Amount__c * 1.1, Amount__c)',
        placeholder: 'IF(Active__c, "Yes", "No")',
        validate: (v: string) => (v?.trim() ? true : 'Formula cannot be empty'),
      });

      formula = (formulaAnswer.formula as string).trim();
      const referencedVariables = (extract as (f: string) => string[])(formula);
      lastSummary = await this.runInteractiveLoop(formula, referencedVariables, debugMode);
    }

    return summaryToJson(lastSummary) as AnyJson;
  }

  private async runInteractiveLoop(
    formula: string,
    referencedVariables: string[],
    debugMode: boolean
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

          const dataType = typeAnswer.dataType as FormulaDataType;
          const varQuestion = FormulaEvaluate.buildVariablePrompt(varName, dataType);
          // eslint-disable-next-line no-await-in-loop
          const varAnswer: PromptAnswer = await prompts(varQuestion);
          const rawValue = varAnswer[varName];

          record[varName] = {
            type: 'literal',
            dataType,
            value: FormulaEvaluate.coerceValue(rawValue, dataType),
          };
        }
      } else {
        uxLog('log', this, c.grey('No field variables detected. Evaluating as a constant formula.'));
      }

      const iterationSummary = this.evaluate(formula, [record]);
      evaluatedRecords.push(...iterationSummary.results);

      const mergedResults: FormulaEvaluationResult[] = evaluatedRecords.map((r, idx) => ({
        ...r,
        recordIndex: idx,
      }));

      summary = {
        ...iterationSummary,
        results: mergedResults,
        successCount: mergedResults.filter((r) => !r.isError).length,
        errorCount: mergedResults.filter((r) => r.isError).length,
      };

      this.display(summary, debugMode);

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

  private async runJsonContent(debugMode: boolean): Promise<FormulaEvaluationSummary> {
    const modelContent = JSON.stringify(buildModelJson("IF(MyField__c, 'Yes', 'No')"), null, 2);

    const fileAnswer: PromptAnswer = await prompts({
      type: 'text',
      name: 'fileContent',
      message: 'JSON content for multi-evaluation',
      description:
        'Edit the "records" array. Each field key maps to a formula variable. Supported dataType values: text | number | checkbox | date | time | datetime | geolocation | null',
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

    uxLog('log', this, c.grey('Reading records from JSON…'));

    try {
      const raw = JSON.parse(fileAnswer.fileContent as string) as InputFileJson;
      const resolvedFormula: string = raw.formula;
      const fileRecords: FormulaVariableMap[] = Array.isArray(raw?.records) ? raw.records : [];

      if (fileRecords.length === 0) {
        throw new Error('No records found. Make sure the JSON has a "records" array with at least one entry.');
      }

      const summary = this.evaluate(resolvedFormula, fileRecords);
      this.display(summary, debugMode);
      return summary;
    } catch (_) {
      throw new Error('The JSON provided is invalid.');
    }
  }

  private evaluate(formula: string, records: FormulaVariableMap[]): FormulaEvaluationSummary {
    uxLog('log', this, c.grey(`\nEvaluating formula against ${records.length} record(s)…`));

    const normalizedRecords: FormulaVariableMap[] = records.map((record) =>
      Object.fromEntries(
        Object.entries(record).map(([key, descriptor]) => [key, { ...descriptor, type: 'literal' } as FormulaVariable])
      )
    );

    return evaluateFormulaForRecords(formula, normalizedRecords);
  }

  private display(summary: FormulaEvaluationSummary, debugMode: boolean): void {
    const variableColumns = [
      ...new Set(summary.results.flatMap((r) => Object.keys(r.variables).filter((k) => k !== EXPECTED_KEY))),
    ];

    const hasExpected = summary.results.some((r) => r.expected !== undefined);

    const columns = [
      'record',
      ...variableColumns.map((v) => `${v}_type`),
      ...variableColumns.map((v) => `${v}_value`),
      'result_type',
      'result_value',
      'status',
      ...(hasExpected ? ['expected', 'assertion'] : []),
    ];

    uxLog('success', this, c.green('Formula evaluation results'));
    uxLog('other', this, c.white(`Formula: ${summary.formula}`));

    const tableRows = summary.results.map((r) => {
      const row: Record<string, string> = {
        record: `#${r.recordIndex + 1}`,
      };

      for (const varName of variableColumns) {
        const varDescriptor = r.variables[varName];
        row[`${varName}_type`] = varDescriptor?.dataType ?? '-';
        row[`${varName}_value`] = varDescriptor !== undefined ? JSON.stringify(varDescriptor.value) : '-';
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

      if (hasExpected) {
        if (r.expected === undefined) {
          row['expected'] = '-';
          row['assertion'] = '-';
        } else {
          const actualValue = r.isError ? undefined : (r.result as FormulaLiteralResult).value;
          // eslint-disable-next-line eqeqeq
          const passed = !r.isError && actualValue == r.expected;
          row['expected'] = JSON.stringify(r.expected);
          row['assertion'] = passed
            ? '✅ PASS'
            : `❌ FAIL - expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(actualValue)}`;
        }
      }

      return row;
    });

    uxLogTable(this, tableRows, columns);

    const assertionFailures = hasExpected
      ? summary.results.filter((r) => {
          if (r.expected === undefined) return false;
          if (r.isError) return true;
          // eslint-disable-next-line eqeqeq
          return (r.result as FormulaLiteralResult).value != r.expected;
        }).length
      : 0;

    if (summary.errorCount === 0 && assertionFailures === 0) {
      uxLog('action', this, c.green(`Formula evaluated successfully for all ${summary.successCount} record(s).`));
    } else {
      if (summary.errorCount > 0) {
        uxLog(
          'warning',
          this,
          c.yellow(`Evaluation complete: ${summary.successCount} succeeded, ${summary.errorCount} failed.`)
        );
      }
      if (assertionFailures > 0) {
        uxLog(
          'warning',
          this,
          c.red(`Assertion failures: ${assertionFailures} record(s) did not match the expected value.`)
        );
      }
    }

    if (debugMode) {
      uxLog('log', this, c.grey(formatEvaluationSummary(summary)));
    }
  }
}
