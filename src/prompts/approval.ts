import chalk from "chalk";
import { Prompt } from "../prompt";
import { ApprovalMode, Settings } from "../settings";

interface ApprovalPromptState {
    approvalMode: ApprovalMode;
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
                description: "approve manually.",
                checkStyle: "radio",
                checked: ({ state }) => state.approvalMode === "manual",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "manual" && settings.approve === "manual" ? chalk.yellow : undefined }),
                action: async (prompt) => {
                    prompt.state.approvalMode = "manual";
                    await prompt.refresh();
                }
            },
            {
                key: "n",
                description: "approve when merging if there are no other (recent) approvals by owners.",
                checkStyle: "radio",
                checked: ({ state }) => state.approvalMode === "auto",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "auto" && settings.approve === "auto" ? chalk.yellow : undefined }),
                action: async (prompt) => {
                    prompt.state.approvalMode = "auto";
                    await prompt.refresh();
                }
            },
            {
                key: "a",
                description: "approve when merging if you haven't already approved the most recent commit.",
                checkStyle: "radio",
                checked: ({ state }) => state.approvalMode === "always",
                checkColor: ({ state }) => ({ color: state.approvalMode !== "always" && settings.approve === "always" ? chalk.yellow : undefined }),
                action: async (prompt) => {
                    prompt.state.approvalMode = "always";
                    await prompt.refresh();
                }
            },
            {
                key: "enter",
                description: "accept changes",
                disabled: ({ state }) => state.approvalMode === settings.approve,
                action: async (prompt) => {
                    const oldApprovalMode = settings.approve;
                    settings.approve = prompt.state.approvalMode ?? settings.approve;
                    await prompt.close(settings.approve !== oldApprovalMode);
                }
            },
            {
                key: "escape",
                description: "cancel",
                action: async (prompt) => {
                    await prompt.close(false);
                }
            }
        ]
    };
}