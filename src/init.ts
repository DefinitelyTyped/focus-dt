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

import { AuthStatus, ghAuthLogin, ghAuthRefresh, ghAuthStatus, ghAuthToken, ghInstalled } from "./auth.js";
import { getChromePath } from "./chrome.js";
import { argv } from "./options.js";
import { getDefaultSettings, getDefaultSettingsFile, saveSettings, Settings } from "./settings.js";

export async function init() {
    const defaults = getDefaultSettings();
    let {
        token,
        save,
        "save-to": saveTo,
        needsReview = defaults.needsReview,
        needsAction = defaults.needsAction,
        draft = defaults.draft,
        wip = defaults.wip,
        skipped = defaults.skipped,
        oldest = defaults.oldest,
        approve = defaults.approve,
        merge = defaults.merge,
        port = defaults.port,
        timeout = defaults.timeout,
        username = defaults.username,
        chromePath,
        chromeProfile,
        chromeUserDataDir
    } = argv;

    if (typeof port === "number" && port <= 0) port = "random";

    if (!needsReview && !needsAction) {
        needsReview = true;
        needsAction = true;
    }

    if (!token) {
        token = process.env.GITHUB_API_TOKEN ?? process.env.FOCUS_DT_GITHUB_API_TOKEN ?? process.env.AUTH_TOKEN;
    }

    const userSuppliedToken = !!token;

    token ??= ghAuthToken();
    let status = await ghAuthStatus(token);
    if (!status.authenticated) {
        checkGhInstalled();
        token = ghAuthLogin();
        status = await ghAuthStatus(token);
        checkAuthenticated(status);
    }
    if (userSuppliedToken) {
        checkRequiredScopes(status);
    }
    else if (!hasRequiredScopes(status)) {
        checkGhInstalled();
        token = ghAuthRefresh();
        status = await ghAuthStatus(token);
        checkAuthenticated(status);
        checkRequiredScopes(status);
    }

    if (!token) {
        failNotAuthenticated();
    }

    const defaultMerge: "merge" | "squash" | "rebase" | undefined =
        merge === "merge" || merge === "squash" || merge === "rebase" ? merge : undefined;

    const approvalMode =
        approve === "manual" ||
        approve === "auto" ||
        approve === "always" ? approve :
        "manual";

    const settings: Settings = {
        needsAction,
        needsReview,
        oldest,
        draft,
        wip,
        skipped,
        port,
        timeout,
        merge: defaultMerge,
        approve: approvalMode,
        chromePath: chromePath ?? await getChromePath(),
        chromeProfile,
        chromeUserDataDir,
        username
    };

    if (save || saveTo) {
        saveSettings(settings, saveTo);
        console.log(`Settings saved to '${saveTo ?? getDefaultSettingsFile()}'.`);
        process.exit(0);
    }

    return { token, settings };
}

function failGhNotInstalled(): never {
    console.error("Auth token not supplied. To authenticate via the command line, please ensure you have the GitHub CLI ('gh') installed.");
    process.exit(-1);
}

function failNotAuthenticated(): never {
    console.error("Not authenticated. Please supply an authentication token or login manually via 'gh auth login'");
    process.exit(-1);
}

function failMissingRequiredScopes(): never {
    console.error("Your authentication token is not authorized for the requisite scope 'read:project'. Please replace the token and try again.");
    process.exit(-1);
}

function checkGhInstalled() {
    if (!ghInstalled()) {
        failGhNotInstalled();
    }
}

function checkAuthenticated(status: AuthStatus) {
    if (!status.authenticated) {
        failNotAuthenticated();
    }
}

function hasRequiredScopes(status: AuthStatus) {
    return !!status.scopes?.includes("read:project") || !!status.scopes?.includes("project");
}

function checkRequiredScopes(status: AuthStatus) {
    if (!hasRequiredScopes(status)) {
        failMissingRequiredScopes();
    }
}
