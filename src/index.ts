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

import { CancelToken, CancelSource } from "@esfx/async-canceltoken";
import { argv } from "./options";
import prompts = require("prompts");
import Github = require("@octokit/rest");
import { ProjectService, Column, Card, Pull, GetPullResult } from "./github";
import { getChromePath, Chrome } from "./chrome";
import chalk from "chalk";
import * as readline from "readline";
import * as fs from "fs";
import { Prompt, pushPrompt, Option, popPrompt, waitForPause as waitForPrompt, showPrompt, refreshPrompt, hidePrompt, addOnQuit, getCurrentPrompt } from "./prompt";

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
        merge,
        port = 9222,
        timeout = 10000,
    } = argv;

    if (port <= 0) port = getRandomPort();

    if (!review && !checkAndMerge) {
        review = true;
        checkAndMerge = true;
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

    return {
        token,
        username,
        password,
        review,
        checkAndMerge,
        defaultMerge,
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
        options: [{
            key: "f",
            description: "change filters",
            advanced: true,
            action: () => {
                requestedCheckAndMerge = checkAndMerge;
                requestedReview = review;
                requestedDraft = draft;
                requestedOldest = oldest;
                pushPrompt(filterPrompt);
            },
        }, {
            key: "alt+m",
            advanced: true,
            description: "set the default merge option",
            action: () => {
                pushPrompt(mergePrompt);
            }
        }, {
            key: "a",
            description: "approve",
            disabled: () => !!currentPull?.approved,
            action: async () => {
                if (!currentPull) return;
                hidePrompt();
                process.stdout.write("Approving...");
                await service.approvePull(currentPull);
                process.stdout.write("Approved.\n\n");
                log.write(`[${new Date().toISOString()}] #${currentPull.number} '${currentPull.title}': Approved\n`);
                refreshPrompt();
                showPrompt();
            }
        }, {
            key: "m",
            description: () => defaultMerge ? `merge using ${defaultMerge === "merge" ? "merge commit" : defaultMerge}` : "merge",
            action: () => {
                if (defaultMerge) {
                    return doMerge(defaultMerge);
                }
                return pushPrompt(mergePrompt).then(() => {
                    refreshPrompt();
                    if (defaultMerge) {
                        return doMerge(defaultMerge);
                    }
                });
            }
        }, {
            key: "s",
            description: "skip",
            action: () => {
                popPrompt();
            }
        }]
    };

    let requestedCheckAndMerge: boolean;
    let requestedReview: boolean;
    let requestedDraft: boolean;
    let requestedOldest: boolean;
    const filterPrompt: Prompt = {
        title: "Filter Options",
        options: [{
            key: "c",
            description: () => `${chalk[requestedCheckAndMerge === checkAndMerge ? "reset" : "red"](requestedCheckAndMerge ? "exclude" : "include")} 'Check and Merge' column`,
            action: () => {
                requestedCheckAndMerge = !requestedCheckAndMerge;
                refreshPrompt();
            }
        }, {
            key: "r",
            description: () => `${chalk[requestedReview === review ? "reset" : "red"](requestedReview ? "exclude" : "include")} 'Review' column`,
            action: () => {
                requestedReview = !requestedReview;
                refreshPrompt();
            }
        }, {
            key: "d",
            description: () => `${chalk[requestedDraft === draft ? "reset" : "red"](requestedDraft ? "exclude" : "include")} Draft PRs`,
            action: () => {
                requestedDraft = !requestedDraft;
                refreshPrompt();
            }
        }, {
            key: "o",
            description: () => `order by ${chalk[requestedOldest === oldest ? "reset" : "red"](requestedOldest ? "newest" : "oldest")}`,
            action: () => {
                requestedOldest = !requestedOldest;
                refreshPrompt();
            }
        }, {
            key: "enter",
            description: "accept changes",
            disabled: () =>
                requestedCheckAndMerge === checkAndMerge &&
                requestedReview === review &&
                requestedDraft === draft &&
                requestedOldest === oldest,
            action: () => {
                let shouldReset = false;
                if (requestedCheckAndMerge !== checkAndMerge) {
                    checkAndMerge = requestedCheckAndMerge;
                    checkAndMergeState = undefined;
                    shouldReset = true;
                }
                if (requestedReview !== review) {
                    review = requestedReview;
                    reviewState = undefined;
                    shouldReset = true;
                }
                if (requestedDraft !== draft) {
                    draft = requestedDraft;
                    checkAndMergeState = undefined;
                    reviewState = undefined;
                    shouldReset = true;
                }
                if (requestedOldest !== oldest) {
                    oldest = requestedOldest;
                    checkAndMergeState = undefined;
                    reviewState = undefined;
                    shouldReset = true;
                }
                if (shouldReset) {
                    chrome.reset();
                }
                popPrompt();
                popPrompt();
            }
        }, {
            key: "escape",
            description: "cancel",
            action: () => {
                hidePrompt();
                popPrompt();
            }
        }]
    };

    async function doMerge(merge: "merge" | "squash" | "rebase") {
        if (!currentPull) return;
        hidePrompt();
        defaultMerge = merge;
        process.stdout.write("Merging...");
        await service.mergePull(currentPull, merge);
        process.stdout.write("Merged.\n\n");
        log.write(`[${new Date().toISOString()}] #${currentPull!.number} '${currentPull!.title}': Merged using ${merge}\n`);
        if (getCurrentPrompt() === mergePrompt) {
            popPrompt();
        }
        if (getCurrentPrompt() === runDownPrompt) {
            popPrompt();
        }
    }

    let requestedDefaultMerge: "merge" | "squash" | "rebase" | undefined;
    const mergePrompt: Prompt = {
        title: "Merge Options",
        options: [{
            key: "m",
            description: () => chalk[defaultMerge === "merge" ? "green" : requestedDefaultMerge === "merge" ? "red" : "reset"](`merge using merge commit`),
            action: () => {
                requestedDefaultMerge = "merge";
                refreshPrompt();
            }
        }, {
            key: "s",
            description: () => chalk[defaultMerge === "squash" ? "green" : requestedDefaultMerge === "squash" ? "red" : "reset"](`merge using squash`),
            action: () => {
                requestedDefaultMerge = "squash";
                refreshPrompt();
            }
        }, {
            key: "r",
            description: () => chalk[defaultMerge === "rebase" ? "green" : requestedDefaultMerge === "rebase" ? "red" : "reset"](`merge using rebase`),
            action: () => {
                requestedDefaultMerge = "rebase";
                refreshPrompt();
            }
        }, {
            key: "enter",
            description: "accept changes",
            disabled: () => requestedDefaultMerge === defaultMerge,
            action: () => {
                defaultMerge = requestedDefaultMerge;
                popPrompt();
                refreshPrompt();
            }
        }, {
            key: "escape",
            description: "cancel",
            action: () => popPrompt()
        }]
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
        let dataRequested = false;
        if (checkAndMerge && shouldPopulateState(checkAndMergeState)) {
            checkAndMergeState = await populateState(columns["Check and Merge"]);
            dataRequested = true;
        }

        if (review && shouldPopulateState(reviewState)) {
            reviewState = await populateState(columns["Review"]);
            dataRequested = true;
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
            console.log(`[${column.offset}/${column.cards.length}] ${pull.title}\n\t${chalk.underline(chalk.cyan(pull.html_url))}\n\tupdated: ${card.updated_at}\n\tapproved by you: ${pull.approved ? chalk.green("yes") : "no"}\n\t${[...labels].join(', ')}`);
            console.log();

            await chrome.navigateTo(pull.html_url);
        }

        pushPrompt(runDownPrompt);
        await waitForPrompt();
        popPrompt();
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
