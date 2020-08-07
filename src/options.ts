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

import yargs = require("yargs");
import { getDefaultSettingsFile, readSettings } from "./settings";

export const options = yargs
    .option("token", {
        desc: "GitHub Auth Token. Uses %GITHUB_API_TOKEN%, %FOCUS_DT_GITHUB_API_TOKEN%, or %AUTH_TOKEN% (in that order) if available.",
        conflicts: ["username", "password"],
        type: "string",
    })
    .option("username", {
        desc: "GitHub Username",
        conflicts: ["token"],
        implies: "password",
        type: "string"
    })
    .option("password", {
        desc: "GitHub Password",
        conflicts: ["token"],
        implies: "username",
        type: "string"
    })
    .option("config", {
        desc: "Loads settings from a JSON file",
        type: "string",
        config: true,
        configParser: readSettings,
        default: getDefaultSettingsFile()
    })
    .option("save", {
        desc: "Saves settings to '%HOMEDIR%/.focus-dt/config.json' and exits.",
        type: "boolean",
        conflicts: ["save-to"]
    })
    .option("save-to", {
        desc: "Saves settings to the specified file and exits.",
        type: "string",
        conflicts: ["save"]
    })
    .option("needsReview", {
        desc: "Include items from the 'Needs Maintainer Review' column of 'New Pull Request Status Board'",
        type: "boolean",
    })
    .option("needsAction", {
        desc: "Include items from the 'Needs Maintainer Action' column of 'New Pull Request Status Board'",
        type: "boolean",
    })
    .option("oldest", {
        desc: "Sort so that the least recently updated cards come first",
        type: "boolean",
        conficts: ["newest"],
    })
    .option("newest", {
        desc: "Sort so that the most recently updated cards come first",
        type: "boolean",
        conficts: ["oldest"]
    })
    .option("draft", {
        desc: "Include 'Draft' PRs",
        type: "boolean",
    })
    .option("port", {
        desc: "The remote debugging port to use to wait for the chrome tab to exit.",
        type: "number",
    })
    .option("timeout", {
        desc: "The number of milliseconds to wait for the debugger to attach to the chrome process (default: 10,000).",
        type: "number",
    })
    .option("merge", {
        desc: "Set the default merge option to one of 'merge', 'squash', or 'rebase'.",
        type: "string",
        choices: ["merge", "squash", "rebase", undefined],
    })
    .option("approve", {
        desc: 
            "Sets the approval option to one of 'manual', 'auto', 'always', or 'only' (default 'manual').\n" +
            "  'manual' - Manually approve PRs in the CLI.\n" + 
            "  'auto' - Approve PRs when merging if they have no other approvers.\n" +
            "  'always' - Approve PRs when merging if you haven't already approved.\n" +
            "  'only' - Manually approve PRs in the CLI and advance to the next item (disables merging).",
        type: "string",
        choices: ["manual", "auto", "always", "only"],
    })
    .option("verbose", {
        desc: "Increases the log level",
        type: "count",
        alias: ["v"]
    })
    .help()
    .alias(["h", "?"], "help");

export const argv = options.argv;