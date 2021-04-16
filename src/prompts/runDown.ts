import chalk from "chalk";
import { Context } from "../context";
import { Prompt, pushPrompt } from "../prompt";
import { saveSettings, saveSkipped, Settings } from "../settings";

export function createRunDownPrompt(settings: Settings, appContext: Context, filterPrompt: Prompt<boolean>, approvalPrompt: Prompt<boolean>, mergePrompt: Prompt<boolean>): Prompt {
    return {
        title: "Options",
        options: [
            {
                key: "alt+a",
                description: "set the default approval option",
                advanced: true,
                action: async (prompt) => {
                    // If approval mode has changed, refresh the current prompt
                    if (await pushPrompt(approvalPrompt)) await prompt.refresh();
                }
            },
            {
                key: "alt+m",
                description: "set the default merge option",
                advanced: true,
                action: async (prompt) => {
                    // If merge mode has changed, refresh the current prompt
                    if (await pushPrompt(mergePrompt)) await prompt.refresh();
                }
            },
            {
                key: "f",
                description: "change filters",
                advanced: true,
                action: async (prompt) => {
                    // If the filter has changed, close the prompt
                    if (await pushPrompt(filterPrompt)) await prompt.close();
                },
            },
            {
                key: "ctrl+s",
                description: "save current configuration options as defaults",
                advanced: true,
                action: async (prompt) => {
                    await prompt.hide();
                    saveSettings(settings);
                    process.stdout.write("Configuration saved.\n\n");
                    await prompt.show();
                }
            },
            {
                key: "a",
                description: () => appContext.currentPull?.supportsSelfMerge ? "approve and continue" : "approve",
                disabled: () => appContext.currentPull?.approvedByMe === true,
                hidden: () => !appContext.currentPull?.supportsSelfMerge && (settings.approve === "always" || settings.approve === "auto"),
                action: async (prompt) => {
                    const pull = appContext.currentPull;
                    if (!pull) return;

                    await prompt.hide();
                    process.stdout.write("Approving...");
                    await appContext.service.approvePull(pull);
                    process.stdout.write("Approved.\n\n");
                    appContext.log.write(`[${new Date().toISOString()}] #${pull.number} '${pull.title}': Approved\n`);

                    if (pull.supportsSelfMerge) {
                        if (appContext.skipped.delete(pull.number)) {
                            saveSkipped(appContext.skipped);
                        }
                        if (appContext.workArea) appContext.workArea.column.completedCount++;
                        await prompt.close();
                    }
                    else {
                        await prompt.refresh();
                        await prompt.show();
                    }
                }
            },
            {
                key: "m",
                description: () => `${(settings.approve === "auto" ? !appContext.currentPull?.approvedByOwners : settings.approve === "always" ? !appContext.currentPull?.approvedByMe : false) ? "approve and " : ""}merge${settings.merge ? ` using ${settings.merge === "merge" ? "merge commit" : settings.merge}` : ""}`,
                disabled: () => !!appContext.currentPull?.supportsSelfMerge,
                hidden: () => !!appContext.currentPull?.supportsSelfMerge,
                action: async (prompt) => {
                    let pull = appContext.currentPull;
                    if (!pull || pull.supportsSelfMerge) return;

                    if (!settings.merge) {
                        if (await pushPrompt(mergePrompt)) await prompt.refresh();
                        if (!settings.merge) return;
                    }

                    const result = await appContext.service.getPull(pull.number);
                    if (result.error) return;

                    pull = result.pull;

                    await prompt.hide();

                    const merge = settings.merge;
                    const approve = settings.approve;
                    const needsApproval =
                        approve === "auto" ? pull.approvedByOwners !== true || pull.approvedByMaintainer !== true :
                        approve === "always" ? pull.approvedByMe !== true || pull.approvedByMaintainer !== true :
                        false;

                    // Approve the PR if necessary
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

                    // Remove the pull from the skipped PRs list
                    if (appContext.skipped.delete(pull.number)) {
                        saveSkipped(appContext.skipped);
                    }

                    if (appContext.workArea) appContext.workArea.column.completedCount++;
                    await prompt.close();
                }
            },
            {
                key: "s",
                description: "skip until there are updates to the PR.",
                action: async (prompt) => {
                    if (appContext.currentPull) {
                        let skipDate = appContext.skipped.get(appContext.currentPull.number);
                        if (skipDate === undefined) {
                            appContext.skipped.set(appContext.currentPull.number, Date.now());
                            appContext.screen.clearPull();
                            appContext.screen.addPull(`[${appContext.workArea!.column.offset}/${appContext.workArea?.column.cards.length}] '${appContext.currentPull.title}' ${chalk.yellow("[skipped]")}.`);
                            saveSkipped(appContext.skipped);
                        }
                    }
                    await prompt.close();
                }
            },
            {
                key: "d",
                description: "defer this PR until the end of the current column.",
                disabled: () => !(appContext.currentPull && appContext.workArea && appContext.workArea.column.offset < appContext.workArea.column.cards.length),
                action: async (prompt) => {
                    if (appContext.currentPull && appContext.workArea) {
                        if (appContext.workArea.column.offset > 0 &&
                            appContext.workArea.column.offset < appContext.workArea.column.cards.length &&
                            appContext.workArea.column.cards[appContext.workArea.column.offset - 1] === appContext.workArea.card) {
                            appContext.screen.clearPull();
                            appContext.screen.addPull(`[${appContext.workArea?.column.offset}/${appContext.workArea?.column.cards.length}] '${appContext.currentPull.title}' ${chalk.yellow("[deferred]")}.`);
                            appContext.workArea.column.offset--;
                            appContext.workArea.column.cards.push(...appContext.workArea.column.cards.splice(appContext.workArea.column.offset, 1));
                        }
                    }
                    await prompt.close();
                }
            },
            {
                key: "F5",
                description: "Refresh",
                hidden: true,
                action: async () => {
                    await appContext.screen.refresh(true);
                }
            }
        ]
    };
}
