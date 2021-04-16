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
import colorConvert = require("color-convert");
import { ProjectService, Column, Label } from "./github";
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
    process.title = "focus-dt";
    let {
        token,
        credential,
        settings
    } = await init();

    if (!token) {
        return;
    }

    const chrome = new Chrome(settings.port, settings.timeout, settings.chromePath);
    const log = fs.createWriteStream("focus-dt.log", { flags: "a" });

    addOnQuit(() => {
        chrome.close();
        log.close();
    });

    const service = new ProjectService({
        credential,
        github: { auth: token },
        project: ProjectService.defaultProject,
        columns: ProjectService.defaultColumns,
        owner: "DefinitelyTyped",
        repo: "DefinitelyTyped",
        team: "typescript-team"
    });

    credential = undefined;
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
    let lastColumn1CompletedCount: number | undefined;
    let lastColumn2CompletedCount: number | undefined;

    while (true) {
        context.currentPull = undefined;
        if (settings.needsAction && shouldPopulateState(context.actionState)) {
            context.actionState = await populateState(columns["Needs Maintainer Action"]);
        }

        if (settings.needsReview && shouldPopulateState(context.reviewState)) {
            context.reviewState = await populateState(columns["Needs Maintainer Review"]);
        }

        const column1 = context.reviewState;
        const column2 = context.actionState;
        context.workArea = nextCard(column1) || nextCard(column2);
        if (lastShowAction !== settings.needsAction ||
            lastShowReview !== settings.needsReview ||
            !context.workArea ||
            context.workArea.column.column !== lastColumn ||
            lastColumn1CompletedCount !== column1?.completedCount ||
            lastColumn2CompletedCount !== column2?.completedCount) {
            lastShowAction = settings.needsAction;
            lastShowReview = settings.needsReview;
            lastColumn1CompletedCount = column1?.completedCount;
            lastColumn2CompletedCount = column2?.completedCount;
            screen.clearHeader();
            const columnName = context.workArea?.column.column.name;
            const column1Name = "Needs Maintainer Review";
            const column1Selected = columnName === column1Name ? "* " : "";
            const column1Color = column1Selected ? "bgCyan.whiteBright" : "bgGray.black";
            const column1Count = column1 ? column1Selected || lastColumn1CompletedCount ? `${lastColumn1CompletedCount || 0}/${column1.cards.length}` : column1.cards.length : "excluded";
            const column2Name = "Needs Maintainer Action";
            const column2Selected = columnName === column2Name ? "* " : "";
            const column2Color = column2Selected ? "bgCyan.whiteBright" : "bgGray.black";
            const column2Count = column2 ? column2Selected || lastColumn2CompletedCount ? `${lastColumn2CompletedCount || 0}/${column2.cards.length}` : column2.cards.length : "excluded";
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

            const result = await service.getPullFromCard(card, settings.draft, settings.wip, settings.skipped ? undefined : context.skipped);
            if (result.error) {
                screen.addLog(`[${column.offset}/${column.cards.length}] ${result.message}, skipping.`);
                screen.render();
                continue;
            }

            const { pull, labels } = result;

            // If we previously skipped this pull and it has been updated since it was last skipped, remove it from the list of skipped PRs.
            const skippedTimestamp = context.skipped.get(pull.number);
            const skipMessage = skippedTimestamp && !service.shouldSkip(pull, context.skipped) ?
                chalk`, {yellow skipped}: ${new Date(skippedTimestamp).toISOString().replace(/\.\d+Z$/, "Z")}` :
                "";
            context.currentPull = pull;
            screen.clearPull();
            screen.addPull(`[${column.offset}/${column.cards.length}] ${pull.title}`);
            screen.addPull(chalk`    {cyan.underline ${pull.html_url}}{reset }`);
            screen.addPull(chalk`    {whiteBright Author:}  @${pull.user?.login}`);
            screen.addPull(chalk`    {whiteBright Updated:} ${pull.lastUpdatedAt ?? pull.updated_at}${skipMessage}`);
            screen.addPull(chalk`    {whiteBright Tags:}    ${[...labels].map(colorizeLabel).join(', ')}`);
            if (pull.botStatus) {
                screen.addPull(chalk`    {whiteBright Status:}`);
                for (const line of pull.botStatus) {
                    if (line.trim()) screen.addPull(`    ${line}`);
                }
            }
            if (pull.ownerReviews) {
                const outdated = pull.approvedByOwners === "outdated" ? chalk` {yellow [outdated]}` : "";
                screen.addPull(chalk`    {whiteBright Owner Reviews:}${outdated}`);
                const packages = new Set(pull.botData?.pkgInfo.map(pkg => pkg.name));
                for (const review of pull.ownerReviews) {
                    if (review.maintainerReview || !review.ownerReviewFor) continue;
                    const approved = review.state === "APPROVED";
                    const mark = approved ? "✅" : "❌";
                    const color = approved ? "greenBright" : "redBright";
                    const message = approved ? "approved" : "requested changes";
                    const ownerReviewFor = `(${review.ownerReviewFor.join(", ")})`;
                    const outdated = review.isOutdated ? chalk` {yellow [outdated]}` : "";
                    screen.addPull(chalk`     * ${mark} {whiteBright @${review.user.login}} ${ownerReviewFor} {${color} ${message}} on ${review.submitted_at}${outdated}.`);
                    for (const packageName of review.ownerReviewFor) {
                        packages.delete(packageName);
                    }
                }
                for (const packageName of packages) {
                    screen.addPull(chalk`     * ❌ {whiteBright Package '${packageName}'} missing reviewer.`);
                }
            }
            if (pull.maintainerReviews) {
                const outdated = pull.approvedByMaintainer === "outdated" ? chalk` {yellow [outdated]}` : "";
                screen.addPull(chalk`    {whiteBright Maintainer Reviews:}${outdated}`);
                for (const review of pull.maintainerReviews) {
                    const approved = review.state === "APPROVED";
                    const mark = approved ? "✅" : "❌";
                    const color = approved ? "greenBright" : "redBright";
                    const message = approved ? "approved" : "requested changes";
                    const outdated = review.isOutdated ? chalk` {yellow [outdated]}` : "";
                    screen.addPull(chalk`     * ${mark} {whiteBright @${review.user.login}} {${color} ${message}} on ${review.submitted_at}${outdated}.`);
                }
            }
            if (pull.recentCommits) {
                const recentCommits = pull.recentCommits.slice(-2).sort((a, b) => 
                    (a.commit.committer?.date || "") < (b.commit.committer?.date || "") ? -1 :
                    (a.commit.committer?.date || "") > (b.commit.committer?.date || "") ? 1 :
                    0);
                screen.addPull(chalk`    {whiteBright Recent Commits${pull.approvedByMe === "outdated" ? " (since you last approved)" : ""}:}`);
                for (const commit of recentCommits) {
                    screen.addPull(`     * ${commit.commit.message.replace(/\n(\s*\n)+/g, "\n").replace(/\n(?!$)/g, "\n       ")}`);
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
        return { column: column, cards, offset: 0, oldestFirst: settings.oldest, completedCount: 0 };
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
