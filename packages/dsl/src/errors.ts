export class DSLParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly offset: number,
  ) {
    super(`${message} (line ${line}, col ${column})`);
    this.name = "DSLParseError";
  }
}
