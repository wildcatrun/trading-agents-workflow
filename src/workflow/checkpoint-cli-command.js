import { workflowCheckpointCommandInput } from "./checkpoint-routing.js";

export function registerWorkflowCheckpointCliCommand(command, context = {}) {
  const runAction = context.runAction;
  const commandRoot = context.commandRoot;
  if (typeof runAction !== "function") throw new Error("workflow checkpoint CLI command requires runAction");
  if (typeof commandRoot !== "function") throw new Error("workflow checkpoint CLI command requires commandRoot");
  return command.command("workflow-checkpoint")
    .requiredOption("--workflow <workflowId>", "Workflow id")
    .option("--source-class <class>", "legacy_compat_checkpoint, v2_plan_checkpoint, or human_gate_archive_checkpoint", "legacy_compat_checkpoint")
    .option("--plan <planId>", "V2 plan id for v2/source-class checkpointing")
    .option("--human-gate <humanGateId>", "Human Gate id for archive checkpointing")
    .option("--button <buttonId>", "Human Gate button id for archive checkpointing")
    .option("--decision-status <status>", "Human Gate decision status for archive checkpointing")
    .option("--checkpoint <checkpointId>", "Checkpoint id")
    .option("--summary <summary>", "Checkpoint summary")
    .option("--next-action <action>", "Next action; repeatable", (value, previous) => [...previous, value], [])
    .option("--token-budget <tokens>", "Context token budget")
    .option("--compact-at <percent>", "Compaction trigger percent")
    .option("--restore-policy <policy>", "Restore policy")
    .option("--workflow-root <dir>", "Trading agents workflow root directory")
    .option("--root <dir>", "Meeting protocol root directory")
    .action(async (options) => {
      console.log(JSON.stringify(await runAction(commandRoot(options), {
        ...workflowCheckpointCommandInput(options),
        workflowRootDir: options.workflowRoot,
        tokenBudget: options.tokenBudget === undefined ? undefined : Number(options.tokenBudget),
        compactAtPercent: options.compactAt === undefined ? undefined : Number(options.compactAt)
      }), null, 2));
    });
}
