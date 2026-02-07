// Output formatting following ivy-blackboard patterns

export function formatJson<T>(data: T, ok: boolean = true): string {
  const timestamp = new Date().toISOString();

  if (Array.isArray(data)) {
    return JSON.stringify(
      { ok, count: data.length, items: data, timestamp },
      null,
      2
    );
  }

  return JSON.stringify({ ok, ...(data as object), timestamp }, null, 2);
}

export function success(message: string): void {
  console.log(`  \u2713 ${message}`);
}

export function warning(message: string): void {
  console.log(`  \u26A0 ${message}`);
}

export function fail(message: string): void {
  console.log(`  \u2717 ${message}`);
}

export function header(title: string): void {
  console.log(`\n${title}`);
}

export function result(passed: boolean, message: string): void {
  console.log(`\nRESULT: ${passed ? "\u2713" : "\u2717"} ${message}`);
}
