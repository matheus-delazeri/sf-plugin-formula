# summary

Evaluates two formulas against the same records and reports where they diverge.

# description

Evaluates two formulas (A and B) against the same set of records and shows, per record, both results and whether they match. Useful for proving a refactor is equivalent to the original formula. With `--strict`, returns a non-zero exit code if any record differs.

# flags.formula.summary

First formula (A).

# flags.formula-b.summary

Second formula (B).

# flags.records.summary

JSON array of record variable maps to evaluate both formulas against.

# flags.inputfile.summary

Path to a JSON file with "formula", "formulaB" and "records".

# flags.strict.summary

Return a non-zero exit code when any record's results differ.

# examples

- Prove a refactor is equivalent:

  <%= config.bin %> <%= command.id %> --formula 'A**c + B**c' --formula-b 'B**c + A**c' --records '[{"A__c":{"dataType":"number","value":2},"B__c":{"dataType":"number","value":3}}]'

- Diff two formulas over a records file:

  <%= config.bin %> <%= command.id %> --inputfile ./diff.json --strict
