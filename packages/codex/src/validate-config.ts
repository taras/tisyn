/**
 * Codex config validation rules.
 *
 * CX-V-1: approval must be "on-request" or "never"
 * CX-V-2: sandbox must be one of three valid values
 * CX-V-3: model must be non-empty if provided
 * CX-V-4: command must be non-empty if provided (exec only)
 */

const VALID_APPROVAL = new Set(["on-request", "never"]);
const HEADLESS_INCOMPATIBLE = new Set(["untrusted", "on-failure"]);
const VALID_SANDBOX = new Set(["read-only", "workspace-write", "danger-full-access"]);

export function validateApproval(approval: string | undefined): void {
  if (approval === undefined) {
    return;
  }
  if (HEADLESS_INCOMPATIBLE.has(approval)) {
    throw new Error(
      `Approval policy "${approval}" is not compatible with headless execution. ` +
        `Use "on-request" or "never".`,
    );
  }
  if (!VALID_APPROVAL.has(approval)) {
    throw new Error(`Invalid approval policy "${approval}". ` + `Must be "on-request" or "never".`);
  }
}

export function validateSandbox(sandbox: string | undefined): void {
  if (sandbox === undefined) {
    return;
  }
  if (!VALID_SANDBOX.has(sandbox)) {
    throw new Error(
      `Invalid sandbox mode "${sandbox}". ` +
        `Must be "read-only", "workspace-write", or "danger-full-access".`,
    );
  }
}

export function validateModel(model: string | undefined): void {
  if (model === undefined) {
    return;
  }
  if (model === "") {
    throw new Error("Model must be a non-empty string if provided.");
  }
}

export function validateCommand(command: string | undefined): void {
  if (command === undefined) {
    return;
  }
  if (command === "") {
    throw new Error("Command must be a non-empty string if provided.");
  }
}
