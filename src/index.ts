/*!
   Copyright 2019 Microsoft Corporation

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import chalk from "chalk";
import prompts = require("prompts");
import { argv } from "./options";
import { ProjectService, Column, Card, Pull } from "./github";
import { Chrome } from "./chrome";
import { Prompt, pushPrompt, addOnQuit } from "./prompt";
import { getDefaultSettings, getDefaultSettingsFile, saveSettings, Settings } from "./settings";

function getRandomPort() {
    return 9000 + Math.floor(Math.random() * 999);
}

async function init() {
    const defaults = getDefaultSettings();
    let {
        token,
        username,
        password,
        save,
        "save-to": saveTo,
        needsReview = defaults.needsReview,
        needsAction = defaults.needsAction,
        draft = defaults.draft,
        oldest = defaults.oldest,
        approve = defaults.approve,
        merge = defaults.merge,
        port = defaults.port,
        timeout = defaults.timeout,
    } = argv;

    if (port <= 0) port = "random";

    if (!needsReview && !needsAction) {
        needsReview = true;
        needsAction = true;
    }

    if (!token) {
        token = process.env.GITHUB_API_TOKEN ?? process.env.FOCUS_DT_GITHUB_API_TOKEN ?? process.env.AUTH_TOKEN
    }

    if (!token && (!username || !password)) {
        ({ token, username, password } = await prompts([
            {
                type: "select",
                name: "choice",
                message: "GitHub Authentication",
                choices: [
                    { title: "token", value: "token" },
                    { title: "username", value: "username" },
                ],
            },
            {
                type: (_, answers) => answers.choice === "token" ? "text" : null,
                name: "token",
                message: "token"
            },
            {
                type: (_, answers) => answers.choice === "username" ? "text" : null,
                name: "username",
                message: "username"
            },
            {
                type: (_, answers) => answers.choice === "username" ? "text" : null,
                name: "password",
                message: "password"
            },
        ], { onCancel() { process.exit(1); } }));
    }

    const defaultMerge: "merge" | "squash" | "rebase" | undefined =
        merge === "merge" || merge === "squash" || merge === "rebase" ? merge : undefined;

    const approvalMode: "manual" | "auto" | "always" | "only" =
        approve === "manual" || approve === "auto" || approve === "always" || approve === "only" ? approve : "manual";

    const settings: Settings = {
        needsAction,
        needsReview,
        oldest,
        draft,
        port,
        timeout,
        merge: defaultMerge,
        approve: approvalMode
    };

    if (save || saveTo) {
        saveSettings(settings, saveTo);
        console.log(`Settings saved to '${saveTo ?? getDefaultSettingsFile()}'.`);
        process.exit(0);
    }

    return {
        token,
        username,
        password,
        settings
    };
}

async function main() {
    let {
        token,
        username,
        password,
        settings
    } = await init();

    if (!token && (!username || !password)) {
        return;
    }

    const runDownPrompt: Prompt = {
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
                description: "approve",
                disabled: () => !!currentPull?.approvedByMe,
                hidden: () => settings.approve !== "manual",
                action: async (_, context) => {
                    if (!currentPull) return;
                    context.hide();
                    process.stdout.write("Approving...");
                    await service.approvePull(currentPull);
                    process.stdout.write("Approved.\n\n");
                    log.write(`[${new Date().toISOString()}] #${currentPull.number} '${currentPull.title}': Approved\n`);

                    if (settings.approve === "only") {
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
                description: () => `${(settings.approve === "auto" ? !currentPull?.approvedByAll : settings.approve === "always" ? !currentPull?.approvedByMe : false) ? "approve and " : ""}merge${settings.merge ? ` using ${settings.merge === "merge" ? "merge commit" : settings.merge}` : ""}`,
                disabled: () => settings.approve === "only",
                hidden: () => settings.approve === "only",
                action: async (_, context) => {
                    if (!currentPull) return;

                    const pull = currentPull;
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
                        settings.approve === "auto" ? !await service.isApprovedByAll(pull) :
                        settings.approve === "always" ? !await service.isApprovedByMe(pull) :
                        false;

                    if (needsApproval) {
                        process.stdout.write("Approving...");
                        await service.approvePull(pull);
                        process.stdout.write("Approved.\n");
                        log.write(`[${new Date().toISOString()}] #${pull.number} '${pull.title}': Approved\n`);
                    }

                    process.stdout.write("Merging...");
                    await service.mergePull(pull, merge);
                    log.write(`[${new Date().toISOString()}] #${pull.number} '${pull.title}': Merged using ${merge}\n`);
                    process.stdout.write("Merged.\n\n");

                    context.close();
                }
            },
            {
                key: "s",
                description: "skip",
                action: (_, context) => {
                    context.close();
                }
            }
        ]
    };

    interface FilterPromptState {
        checkAndMerge: boolean;
        review: boolean;
        draft: boolean;
        oldest: boolean;
    }

    const filterPrompt: Prompt<boolean, FilterPromptState> = {
        title: "Filter Options",
        onEnter: ({ state }) => {
            state.checkAndMerge = settings.needsAction;
            state.review = settings.needsReview;
            state.draft = settings.draft;
            state.oldest = settings.oldest;
        },
        options: [
            {
                key: "c",
                description: ({ state }) => `${(state.checkAndMerge !== settings.needsAction ? chalk.yellow : chalk.reset)(state.checkAndMerge ? "exclude" : "include")} 'Check and Merge' column`,
                checked: ({ state }) => state.checkAndMerge,
                checkStyle: "checkbox",
                action: (_, context) => {
                    context.state.checkAndMerge = !context.state.checkAndMerge;
                    context.refresh();
                }
            },
            {
                key: "r",
                description: ({ state }) => `${(state.review !== settings.needsReview ? chalk.yellow : chalk.reset)(state.review ? "exclude" : "include")} 'Review' column`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.review,
                action: (_, context) => {
                    context.state.review = !context.state.review;
                    context.refresh();
                }
            },
            {
                key: "d",
                description: ({ state }) => `${(state.draft !== settings.draft ? chalk.yellow : chalk.reset)(state.draft ? "exclude" : "include")} Draft PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.draft,
                action: (_, context) => {
                    context.state.draft = !context.state.draft;
                    context.refresh();
                }
            },
            {
                key: "o",
                description: ({ state }) => `order by ${(state.oldest !== settings.oldest ? chalk.yellow : chalk.reset)(state.oldest ? "newest" : "oldest")}`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.oldest,
                action: (_, context) => {
                    context.state.oldest = !context.state.oldest;
                    context.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) =>
                    !!state.checkAndMerge === settings.needsAction &&
                    !!state.review === settings.needsReview &&
                    !!state.draft === settings.draft &&
                    !!state.oldest === settings.oldest,
                action: (_, context) => {
                    let shouldReset = false;
                    const { state } = context;
                    if (!!state.checkAndMerge !== settings.needsAction) {
                        settings.needsAction = !!state.checkAndMerge;
                        otherState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.review !== settings.needsReview) {
                        settings.needsReview = !!state.review;
                        reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.draft !== settings.draft) {
                        settings.draft = !!state.draft;
                        otherState = undefined;
                        reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.oldest !== settings.oldest) {
                        settings.oldest = !!state.oldest;
                        otherState = undefined;
                        reviewState = undefined;
                        shouldReset = true;
                    }
                    if (shouldReset) {
                        chrome.reset();
                    }
                    context.close(shouldReset);
                }
            },
            {
                key: "escape",
                description: "cancel",
                action: (_, context) => {
                    context.close(false);
                }
            }
        ]
    };

    interface ApprovalPromptState {
        approvalMode: "manual" | "auto" | "always" | "only";
    }

    const approvalPrompt: Prompt<boolean, ApprovalPromptState> = {
        title: "Approval Options",
        onEnter: ({ state }) => {
            state.approvalMode = settings.approve;
        },
        options: [
            {
                key: "m",
                description: "approve PRs manually.",
                checked: ({ state }) => state.approvalMode === "manual",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "manual" && settings.approve === "manual" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "manual";
                    context.refresh();
                }
            },
            {
                key: "o",
                description: "approve PRs manually and advance (disables merge).",
                checked: ({ state }) => state.approvalMode === "only",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "only" && settings.approve === "only" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "only";
                    context.refresh();
                }
            },
            {
                key: "n",
                description: "approve PRs when merging if there are no other approvals.",
                checked: ({ state }) => state.approvalMode === "auto",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "auto" && settings.approve === "auto" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "auto";
                    context.refresh();
                }
            },
            {
                key: "a",
                description: "approve PRs when merging if you haven't already approved.",
                checked: ({ state }) => state.approvalMode === "always",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "always" && settings.approve === "always" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "always";
                    context.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) => state.approvalMode === settings.approve,
                action: (_, context) => {
                    const oldApprovalMode = settings.approve;
                    settings.approve = context.state.approvalMode ?? settings.approve;
                    context.close(settings.approve !== oldApprovalMode);
                }
            },
            {
                key: "escape",
                description: "cancel",
                action: (_, context) => context.close(false)
            }
        ]
    };

    interface MergePromptState {
        defaultMerge: "merge" | "squash" | "rebase";
    }

    const mergePrompt: Prompt<boolean, MergePromptState> = {
        title: "Merge Options",
        onEnter: ({ state }) => {
            state.defaultMerge = settings.merge;
        },
        options: [
            {
                key: "m",
                description: "merge using merge commit",
                checked: ({ state }) => state.defaultMerge === "merge",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "merge" && settings.merge === "merge" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.defaultMerge = "merge";
                    context.refresh();
                }
            },
            {
                key: "s",
                description: "merge using squash",
                checkStyle: "radio",
                checked: ({ state }) => state.defaultMerge === "squash",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "squash" && settings.merge === "squash" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.defaultMerge = "squash";
                    context.refresh();
                }
            },
            {
                key: "r",
                description: "merge using rebase",
                checkStyle: "radio",
                checked: ({ state }) => state.defaultMerge === "rebase",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "rebase" && settings.merge === "rebase" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.defaultMerge = "rebase";
                    context.refresh();
                }
            },
            {
                key: "x",
                description: "clear default merge option",
                checkStyle: "radio",
                checked: ({ state }) => state.defaultMerge === undefined,
                checkColor: ({ state }) => ({ color: state.defaultMerge !== undefined && settings.merge === undefined ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.defaultMerge = undefined;
                    context.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) => state.defaultMerge === settings.merge,
                action: (_, context) => {
                    const oldDefaultMerge = settings.merge;
                    settings.merge = context.state.defaultMerge;
                    context.close(settings.merge !== oldDefaultMerge);
                }
            },
            {
                key: "escape",
                description: "cancel",
                action: (_, context) => context.close(false)
            }
        ]
    };

    const chrome = new Chrome(settings.port === "random" ? getRandomPort() : settings.port, settings.timeout);
    const log = fs.createWriteStream("focus-dt.log", { flags: "a" });

    addOnQuit(() => {
        chrome.close();
        log.close();
    });

    const service = new ProjectService({
        github: {
            auth: token || {
                username: username!,
                password: password!,
                async on2fa() {
                    const { otp } = await prompts({
                        type: "text",
                        name: "otp",
                        message: "GitHub 2FA code"
                    }, { onCancel() { process.exit(1); } });
                    return otp;
                }
            }
        },
        owner: "DefinitelyTyped",
        repo: "DefinitelyTyped",
    });

    const project = await service.getProject();
    const columns = await service.getColumns(project);

    class Screen {
        private headerLines: string[] = [];
        private logLines: string[] = [];
        private progressLines: string[] = [];
        private pullLines: string[] = [];
        private writtenHeaderLines: string[] = [];
        private writtenLogLines: string[] = [];
        private writtenProgressLines: string[] = [];
        private writtenPullLines: string[] = [];

        get headerStart() {
            return 0;
        }

        get progressStart() {
            return this.headerStart + this.writtenHeaderLines.length;
        }

        get logStart() {
            return this.progressStart + this.writtenProgressLines.length;
        }

        get pullStart() {
            return this.logStart + this.writtenLogLines.length;
        }

        clearHeader() {
            this.headerLines.length = 0;
            this.progressLines.length = 0;
            this.logLines.length = 0;
            this.pullLines.length = 0;
            this.writtenProgressLines.length = 0;
            this.writtenLogLines.length = 0;
            this.writtenPullLines.length = 0;
        }

        clearProgress() {
            this.logLines.length = 0;
            this.pullLines.length = 0;
            this.writtenLogLines.length = 0;
            this.writtenPullLines.length = 0;
        }

        clearLog() {
            this.logLines.length = 0;
            this.pullLines.length = 0;
            this.writtenPullLines.length = 0;
        }

        clearPull() {
            this.pullLines.length = 0;
        }

        addProgress(line: string = "") {
            this.progressLines.push(...line.split(/\r?\n/g));
        }

        addHeader(line: string = "") {
            this.headerLines.push(...line.split(/\r?\n/g));
        }

        addLog(line: string = "") {
            this.logLines.push(...line.split(/\r?\n/g));
        }

        addPull(line: string = "") {
            this.pullLines.push(...line.split(/\r?\n/g));
        }

        private writeLines(y: number, source: string[], written: string[]) {
            let i = 0;
            while (i < source.length && i < written.length && source[i] === written[i]) {
                i++;
            }
            if (written.length > i) {
                written.length = i;
            }
            readline.cursorTo(process.stdout, 0, y + i);
            readline.clearScreenDown(process.stdout);
            while (i < source.length) {
                const s = source[i];
                process.stdout.write(s + "\n");
                written.push(s);
                i++;
            }
        }

        writeHeader() {
            this.writeLines(this.headerStart, this.headerLines, this.writtenHeaderLines);
        }

        writeProgress() {
            this.writeLines(this.progressStart, this.progressLines, this.writtenProgressLines);
        }

        writeLog() {
            this.writeLines(this.logStart, this.logLines, this.writtenLogLines);
        }

        writePull() {
            this.writeLines(this.pullStart, this.pullLines, this.writtenPullLines);
        }
    }

    interface ColumnRunDownState {
        column: Column;
        cards: Card[];
        offset: number;
        oldestFirst: boolean;
    }

    interface WorkArea {
        column: ColumnRunDownState;
        card: Card;
    }

    let otherState: ColumnRunDownState | undefined;
    let reviewState: ColumnRunDownState | undefined;
    let workArea: WorkArea | undefined;
    let currentPull: Pull | undefined;
    let lastColumn: Column | undefined;
    let lastShowOther = false;
    let lastShowReview = false;

    const screen = new Screen();

    while (true) {
        currentPull = undefined;
        if (settings.needsAction && shouldPopulateState(otherState)) {
            otherState = await populateState(columns["Needs Maintainer Action"]);
        }

        if (settings.needsReview && shouldPopulateState(reviewState)) {
            reviewState = await populateState(columns["Needs Maintainer Review"]);
        }

        if (lastShowOther !== settings.needsAction || lastShowReview !== settings.needsReview) {
            lastShowOther = settings.needsAction;
            lastShowReview = settings.needsReview;
            screen.clearHeader();
            screen.addHeader(`'Needs Maintainer Review' ${reviewState ? `count: ${reviewState.cards.length}` : "excluded."}`);
            screen.addHeader(`'Needs Maintainer Action' ${otherState ? `count: ${otherState.cards.length}` : "excluded."}`);
            screen.addHeader(`order by: ${settings.oldest ? "oldest" : "newest"} first`);
            screen.addHeader();
            screen.writeHeader();
        }

        workArea = nextCard(reviewState) || nextCard(otherState);
        if (!workArea) {
            lastColumn = undefined;
            screen.clearProgress();
            screen.addProgress("No items remaining.");
            screen.writeProgress();
        }
        else {
            const { column, card } = workArea;
            if (column.column !== lastColumn) {
                lastColumn = column.column;
                screen.clearProgress();
                screen.addProgress(`Column '${column.column.name}':`);
                screen.addProgress();
                screen.writeProgress();
            }

            const result = await service.getPull(card, settings.draft);
            if (result.error) {
                screen.addLog(`[${column.offset}/${column.cards.length}] ${result.message}, skipping.`);
                screen.writeLog();
                continue;
            }

            const { pull, labels } = result;
            currentPull = pull;
            screen.clearPull();
            screen.addPull(`[${column.offset}/${column.cards.length}] ${pull.title}`);
            screen.addPull(`\t${chalk.underline(chalk.cyan(pull.html_url))}`);
            screen.addPull(`\tupdated: ${card.updated_at}`);
            screen.addPull(`\tapproved by you: ${pull.approvedByMe ? chalk.green("yes") : "no"}, approved: ${pull.approvedByAll ? chalk.green("yes") : "no"}`);
            screen.addPull(`\t${[...labels].join(', ')}`);
            if (pull.botStatus) {
                screen.addPull();
                screen.addPull(`\t${chalk.whiteBright(`Status:`)}`);
                for (const line of pull.botStatus) {
                    screen.addPull(`\t${line}`);
                }
            }
            screen.addPull();
            screen.writePull();
            await chrome.navigateTo(pull.html_url);
        }

        await pushPrompt(runDownPrompt);
        screen.clearLog();
    }

    function shouldPopulateState(state: ColumnRunDownState | undefined) {
        return !state || state.oldestFirst !== settings.oldest;
    }

    async function populateState(column: Column): Promise<ColumnRunDownState> {
        const cards = await service.getCards(column, settings.oldest);
        return { column: column, cards, offset: 0, oldestFirst: settings.oldest };
    }

    function nextCard(column: ColumnRunDownState | undefined): WorkArea | undefined {
        if (column && column.offset < column.cards.length) {
            return { column, card: column.cards[column.offset++] };
        }
    }
}

main().catch(e => console.error(e));
