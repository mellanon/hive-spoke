import * as jsYaml from "js-yaml";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export function loadYaml<T = unknown>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = readFileSync(filePath, "utf-8");
  return jsYaml.load(content) as T;
}

export function writeYaml(filePath: string, data: unknown, header?: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const yamlStr = jsYaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
  });
  const content = header ? `${header}\n${yamlStr}` : yamlStr;
  writeFileSync(filePath, content, "utf-8");
}

export function yamlExists(filePath: string): boolean {
  return existsSync(filePath);
}
