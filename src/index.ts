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
import colorConvert = require("color-convert");
import { ProjectService, Column, Label } from "./github";
import { Chrome } from "./chrome";
import { pushPrompt, addOnQuit, isPromptVisible, hidePrompt, showPrompt, getPromptLineCount, addOnPromptSizeChange } from "./prompt";
import { readSkipped, saveSkipped } from "./settings";
import { Screen } from "./screen";
import { createMergePrompt } from "./prompts/merge";
import { createApprovalPrompt } from "./prompts/approval";
import { ColumnRunDownState, Context, WorkArea } from "./context";
import { createFilterPrompt } from "./prompts/filter";
import { createRunDownPrompt } from "./prompts/runDown";
import { init } from "./init";
import { Octokit } from "@octokit/rest";

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
        project: ProjectService.defaultProject,
        columns: ProjectService.defaultColumns,
        owner: "DefinitelyTyped",
        repo: "DefinitelyTyped",
        team: "typescript-team"
    });

    const columns = await service.getColumns();
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
        skipped: new Map<number, number>(readSkipped()?.skipped),
        skipTimeout: 10 * 60 * 1000, // 10 minutes, in MS
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
    let lastShowAction = false;
    let lastShowReview = false;

    while (true) {
        context.currentPull = undefined;
        if (settings.needsAction && shouldPopulateState(context.actionState)) {
            context.actionState = await populateState(columns["Needs Maintainer Action"]);
        }

        if (settings.needsReview && shouldPopulateState(context.reviewState)) {
            context.reviewState = await populateState(columns["Needs Maintainer Review"]);
        }

        context.workArea = nextCard(context.reviewState) || nextCard(context.actionState);
        if (lastShowAction !== settings.needsAction ||
            lastShowReview !== settings.needsReview ||
            !context.workArea ||
            context.workArea.column.column !== lastColumn) {
            lastShowAction = settings.needsAction;
            lastShowReview = settings.needsReview;
            screen.clearHeader();
            const columnName = context.workArea?.column.column.name;
            const column1Name = "Needs Maintainer Review";
            const column1Selected = columnName === column1Name ? "* " : "";
            const column1Color = column1Selected ? "bgCyan.whiteBright" : "bgGray.black";
            const column1Count = context.reviewState?.cards.length ?? "excluded";
            const column2Name = "Needs Maintainer Action";
            const column2Selected = columnName === column2Name ? "* " : "";
            const column2Color = column2Selected ? "bgCyan.whiteBright" : "bgGray.black";
            const column2Count = context.actionState?.cards.length ?? "excluded";
            const column1Left = column1Selected ? chalk.bgBlack.cyan("▟") : chalk.bgBlack.gray("▟");
            const column1Right = column1Selected ? chalk.bgBlack.cyan("▙") : chalk.bgBlack.gray("▙");
            const column2Left = column2Selected ? chalk.bgBlack.cyan("▟") : chalk.bgBlack.gray("▟");
            const column2Right = column2Selected ? chalk.bgBlack.cyan("▙") : chalk.bgBlack.gray("▙");
            screen.addHeader(chalk`${column1Left}{${column1Color}  ${column1Selected}${column1Name}: ${column1Count} }${column1Right} ${column2Left}{${column2Color}  ${column2Selected}${column2Name}: ${column2Count} }${column2Right} order by: ${settings.oldest ? "oldest" : "newest"} first`);
            screen.render();
        }

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
                screen.render();
            }

            const result = await service.getPull(card, settings.draft, settings.wip, settings.skipped ? undefined : context.skipped, context.skipTimeout);
            if (result.error) {
                screen.addLog(`[${column.offset}/${column.cards.length}] ${result.message}, skipping.`);
                screen.render();
                continue;
            }

            const { pull, labels } = result;

            // If we previously skipped this pull and it has been updated since it was last skipped, remove it from the list of skipped PRs.
            const skippedTimestamp = context.skipped.get(pull.number);
            const skipMessage = skippedTimestamp && (skippedTimestamp + context.skipTimeout) < Date.parse(pull.updated_at) ?
                chalk`, {yellow skipped}: ${new Date(skippedTimestamp).toISOString().replace(/\.\d+Z$/, "Z")}` :
                "";
            context.currentPull = pull;
            screen.clearPull();
            screen.addPull(`[${column.offset}/${column.cards.length}] ${pull.title}`);
            screen.addPull(chalk`    {cyan.underline ${pull.html_url}}{reset }`);
            screen.addPull(chalk`    {whiteBright Author:}  @${pull.user?.login}`);
            screen.addPull(chalk`    {whiteBright Updated:} ${pull.updated_at}${skipMessage}`);
            screen.addPull(chalk`    {whiteBright Tags:}    ${[...labels].map(colorizeLabel).join(', ')}`);
            if (pull.botStatus) {
                screen.addPull(chalk`    {whiteBright Status:}`);
                for (const line of pull.botStatus) {
                    if (line.trim()) screen.addPull(`    ${line}`);
                }
            }
            if (pull.teamMembersWithReviews) {
                screen.addPull(chalk`    {whiteBright Maintainer Reviews:}`);
                for (const member of pull.teamMembersWithReviews) {
                    const approved = member.state === "APPROVED";
                    const mark = approved ? "✅" : "❌";
                    const color = approved ? "greenBright" : "redBright";
                    const message = approved ? "approved" : "requested changes";
                    screen.addPull(chalk`     * ${mark} {whiteBright @${member.login}} {${color} ${message}} on ${member.submitted_at}.`);
                }
            }
            if (pull.recentCommits) {
                const recentCommits = pull.recentCommits.slice(-2).sort((a, b) => 
                    (a.commit.committer?.date || "") < (b.commit.committer?.date || "") ? -1 :
                    (a.commit.committer?.date || "") > (b.commit.committer?.date || "") ? 1 :
                    0);
                screen.addPull(chalk`    {whiteBright Recent Commits${pull.approvedByMe === "recheck" ? " (since you last approved)" : ""}:}`);
                for (const commit of recentCommits) {
                    screen.addPull(`     * ${commit.commit.message}`);
                    screen.addPull(chalk`       {whiteBright @${commit.committer?.login}} on ${commit.commit.committer?.date}`);
                }
            }
            screen.addPull(" ");
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

function colorizeLabel(label: Label) {
    let text = labelMap.get(label.name.toLowerCase());
    if (text) return text;

    if (label.color) {
        const [red, green, blue] = colorConvert.hex.rgb(label.color);
        // https://en.wikipedia.org/wiki/Relative_luminance
        const luminosity = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        if (luminosity > 0.3) {
            // bright color, use as foreground
            return chalk.hex(label.color)(label.name);
        } else {
            // dark color, use as background
            return chalk.bgHex(label.color)(chalk.white(label.name));
        }
    }

    return label.name;
}

const labelMap = new Map([
    ["critical package", chalk.redBright("Critical package")]
]);

main().catch(e => console.error(e));
