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

import chalk from "chalk";
import { Context } from "../context.js";
import { Prompt } from "../prompt.js";
import { Settings } from "../settings.js";

interface FilterPromptState {
    needsAction: boolean;
    needsReview: boolean;
    draft: boolean;
    wip: boolean;
    skipped: boolean;
    oldest: boolean;
}

export function createFilterPrompt(settings: Settings, appContext: Context): Prompt<boolean, FilterPromptState> {
    return {
        title: "Filter Options",
        onEnter: ({ state }) => {
            state.needsAction = settings.needsAction;
            state.needsReview = settings.needsReview;
            state.draft = settings.draft;
            state.oldest = settings.oldest;
        },
        options: [
            {
                key: "r",
                description: ({ state }) => `${(state.needsReview !== settings.needsReview ? chalk.yellow : chalk.reset)(state.needsReview ? "exclude" : "include")} 'Needs Maintainer Review' column`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.needsReview,
                action: async (prompt) => {
                    prompt.state.needsReview = !prompt.state.needsReview;
                    await prompt.refresh();
                }
            },
            {
                key: "a",
                description: ({ state }) => `${(state.needsAction !== settings.needsAction ? chalk.yellow : chalk.reset)(state.needsAction ? "exclude" : "include")} 'Needs Maintainer Action' column`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.needsAction,
                action: async (prompt) => {
                    prompt.state.needsAction = !prompt.state.needsAction;
                    await prompt.refresh();
                }
            },
            {
                key: "d",
                description: ({ state }) => `${(state.draft !== settings.draft ? chalk.yellow : chalk.reset)(state.draft ? "exclude" : "include")} Draft PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.draft,
                action: async (prompt) => {
                    prompt.state.draft = !prompt.state.draft;
                    await prompt.refresh();
                }
            },
            {
                key: "w",
                description: ({ state }) => `${(state.wip !== settings.wip ? chalk.yellow : chalk.reset)(state.wip ? "exclude" : "include")} Work-in-progress PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.wip,
                action: async (prompt) => {
                    prompt.state.wip = !prompt.state.wip;
                    await prompt.refresh();
                }
            },
            {
                key: "s",
                description: ({ state }) => `${(state.skipped !== settings.skipped ? chalk.yellow : chalk.reset)(state.skipped ? "exclude" : "include")} Skipped PRs`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.skipped,
                action: async (prompt) => {
                    prompt.state.skipped = !prompt.state.skipped;
                    await prompt.refresh();
                }
            },
            {
                key: "o",
                description: ({ state }) => `order by ${(state.oldest !== settings.oldest ? chalk.yellow : chalk.reset)(state.oldest ? "newest" : "oldest")}`,
                checkStyle: "checkbox",
                checked: ({ state }) => state.oldest,
                action: async (prompt) => {
                    prompt.state.oldest = !prompt.state.oldest;
                    await prompt.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) =>
                    !!state.needsAction === settings.needsAction &&
                    !!state.needsReview === settings.needsReview &&
                    !!state.draft === settings.draft &&
                    !!state.wip === settings.wip &&
                    !!state.skipped === settings.skipped &&
                    !!state.oldest === settings.oldest,
                action: async (prompt) => {
                    let shouldReset = false;
                    const { state } = prompt;
                    if (!!state.needsAction !== settings.needsAction) {
                        settings.needsAction = !!state.needsAction;
                        appContext.actionState = undefined;
                        shouldReset = true;
                    }
                    if (!!state.needsReview !== settings.needsReview) {
                        settings.needsReview = !!state.needsReview;
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
                    await prompt.close(shouldReset);
                }
            },
            {
                key: "escape",
                description: "cancel",
                action: (prompt) => prompt.close(false)
            }
        ]
    };
}