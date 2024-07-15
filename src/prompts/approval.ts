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
import { Prompt } from "../prompt.js";
import { ApprovalMode, Settings } from "../settings.js";

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