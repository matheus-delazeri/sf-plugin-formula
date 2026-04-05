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
              tooltip: 'Evaluates a Salesforce formula against one or more records and returns the result for each.',
              helpUrl: 'https://github.com/matheus-delazeri/sf-plugin-formula',
              icon: 'default.svg',
              vscodeIcon: 'play',
              sldsIcon: 'utility:play',
            },
          ],
        },
      ],
    };
  }
}
