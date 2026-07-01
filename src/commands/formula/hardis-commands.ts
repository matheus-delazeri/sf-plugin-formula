import { SfCommand } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';

export default class HardisCommands extends SfCommand<AnyJson> {
  public static readonly summary = 'Expose SF Plugin custom menus to the sfdx-hardis VS Code extension';

  public static readonly examples = ['$ sf formula:hardis-commands --json'];

  public static readonly aliases = ['sf-plugin-formula:hardis-commands'];

  public static readonly hidden = true;

  public static readonly requiresProject = false;

  // eslint-disable-next-line @typescript-eslint/require-await, class-methods-use-this
  public async run(): Promise<AnyJson> {
    const help = 'https://github.com/matheus-delazeri/sf-plugin-formula';
    return {
      customCommands: [
        {
          id: 'sf-plugin-formula',
          label: 'Formula Evaluator',
          description: 'Tools for handling Salesforce formulas',
          vscodeIcon: 'symbol-operator',
          sldsIcon: 'utility:formula',
          commands: [
            {
              id: 'formula-evaluate',
              label: 'Evaluate Formula',
              command: 'sf formula:evaluate',
              tooltip: 'Evaluate a Salesforce formula against one or more records.',
              helpUrl: help,
              icon: 'default.svg',
              vscodeIcon: 'play',
              sldsIcon: 'utility:play',
            },
            {
              id: 'formula-test',
              label: 'Test Formulas',
              command: 'sf formula:test',
              tooltip: 'Run a suite of formula test cases with assertions (CI friendly).',
              helpUrl: help,
              icon: 'default.svg',
              vscodeIcon: 'beaker',
              sldsIcon: 'utility:test',
            },
            {
              id: 'formula-analyze',
              label: 'Analyze Formula',
              command: 'sf formula:analyze',
              tooltip: 'Static analysis: dependencies, complexity, lint and branch coverage.',
              helpUrl: help,
              icon: 'default.svg',
              vscodeIcon: 'search',
              sldsIcon: 'utility:search',
            },
            {
              id: 'formula-scaffold',
              label: 'Scaffold Formula Input',
              command: 'sf formula:scaffold',
              tooltip: 'Generate a ready-to-fill input JSON template for a formula.',
              helpUrl: help,
              icon: 'default.svg',
              vscodeIcon: 'new-file',
              sldsIcon: 'utility:new',
            },
            {
              id: 'formula-diff',
              label: 'Diff Formulas',
              command: 'sf formula:diff',
              tooltip: 'Compare two formulas across the same records to check equivalence.',
              helpUrl: help,
              icon: 'default.svg',
              vscodeIcon: 'diff',
              sldsIcon: 'utility:comparison',
            },
          ],
        },
      ],
    };
  }
}
