# summary

Analyzes a Salesforce formula: dependencies, complexity, lint findings and branch coverage.

# description

Performs static analysis on a Salesforce formula without evaluating it (unless records are supplied for branch coverage). Reports referenced fields (including cross-object relationships), function usage, nesting depth, complexity metrics, and context-aware lint findings. When records are provided via `--inputfile`, it also reports IF() branch coverage.

Lint context (`--context`) tailors the rules: for example, `ISCHANGED`, `PRIORVALUE` and `REGEX` are flagged when used in a `formulaField` context where they are not available.

# flags.formula.summary

Salesforce formula to analyze.

# flags.inputfile.summary

Path to a JSON file with "formula" (and optional "records" for branch coverage).

# flags.field.summary

Pull the formula from an existing org formula field ("Object.Field\_\_c"). Requires --target-org.

# flags.context.summary

Context for lint rules: formulaField, validationRule, flow or default.

# flags.strict.summary

Return a non-zero exit code when any error-severity lint finding is present.

# flags.debug.summary

Activate debug mode (more logs).

# examples

- Analyze a formula for a formula field:

  <%= config.bin %> <%= command.id %> --formula 'IF(ISCHANGED(Status\_\_c), 1, 0)' --context formulaField

- Analyze an org formula field with branch coverage from a records file:

  <%= config.bin %> <%= command.id %> --field Opportunity.Health\_\_c --inputfile ./records.json --target-org myOrg
