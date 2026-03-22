// Suppress EPIPE errors from @effectionx/process stdin writes.
// When the session sends shutdown and the child process exits before the
// write callback fires, Node emits EPIPE on childProcess.stdin.
// @effectionx/process doesn't add an error handler on stdin, so these
// surface as uncaught exceptions. This is harmless — the process is
// already exiting.
process.on("uncaughtException", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
  throw err;
});
