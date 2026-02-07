#!/usr/bin/env bun

import { Command } from "commander";
import { registerInitCommand } from "./commands/init";
import { registerStatusCommand } from "./commands/status";
import { registerValidateCommand } from "./commands/validate";
import { registerPublishCommand } from "./commands/publish";
import { version } from "./version";

const program = new Command()
  .name("hive-spoke")
  .version(version)
  .description(
    "Spoke contract CLI — scaffolds .collab/, generates status, validates schemas"
  )
  .option("-j, --json", "Output as JSON", false);

const getJsonMode = () => program.opts().json ?? false;

// Register spoke-level commands
registerInitCommand(program, getJsonMode);
registerStatusCommand(program, getJsonMode);
registerValidateCommand(program, getJsonMode);
registerPublishCommand(program, getJsonMode);

program.parse();
