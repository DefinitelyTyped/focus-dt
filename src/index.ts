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

import * as fs from "fs";
import chalk from "chalk";
import prompts = require("prompts");
import { ProjectService, Column } from "./github";
import { Chrome } from "./chrome";
import { pushPrompt, addOnQuit, isPromptVisible, hidePrompt, showPrompt, getPromptLineCount, addOnPromptSizeChange } from "./prompt";
import { readSkipped } from "./settings";
import { Screen } from "./screen";
import { createMergePrompt } from "./prompts/merge";
import { createApprovalPrompt } from "./prompts/approval";
import { ColumnRunDownState, Context, WorkArea } from "./context";
import { createFilterPrompt } from "./prompts/filter";
import { createRunDownPrompt } from "./prompts/runDown";
import { init } from "./init";

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

    const chrome = new Chrome(settings.port, settings.timeout, settings.chromePath);
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
    const screen = new Screen(process.stdout, {
        getPromptLineCount,
        isPromptVisible,
        showPrompt,
        hidePrompt,
        addOnPromptSizeChange
    });
    const context: Context = {
        actionState: undefined,
        reviewState: undefined,
        currentPull: undefined,
        workArea: undefined,
        skipped: new Set<number>(readSkipped()),
        screen,
        service,
        log,
        chrome
    };

    const filterPrompt = createFilterPrompt(settings, context);
    const approvalPrompt = createApprovalPrompt(settings);
    const mergePrompt = createMergePrompt(settings);
    const runDownPrompt = createRunDownPrompt(settings, context, filterPrompt, approvalPrompt, mergePrompt);

    let lastColumn: Column | undefined;
    let lastShowOther = false;
    let lastShowReview = false;

    while (true) {
        context.currentPull = undefined;
        if (settings.needsAction && shouldPopulateState(context.actionState)) {
            context.actionState = await populateState(columns["Needs Maintainer Action"]);
        }

        if (settings.needsReview && shouldPopulateState(context.reviewState)) {
            context.reviewState = await populateState(columns["Needs Maintainer Review"]);
        }

        if (lastShowOther !== settings.needsAction || lastShowReview !== settings.needsReview) {
            lastShowOther = settings.needsAction;
            lastShowReview = settings.needsReview;
            screen.clearHeader();
            screen.addHeader(`'Needs Maintainer Review' ${context.reviewState ? `count: ${context.reviewState.cards.length}` : "excluded."}`);
            screen.addHeader(`'Needs Maintainer Action' ${context.actionState ? `count: ${context.actionState.cards.length}` : "excluded."}`);
            screen.addHeader(`order by: ${settings.oldest ? "oldest" : "newest"} first`);
            screen.addHeader();
            screen.render();
        }

        context.workArea = nextCard(context.reviewState) || nextCard(context.actionState);
        if (!context.workArea) {
            lastColumn = undefined;
            screen.clearProgress();
            const pluralRules = Intl.PluralRules("en-US", { type: "cardinal" });
            const rule = pluralRules.select(context.skipped.size);
            screen.addProgress(context.skipped.size ? `No items remaining, but there ${rule === "one" ? "is" : "are"} ${context.skipped.size} skipped ${rule === "one" ? "item" : "items"} left to review.` : "No items remaining.");
            screen.render();
        }
        else {
            const { column, card } = context.workArea;
            if (column.column !== lastColumn) {
                lastColumn = column.column;
                screen.clearProgress();
                screen.addProgress(`Column '${column.column.name}':`);
                screen.addProgress();
                screen.render();
            }

            const result = await service.getPull(card, settings.draft, settings.wip, settings.skipped ? undefined : context.skipped);
            if (result.error) {
                screen.addLog(`[${column.offset}/${column.cards.length}] ${result.message}, skipping.`);
                screen.render();
                continue;
            }

            const { pull, labels } = result;
            context.currentPull = pull;
            screen.clearPull();
            screen.addPull(`[${column.offset}/${column.cards.length}] ${pull.title}`);
            screen.addPull(`\t${chalk.underline(chalk.cyan(pull.html_url))}${chalk.reset()}`);
            screen.addPull(`\tupdated: ${card.updated_at}`);
            screen.addPull(`\tapproved by you: ${pull.approvedByMe ? chalk.green("yes") : "no"}, approved: ${pull.approvedByAll ? chalk.green("yes") : "no"} `);
            screen.addPull(`\t${[...labels].join(', ')}`);
            if (pull.botStatus) {
                screen.addPull();
                screen.addPull(`\t${chalk.whiteBright(`Status:`)}`);
                for (const line of pull.botStatus) {
                    screen.addPull(`\t${line}`);
                }
            }
            screen.render();
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
