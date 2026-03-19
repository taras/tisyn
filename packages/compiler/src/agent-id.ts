/**
 * PascalCase → kebab-case agent ID conversion.
 *
 * Per Compiler Spec §4.2:
 *   OrderService → "order-service"
 *   PlayerA → "player-a"
 *   FraudDetector → "fraud-detector"
 *
 * Strict: insert "-" before each uppercase letter (except leading),
 * then lowercase everything.
 */

export function toAgentId(pascalCase: string): string {
  return pascalCase.replace(/([A-Z])/g, (match, _char, offset) =>
    offset === 0 ? match.toLowerCase() : `-${match.toLowerCase()}`,
  );
}
