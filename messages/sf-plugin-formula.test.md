# summary

Runs a suite of formula test cases and asserts their results (CI friendly).

# description

Loads one or more formula test cases from a JSON file or a directory of JSON files, evaluates each, and asserts the results using the `_expected` descriptor on each record. Returns a non-zero exit code when any assertion fails, any formula errors, or a snapshot mismatch is detected - making it suitable for CI pipelines.

A suite file may be:

- a single object `{ "formula": "...", "records": [...] }`,
- an array of such objects, or
- an object `{ "tests": [ { "name": "...", "formula": "...", "records": [...] } ] }`.

# flags.suite.summary

Path to a JSON test file or a directory of JSON test files.

# flags.output-format.summary

Report format: table (default), json or junit.

# flags.outputfile.summary

Write the serialized report (json/junit) to this file path.

# flags.snapshot.summary

Path to a snapshot file. Compares current results against it (or creates it if missing).

# flags.update-snapshot.summary

Overwrite the snapshot file with the current results.

# flags.tolerance.summary

Absolute numeric tolerance applied to value assertions.

# examples

- Run every test file in a directory:

  <%= config.bin %> <%= command.id %> --suite ./formula-tests

- Run a suite and emit a JUnit report for CI:

  <%= config.bin %> <%= command.id %> --suite ./tests.json --output-format junit --outputfile results.xml

- Run against a stored snapshot to catch regressions:

  <%= config.bin %> <%= command.id %> --suite ./tests.json --snapshot ./tests.snap.json
