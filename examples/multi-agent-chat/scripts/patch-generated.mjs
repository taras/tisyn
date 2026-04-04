#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const content = readFileSync(file, "utf-8");

if (!content.startsWith("// @ts-nocheck")) {
  writeFileSync(file, "// @ts-nocheck \u2014 generated IR is untyped; runtime-correct\n" + content);
}
