Topic to revisit: `EPIPE` handling in `@effectionx/process` on POSIX

Current state:

- Tisyn's stdio transport can hit a shutdown/cancel race where writing to child stdin after the child has already exited surfaces as `EPIPE`.
- The likely lower-level cause is in `@effectionx/process` POSIX exec handling.
- Windows already suppresses `EPIPE` on stdin writes; POSIX appears not to.

Working diagnosis:

- in `process/src/exec/posix.ts`, `stdin.send()` writes directly to `childProcess.stdin`
- if the child is already gone, Node emits an `EPIPE` error on the stream
- without an `error` listener or equivalent normalization, that can surface as an uncaught exception

Planned follow-up:

1. reproduce the bug directly in `@effectionx/process`
2. add a minimal regression fixture and test there
3. patch POSIX handling to normalize benign write-after-exit `EPIPE`
4. remove or reduce any temporary Tisyn-side workaround after upgrading

Important boundary:

- if the bug is reproducible in `@effectionx/process`, fix it there
- if not, Tisyn still needs a local transport-side guard

Status:

- tracked from the stdio transport PR because that is where the issue surfaced
