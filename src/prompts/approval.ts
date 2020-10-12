import chalk from "chalk";
import { Prompt } from "../prompt";
import { Settings } from "../settings";

interface ApprovalPromptState {
    approvalMode: "manual" | "auto" | "always" | "only";
}

export function createApprovalPrompt(settings: Settings): Prompt<boolean, ApprovalPromptState> {
    return {
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
}