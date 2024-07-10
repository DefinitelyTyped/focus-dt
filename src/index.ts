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
import { format as formatTimeago } from "timeago.js";
import { ProjectService, Column, Label } from "./github.js";
import { Chrome } from "./chrome.js";
import { pushPrompt, addOnQuit, isPromptVisible, hidePrompt, showPrompt, getPromptLineCount, addOnPromptSizeChange } from "./prompt.js";
import { readSkipped } from "./settings.js";
import { Screen } from "./screen.js";
import { createMergePrompt } from "./prompts/merge.js";
import { createApprovalPrompt } from "./prompts/approval.js";
import { CardRunDownState, ColumnRunDownState, Context, WorkArea } from "./context.js";
import { createFilterPrompt } from "./prompts/filter.js";
import { createRunDownPrompt } from "./prompts/runDown.js";
import { init } from "./init.js";

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
        currentState: undefined,
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
    let lastColumn1SkippedCount: number | undefined;
    let lastColumn1DeferredCount: number | undefined;
    let lastColumn2CompletedCount: number | undefined;
    let lastColumn2SkippedCount: number | undefined;
    let lastColumn2DeferredCount: number | undefined;

    while (true) {
        context.currentPull = undefined;
        if (settings.needsAction && (shouldPopulateState(context.actionState) || context.actionState?.refresh)) {
            context.actionState = await populateState(columns["Needs Maintainer Action"], context.actionState);
        }

        if (settings.needsReview && (shouldPopulateState(context.reviewState) || context.actionState?.refresh)) {
            context.reviewState = await populateState(columns["Needs Maintainer Review"], context.reviewState);
        }

        const column1 = context.reviewState;
        const column2 = context.actionState;

        context.workArea = nextCard(context.currentState);
        if (!context.workArea) {
            context.currentState = nextColumn();
            context.workArea = nextCard(context.currentState);
        }

        if (lastShowAction !== settings.needsAction ||
            lastShowReview !== settings.needsReview ||
            !context.workArea ||
            context.workArea.column.column !== lastColumn ||
            lastColumn1CompletedCount !== column1?.completedCount ||
            lastColumn1SkippedCount !== column1?.skippedCount ||
            lastColumn1DeferredCount !== column1?.deferredCount ||
            lastColumn2CompletedCount !== column2?.completedCount ||
            lastColumn2SkippedCount !== column2?.skippedCount ||
            lastColumn2DeferredCount !== column2?.deferredCount
        ) {
            lastShowAction = settings.needsAction;
            lastShowReview = settings.needsReview;
            lastColumn1CompletedCount = column1?.completedCount;
            lastColumn1SkippedCount = column1?.skippedCount;
            lastColumn1DeferredCount = column1?.deferredCount;
            lastColumn2CompletedCount = column2?.completedCount;
            lastColumn2SkippedCount = column2?.skippedCount;
            lastColumn2DeferredCount = column2?.deferredCount;

            screen.clearHeader({ clearProgress: false, clearLog: false });
            const columnName = context.workArea?.column.column.name;
            const column1Name = "Needs Maintainer Review";
            const column2Name = "Needs Maintainer Action";
            const column1Text = formatTab(column1, column1Name, columnName === column1Name);
            const column2Text = formatTab(column2, column2Name, columnName === column2Name);
            screen.addHeader(`${column1Text} ${column2Text} order by: ${settings.oldest ? "oldest" : "newest"} first`);
            screen.render();
        }

        if (!context.workArea) {
            lastColumn = undefined;
            screen.clearProgress();
            const pluralRules = new Intl.PluralRules("en-US", { type: "cardinal" });
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

            const result = await service.getPullFromCard(card.card, settings.draft, settings.wip, settings.skipped ? undefined : context.skipped);
            if (result.error) {
                screen.addLog(`[${column.offset}/${column.cards.length}] ${result.message}, skipping.`);
                screen.render();
                context.workArea.column.skippedCount++;
                card.skipped = true;
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
            screen.addPull(chalk`    {whiteBright Updated:} ${formatDate(pull.lastUpdatedAt ?? pull.updated_at)}${skipMessage}`);
            screen.addPull(chalk`    {whiteBright Tags:}    ${[...labels].map(colorizeLabel).join(', ')}`);
            if (pull.botStatus) {
                screen.addPull(chalk`    {whiteBright Status:}`);
                for (const line of pull.botStatus) {
                    if (line.trim()) {
                        const lineText = line
                            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                            .replace(/(?<=changes which affect DT infrastructure) \(((?:(?:, )?`[^`]+`)+)\)/, (_, filesText: string) => `:${
                                filesText
                                    .split(/, ?/g)
                                    .map(file => `\n          📄 ${file.slice(1, -1)}`)
                                    .join("")
                            }`);
                        screen.addPull(`    ${lineText}`);
                    }
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
                    screen.addPull(chalk`     * ${mark} {whiteBright @${review.user.login}} ${ownerReviewFor} {${color} ${message}} on ${formatDate(review.submitted_at)}${outdated}.`);
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
                    screen.addPull(chalk`     * ${mark} {whiteBright @${review.user.login}} {${color} ${message}} on ${formatDate(review.submitted_at)}${outdated}.`);
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
                    screen.addPull(chalk`       {whiteBright @${commit.committer?.login}} on ${formatDate(commit.commit.committer?.date)}`);
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

    async function populateState(column: Column, previousState: ColumnRunDownState | undefined): Promise<ColumnRunDownState> {
        const cards = await service.getCards(column, settings.oldest);
        const newState: ColumnRunDownState = { column, cards: cards.map(card => ({ card })), offset: 0, oldestFirst: settings.oldest, completedCount: 0, skippedCount: 0, deferredCount: 0 };
        if (previousState?.refresh) {
            // move previously seen, unchanged cards to the front
            // move deferred cards to the end
            const deferredCards: CardRunDownState[] = [];
            const previouslySeenCards: CardRunDownState[] = [];
            const otherCards: CardRunDownState[] = [];
            for (const newCard of newState.cards) {
                const prevCardIndex = previousState.cards.findIndex(prevCard => prevCard.card.id === newCard.card.id);
                if (prevCardIndex >= 0) {
                    const prevCard = previousState.cards[prevCardIndex];
                    if (prevCard.deferred) {
                        newCard.deferred = true;
                        newState.deferredCount++;
                        deferredCards.push(newCard);
                        continue;
                    }
    
                    if (prevCard.skipped) {
                        newCard.skipped = true;
                        newState.skippedCount++;
                    }

                    if (prevCardIndex <= previousState.offset) {
                        previouslySeenCards.push(newCard);
                    }
                    else {
                        otherCards.push(newCard);
                    }
                }
            }

            newState.cards = [
                ...previouslySeenCards,
                ...otherCards,
                ...deferredCards,
            ];

            newState.offset = previouslySeenCards.length;
        }
        return newState;
    }

    function nextColumn() {
        return context.currentState === context.reviewState ?
            context.actionState ?? context.reviewState :
            context.reviewState ?? context.actionState;
    }

    function nextCard(column: ColumnRunDownState | undefined): WorkArea | undefined {
        if (column && column.offset < column.cards.length) {
            const card = column.cards[column.offset++];
            if (card.deferred) {
                column.deferredCount--;
                card.deferred = false;
            }
            if (card.skipped) {
                column.skippedCount--;
                card.skipped = false;
            }
            return { column, card };
        }
    }
}

function formatTab(column: ColumnRunDownState | undefined, columnName: string, selected: boolean) {
    const column1Selected = selected ? "* " : "";
    const columnColor = column1Selected ? "bgCyan.whiteBright" : "bgGray.black";
    const columnLeft = column1Selected ? chalk.cyan("▟") : chalk.gray("▟");
    const columnRight = column1Selected ? chalk.cyan("▙") : chalk.gray("▙");

    let columnCount: string;
    if (column) {
        columnCount = `${column.cards.length}`;
        if (selected || column.completedCount) {
            columnCount = `${column.completedCount || 0}/${columnCount}`;
        }
        if (column.deferredCount) {
            columnCount += ` ~${column.deferredCount}`;
        }
        if (column.skippedCount) {
            columnCount += ` ?${column.skippedCount}`;
        }
    }
    else {
        columnCount = "excluded";
    }

    return chalk`${columnLeft}{${columnColor}  ${column1Selected}${columnName}: ${columnCount} }${columnRight}`;
}

const yearMonthDayFormat = new Intl.DateTimeFormat('en-US', {
    dateStyle: "medium"
});

const monthDayFormat = new Intl.DateTimeFormat('en-US', {
    month: "short",
    day: "numeric",
});

const timeFormat = new Intl.DateTimeFormat('en-US', {
    timeStyle: "short"
});

function formatDate(value: Date | string | number | undefined) {
    if (value === undefined) return "";
    if (typeof value === "number" || typeof value === "string") value = new Date(value);
    const now = new Date();
    const timeago = formatTimeago(value, "en_US", { relativeDate: now });
    const fmt =
        value.getFullYear() !== now.getFullYear() ? yearMonthDayFormat :
        value.getMonth() !== now.getMonth() || value.getDay() !== now.getDay() ? monthDayFormat :
        timeFormat;
    return `${fmt.format(value)} (${timeago})`;
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
