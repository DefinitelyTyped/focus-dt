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

export const options = yargs
    .option("token", {
        desc: "GitHub Auth Token",
        conflicts: ["username", "password"],
        type: "string"
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
    .option("review", {
        desc: "Include items from the 'Review' column of 'Pull Request Status Board'",
        type: "boolean",
    })
    .option("checkAndMerge", {
        desc: "Include items from the 'Check and Merge' column of 'Pull Request Status Board'",
        type: "boolean",
    })
    .option("oldest", {
        desc: "Sort so that the least recently updated cards come first",
        type: "boolean",
        conficts: ["newest"]
    })
    .option("newest", {
        desc: "Sort so that the most recently updated cards come first",
        type: "boolean",
        conficts: ["oldest"]
    })
    .option("port", {
        desc: "The remote debugging port to use to wait for the chrome tab to exit.",
        type: "number"
    })
    .option("verbose", {
        desc: "Increases the log level",
        type: "count",
        alias: ["v"]
    })
    .help();

export const argv = options.argv;