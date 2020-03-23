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

import { argv } from "./options";
import prompts = require("prompts");
import { ProjectService, Column, Card, Pull } from "./github";
import { Chrome } from "./chrome";
import chalk from "chalk";
import * as readline from "readline";
import * as fs from "fs";
import { Prompt, pushPrompt, popPrompt, showPrompt, refreshPrompt, hidePrompt, addOnQuit, getCurrentPrompt } from "./prompt";

function getRandomPort() {
    return 9000 + Math.floor(Math.random() * 999);
}

async function init() {
    let {
        token,
        username,
        password,
        review = false,
        checkAndMerge = false,
        draft = false,
        oldest = false,
        approve = "manual",
        merge,
        port = 9222,
        timeout = 10000,
    } = argv;

    if (port <= 0) port = getRandomPort();

    if (!review && !checkAndMerge) {
        review = true;
        checkAndMerge = true;
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

    const approvalMode: "manual" | "auto" | "always" =
        approve === "manual" || approve === "auto" || approve === "always" ? approve : "manual";

    return {
        token,
        username,
        password,
        review,
        checkAndMerge,
        defaultMerge,
        approvalMode,
        draft,
        oldest,
        port,
        timeout
    };
}

async function main() {
    let {
        token,
        username,
        password,
        review,
        checkAndMerge,
        defaultMerge,
        approvalMode,
        draft,
        oldest,
        port,
        timeout,
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
                key: "a",
                description: "approve",
                disabled: () => !!currentPull?.approvedByMe,
                hidden: () => approvalMode !== "manual",
                action: async (_, context) => {
                    if (!currentPull) return;
                    context.hide();
                    process.stdout.write("Approving...");
                    await service.approvePull(currentPull);
                    process.stdout.write("Approved.\n\n");
                    log.write(`[${new Date().toISOString()}] #${currentPull.number} '${currentPull.title}': Approved\n`);
                    context.refresh();
                    context.show();
                }
            },
            {
                key: "m",
                description: () => `${(approvalMode === "auto" ? !currentPull?.approvedByAll : approvalMode === "always" ? !currentPull?.approvedByMe : false) ? "approve and " : ""}merge${defaultMerge ? ` using ${defaultMerge === "merge" ? "merge commit" : defaultMerge}` : ""}`,
                action: async (_, context) => {
                    if (!currentPull) return;

                    const pull = currentPull;
                    if (!defaultMerge) {
                        const result = await pushPrompt(mergePrompt);
                        if (result) {
                            context.refresh();
                        }
                        if (!defaultMerge) return;
                    }

                    context.hide();

                    const merge = defaultMerge;
                    const needsApproval =
                        approvalMode === "auto" ? !await service.isApprovedByAll(pull) :
                        approvalMode === "always" ? !await service.isApprovedByMe(pull) :
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
            state.checkAndMerge = checkAndMerge;
            state.review = review;
            state.draft = draft;
            state.oldest = oldest;
        },
        options: [
            {
                key: "c",
                description: ({ state }) => `${(state.checkAndMerge !== checkAndMerge ? chalk.yellow : chalk.reset)(state.checkAndMerge ? "exclude" : "include")} 'Check and Merge' column`,
                checked: ({ state }) => state.checkAndMerge,
                checkStyle: "checkbox",
                action: (_, context) => {
                    context.state.checkAndMerge = !context.state.checkAndMerge;
                    context.refresh();
                }
            },
            {
                key: "r",
                description: ({ state }) => `${(state.review !== review ? chalk.yellow : chalk.reset)(state.review ? "exclude" : "include")} 'Review' column`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.review,
                action: (_, context) => {
                    context.state.review = !context.state.review;
                    context.refresh();
                }
            },
            {
                key: "d",
                description: ({ state }) => `${(state.draft !== draft ? chalk.yellow : chalk.reset)(state.draft ? "exclude" : "include")} Draft PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.draft,
                action: (_, context) => {
                    context.state.draft = !context.state.draft;
                    context.refresh();
                }
            },
            {
                key: "o",
                description: ({ state }) => `order by ${(state.oldest !== oldest ? chalk.yellow : chalk.reset)(state.oldest ? "newest" : "oldest")}`,
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
                    !!state.checkAndMerge === checkAndMerge &&
                    !!state.review === review &&
                    !!state.draft === draft &&
                    !!state.oldest === oldest,
                action: (_, context) => {
                    let shouldReset = false;
                    const { state } = context;
                    if (!!state.checkAndMerge !== checkAndMerge) {
                        checkAndMerge = !!state.checkAndMerge;
                        checkAndMergeState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.review !== review) {
                        review = !!state.review;
                        reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.draft !== draft) {
                        draft = !!state.draft;
                        checkAndMergeState = undefined;
                        reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.oldest !== oldest) {
                        oldest = !!state.oldest;
                        checkAndMergeState = undefined;
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
        approvalMode: "manual" | "auto" | "always";
    }

    const approvalPrompt: Prompt<boolean, ApprovalPromptState> = {
        title: "Approval Options",
        onEnter: ({ state }) => {
            state.approvalMode = approvalMode;
        },
        options: [
            {
                key: "m",
                description: "approve PRs manually.",
                checked: ({ state }) => state.approvalMode === "manual",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "manual" && approvalMode === "manual" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "manual";
                    context.refresh();
                }
            },
            {
                key: "n",
                description: "approve PRs automatically when there are no other approvals.",
                checked: ({ state }) => state.approvalMode === "auto",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "auto" && approvalMode === "auto" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "auto";
                    context.refresh();
                }
            },
            {
                key: "a",
                description: "approve PRs automatically if you haven't already approved.",
                checked: ({ state }) => state.approvalMode === "always",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "always" && approvalMode === "always" ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.approvalMode = "always";
                    context.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) => state.approvalMode === approvalMode,
                action: (_, context) => {
                    const oldApprovalMode = approvalMode;
                    approvalMode = context.state.approvalMode ?? approvalMode;
                    context.close(approvalMode !== oldApprovalMode);
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
            state.defaultMerge = defaultMerge;
        },
        options: [
            {
                key: "m",
                description: "merge using merge commit",
                checked: ({ state }) => state.defaultMerge === "merge",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "merge" && defaultMerge === "merge" ? chalk.yellow : undefined }),
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
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "squash" && defaultMerge === "squash" ? chalk.yellow : undefined }),
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
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "rebase" && defaultMerge === "rebase" ? chalk.yellow : undefined }),
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
                checkColor: ({ state }) => ({ color: state.defaultMerge !== undefined && defaultMerge === undefined ? chalk.yellow : undefined }),
                action: (_, context) => {
                    context.state.defaultMerge = undefined;
                    context.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) => state.defaultMerge === defaultMerge,
                action: (_, context) => {
                    const oldDefaultMerge = defaultMerge;
                    defaultMerge = context.state.defaultMerge;
                    context.close(defaultMerge !== oldDefaultMerge);
                }
            },
            {
                key: "escape",
                description: "cancel",
                action: (_, context) => context.close(false)
            }
        ]
    };

    const chrome = new Chrome(port, timeout);
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
        project: "Pull Request Status Board",
        columns: ["Check and Merge", "Review"],
    });

    const project = await service.getProject();
    const columns = await service.getColumns(project);

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

    let checkAndMergeState: ColumnRunDownState | undefined;
    let reviewState: ColumnRunDownState | undefined;
    let workArea: WorkArea | undefined;
    let currentPull: Pull | undefined;
    let lastColumn: Column | undefined;
    let lastShowCheckAndMerge = false;
    let lastShowReview = false;
    let shouldClear = true;

    while (true) {
        currentPull = undefined;
        if (checkAndMerge && shouldPopulateState(checkAndMergeState)) {
            checkAndMergeState = await populateState(columns["Check and Merge"]);
        }

        if (review && shouldPopulateState(reviewState)) {
            reviewState = await populateState(columns["Review"]);
        }

        if (lastShowCheckAndMerge !== checkAndMerge || lastShowReview !== review) {
            lastShowCheckAndMerge = checkAndMerge;
            lastShowReview = review;
            readline.cursorTo(process.stdout, 0, 0);
            readline.clearScreenDown(process.stdout);
            console.log(`'Check and Merge' ${checkAndMergeState ? `count: ${checkAndMergeState.cards.length}` : "excluded."}`);
            console.log(`'Review' ${reviewState ? `count: ${reviewState.cards.length}` : "excluded."}`);
            console.log();
        }

        workArea = nextCard(checkAndMergeState) || nextCard(reviewState);
        if (!workArea) {
            lastColumn = undefined;
            if (shouldClear) {
                readline.cursorTo(process.stdout, 0, 3);
                readline.clearScreenDown(process.stdout);
            }

            console.log("No items remaining.");
        }
        else {
            const { column, card } = workArea;
            if (column.column !== lastColumn) {
                lastColumn = column.column;
                if (shouldClear) {
                    readline.cursorTo(process.stdout, 0, 3);
                    readline.clearScreenDown(process.stdout);
                }
                console.log(`Column '${column.column.name}':`);
                console.log();
            } else if (shouldClear) {
                readline.cursorTo(process.stdout, 0, 5);
                readline.clearScreenDown(process.stdout);
            }

            const result = await service.getPull(card, draft);
            if (result.error) {
                console.log(`[${column.offset}/${column.cards.length}] ${result.message}, skipping.`);
                shouldClear = false;
                continue;
            }

            const { pull, labels } = result;
            currentPull = pull;
            console.log(
                `[${column.offset}/${column.cards.length}] ${pull.title}\n` +
                `\t${chalk.underline(chalk.cyan(pull.html_url))}\n` +
                `\tupdated: ${card.updated_at}\n` +
                `\tapproved by you: ${pull.approvedByMe ? chalk.green("yes") : "no"}, approved: ${pull.approvedByAll ? chalk.green("yes") : "no"}\n` +
                `\t${[...labels].join(', ')}`);
            console.log();
            await chrome.navigateTo(pull.html_url);
        }

        await pushPrompt(runDownPrompt);
        shouldClear = true;
    }

    function shouldPopulateState(state: ColumnRunDownState | undefined) {
        return !state || state.oldestFirst !== oldest;
    }

    async function populateState(column: Column): Promise<ColumnRunDownState> {
        const cards = await service.getCards(column, oldest);
        return { column: column, cards, offset: 0, oldestFirst: oldest };
    }

    function nextCard(column: ColumnRunDownState | undefined): WorkArea | undefined {
        if (column && column.offset < column.cards.length) {
            return { column, card: column.cards[column.offset++] };
        }
    }
}

main().catch(e => console.error(e));
