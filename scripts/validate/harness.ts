/** The check harness: pass/fail lines, section headings and the final tally. */

let failures = 0;
let checks = 0;

export function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`  \u001B[32mPASS\u001B[0m ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  \u001B[31mFAIL\u001B[0m ${name}${detail ? `  ${detail}` : ''}`);
  }
}

export function near(name: string, actual: number, expected: number, tol: number, unit = ''): void {
  const d = Math.abs(actual - expected);
  ok(name, d <= tol, `got ${actual.toFixed(6)}${unit}, expected ${expected}±${tol}${unit}`);
}

export function section(title: string): void {
  console.log(`\n\u001B[1m${title}\u001B[0m`);
}

/** Print the tally, and fail the process if anything failed. */
export function report(): void {
  console.log(
    `\n\u001B[1m${checks - failures}/${checks} checks passed\u001B[0m${failures ? ` \u001B[31m(${failures} failed)\u001B[0m` : ''}\n`,
  );
  if (failures > 0) {
    process.exit(1);
  }
}
