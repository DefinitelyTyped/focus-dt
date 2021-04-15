import chalk from "chalk";
import { Prompt } from "../prompt";
import { Settings } from "../settings";

interface MergePromptState {
    defaultMerge: "merge" | "squash" | "rebase";
}

export function createMergePrompt(settings: Settings): Prompt<boolean, MergePromptState> {
    return {
        title: "Merge Options",
        onEnter: ({ state }) => {
            state.defaultMerge = settings.merge;
        },
        options: [
            {
                key: "m",
                description: "merge using merge commit",
                checkStyle: "radio",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "merge" && settings.merge === "merge" ? chalk.yellow : undefined }),
                checked: ({ state }) => state.defaultMerge === "merge",
                action: async (prompt) => {
                    prompt.state.defaultMerge = "merge";
                    await prompt.refresh();
                }
            },
            {
                key: "s",
                description: "merge using squash",
                checkStyle: "radio",
                checked: ({ state }) => state.defaultMerge === "squash",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "squash" && settings.merge === "squash" ? chalk.yellow : undefined }),
                action: async (prompt) => {
                    prompt.state.defaultMerge = "squash";
                    await prompt.refresh();
                }
            },
            {
                key: "r",
                description: "merge using rebase",
                checkStyle: "radio",
                checked: ({ state }) => state.defaultMerge === "rebase",
                checkColor: ({ state }) => ({ color: state.defaultMerge !== "rebase" && settings.merge === "rebase" ? chalk.yellow : undefined }),
                action: async (prompt) => {
                    prompt.state.defaultMerge = "rebase";
                    await prompt.refresh();
                }
            },
            {
                key: "x",
                description: "clear default merge option",
                checkStyle: "radio",
                checked: ({ state }) => state.defaultMerge === undefined,
                checkColor: ({ state }) => ({ color: state.defaultMerge !== undefined && settings.merge === undefined ? chalk.yellow : undefined }),
                action: async (prompt) => {
                    prompt.state.defaultMerge = undefined;
                    await prompt.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) => state.defaultMerge === settings.merge,
                action: async (prompt) => {
                    const oldDefaultMerge = settings.merge;
                    settings.merge = prompt.state.defaultMerge;
                    await prompt.close(settings.merge !== oldDefaultMerge);
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