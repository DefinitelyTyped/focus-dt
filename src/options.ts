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
import { getDefaultSettingsFile, readSettings } from "./settings.js";

export const options = yargs
    .usage("$0 [options]")
    // authentication
    .option("username", {
        desc: "GitHub Username",
        group: "Authentication options:",
        type: "string",
    })
    .option("token", {
        desc: "GitHub Auth Token. Uses %GITHUB_API_TOKEN%, %FOCUS_DT_GITHUB_API_TOKEN%, or %AUTH_TOKEN% (in that order) if available",
        group: "Authentication options:",
        type: "string",
    })
    // configuration
    .option("config", {
        desc: "Loads settings from a JSON file",
        group: "Configuration options:",
        type: "string",
        config: true,
        configParser: readSettings,
        default: getDefaultSettingsFile()
    })
    .option("save", {
        desc: "Saves settings to '%HOMEDIR%/.focus-dt/config.json' and exits",
        group: "Configuration options:",
        type: "boolean",
        conflicts: ["save-to"]
    })
    .option("save-to", {
        desc: "Saves settings to the specified file and exits",
        group: "Configuration options:",
        type: "string",
        conflicts: ["save"]
    })
    // settings
    .option("skipped", {
        desc: "Include previously skipped items",
        type: "boolean"
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
    .option("wip", {
        desc: "Include work-in-progress (WIP) PRs",
        type: "boolean"
    })
    .option("merge", {
        desc: "Set the default merge option to one of 'merge', 'squash', or 'rebase'",
        type: "string",
        choices: ["merge", "squash", "rebase", undefined],
    })
    .option("approve", {
        desc:
            "Sets the approval option to one of 'manual', 'auto', 'always', or 'only' (default 'manual'):\n" +
            "- 'manual' - Manually approve PRs in the CLI\n" +
            "- 'auto' - Approve PRs when merging if they have no other approvers\n" +
            "- 'always' - Approve PRs when merging if you haven't already approved\n" +
            "- 'only' - [DEPRECATED] Manually approve PRs in the CLI and advance to the next item (disables merging)",
        type: "string",
        choices: ["manual", "auto", "always", "only"],
    })
    // chrome
    .option("chromePath", {
        desc: "The path to the chromium-based browser executable to use (defaults to detecting the current system path for chrome)",
        group: "Browser options:",
        type: "string"
    })
    .option("chromeUserDataDir", {
        desc: "The path to your chrome user data directory.",
        group: "Browser options:",
        type: "string"
    })
    .option("chromeProfile", {
        desc: "The name of the chrome profile you want to use.",
        group: "Browser options:",
        type: "string"
    })
    .option("port", {
        desc: "The remote debugging port to use to wait for the chrome tab to exit",
        group: "Browser options:",
        type: "number",
    })
    .option("timeout", {
        desc: "The number of milliseconds to wait for the debugger to attach to the chrome process (default: 10,000)",
        group: "Browser options:",
        type: "number",
    })
    // other
    .option("verbose", {
        desc: "Increases the log level",
        type: "count",
        alias: ["v"]
    })
    .option("help", {
        type: "boolean",
        desc: "Show help",
        alias: ["h"],
    })
    ;

export const argv = options.argv;