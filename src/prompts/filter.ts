import chalk from "chalk";
import { Context } from "../context";
import { Prompt } from "../prompt";
import { Settings } from "../settings";

interface FilterPromptState {
    checkAndMerge: boolean;
    review: boolean;
    draft: boolean;
    wip: boolean;
    skipped: boolean;
    oldest: boolean;
}

export function createFilterPrompt(settings: Settings, appContext: Context): Prompt<boolean, FilterPromptState> {
    return {
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
                key: "w",
                description: ({ state }) => `${(state.wip !== settings.wip ? chalk.yellow : chalk.reset)(state.wip ? "exclude" : "include")} Work-in-progress PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.wip,
                action: (_, context) => {
                    context.state.wip = !context.state.wip;
                    context.refresh();
                }
            },
            {
                key: "s",
                description: ({ state }) => `${(state.skipped !== settings.skipped ? chalk.yellow : chalk.reset)(state.skipped ? "exclude" : "include")} Skipped PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.skipped,
                action: (_, context) => {
                    context.state.skipped = !context.state.skipped;
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
                    !!state.wip === settings.wip &&
                    !!state.skipped === settings.skipped &&
                    !!state.oldest === settings.oldest,
                action: (_, context) => {
                    let shouldReset = false;
                    const { state } = context;
                    if (!!state.checkAndMerge !== settings.needsAction) {
                        settings.needsAction = !!state.checkAndMerge;
                        appContext.actionState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.review !== settings.needsReview) {
                        settings.needsReview = !!state.review;
                        appContext.reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.draft !== settings.draft) {
                        settings.draft = !!state.draft;
                        appContext.actionState = undefined;
                        appContext.reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.wip !== settings.wip) {
                        settings.wip = !!state.wip;
                        appContext.actionState = undefined;
                        appContext.reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.skipped !== settings.skipped) {
                        settings.skipped = !!state.skipped;
                        appContext.actionState = undefined;
                        appContext.reviewState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.oldest !== settings.oldest) {
                        settings.oldest = !!state.oldest;
                        appContext.actionState = undefined;
                        appContext.reviewState = undefined;
                        shouldReset = true;
                    }
                    if (shouldReset) {
                        appContext.chrome.reset();
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
}