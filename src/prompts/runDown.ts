import chalk from "chalk";
import { Context } from "../context";
import { Prompt, pushPrompt } from "../prompt";
import { saveSettings, saveSkipped, Settings } from "../settings";
import { tryAdd } from "../utils";

export function createRunDownPrompt(settings: Settings, appContext: Context, filterPrompt: Prompt<boolean>, approvalPrompt: Prompt<boolean>, mergePrompt: Prompt<boolean>): Prompt {
    return {
        title: "Options",
        options: [
            {
                key: "f",
                description: "change filters",
                advanced: true,
                action: async (_, context) => {
                    const result = await pushPrompt(filterPrompt);
                    if (result) {
                        context.close();
                    }
                },
            },
            {
                key: "alt+a",
                description: "set the default approval option",
                advanced: true,
                action: async (_, context) => {
                    const result = await pushPrompt(approvalPrompt);
                    if (result) {
                        context.refresh();
                    }
                }
            },
            {
                key: "alt+m",
                description: "set the default merge option",
                advanced: true,
                action: async (_, context) => {
                    const result = await pushPrompt(mergePrompt);
                    if (result) {
                        context.refresh();
                    }
                }
            },
            {
                key: "ctrl+s",
                description: "save current configuration options as defaults",
                advanced: true,
                action: async (_, context) => {
                    context.hide();
                    saveSettings(settings);
                    process.stdout.write("Configuration saved.\n\n");
                    context.show();
                }
            },
            {
                key: "a",
                description: () => settings.approve === "only" ? "approve and continue" : "approve",
                disabled: () => !!appContext.currentPull?.approvedByMe,
                hidden: () => settings.approve !== "manual" && settings.approve !== "only",
                action: async (_, context) => {
                    if (!appContext.currentPull) return;
                    context.hide();
                    process.stdout.write("Approving...");
                    await appContext.service.approvePull(appContext.currentPull);
                    process.stdout.write("Approved.\n\n");
                    appContext.log.write(`[${new Date().toISOString()}] #${appContext.currentPull.number} '${appContext.currentPull.title}': Approved\n`);

                    if (settings.approve === "only") {
                        if (appContext.skipped.delete(appContext.currentPull.number)) {
                            saveSkipped(appContext.skipped);
                        }
                        context.close();
                    }
                    else {
                        context.refresh();
                        context.show();
                    }
                }
            },
            {
                key: "m",
                description: () => `${(settings.approve === "auto" ? !appContext.currentPull?.approvedByAll : settings.approve === "always" ? !appContext.currentPull?.approvedByMe : false) ? "approve and " : ""}merge${settings.merge ? ` using ${settings.merge === "merge" ? "merge commit" : settings.merge}` : ""}`,
                disabled: () => settings.approve === "only",
                hidden: () => settings.approve === "only",
                action: async (_, context) => {
                    if (!appContext.currentPull) return;

                    const pull = appContext.currentPull;
                    if (!settings.merge) {
                        const result = await pushPrompt(mergePrompt);
                        if (result) {
                            context.refresh();
                        }
                        if (!settings.merge) return;
                    }

                    context.hide();

                    const merge = settings.merge;
                    const needsApproval =
                        settings.approve === "auto" ? !await appContext.service.isApprovedByAll(pull) :
                        settings.approve === "always" ? !await appContext.service.isApprovedByMe(pull) :
                        false;

                    if (needsApproval) {
                        process.stdout.write("Approving...");
                        await appContext.service.approvePull(pull);
                        process.stdout.write("Approved.\n");
                        appContext.log.write(`[${new Date().toISOString()}] #${pull.number} '${pull.title}': Approved\n`);
                    }

                    process.stdout.write("Merging...");
                    await appContext.service.mergePull(pull, merge);
                    appContext.log.write(`[${new Date().toISOString()}] #${pull.number} '${pull.title}': Merged using ${merge}\n`);
                    process.stdout.write("Merged.\n\n");

                    if (appContext.skipped.delete(appContext.currentPull.number)) {
                        saveSkipped(appContext.skipped);
                    }

                    context.close();
                }
            },
            {
                key: "s",
                description: "skip",
                action: (_, context) => {
                    if (appContext.currentPull && tryAdd(appContext.skipped, appContext.currentPull.number)) {
                        appContext.screen.addLog(`[${appContext.workArea?.column.offset}/${appContext.workArea?.column.cards.length}] ${appContext.currentPull.title} ${chalk.yellow("[skipped]")}.`)
                        saveSkipped(appContext.skipped);
                    }
                    context.close();
                }
            },
            {
                key: "F5",
                description: "Refresh",
                hidden: true,
                action: () => {
                    appContext.screen.refresh(true);
                }
            }
        ]
    };
}
