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

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type MergeMode =
    | "merge"   // Perform a merge commit
    | "squash"  // Squash all commits into a single commit
    | "rebase"  // Rebase and merge
    ;

export type ApprovalMode =
    | "manual"  // Require manual approval
    | "auto"    // Approve before merging only if there are no other approvers for the most recent change
    | "always"  // Approve before merging only if you haven't already approved the most recent change
    ;

export interface Settings {
    needsReview: boolean;
    needsAction: boolean;
    oldest: boolean;
    draft: boolean;
    wip: boolean;
    skipped: boolean;
    port: number | "random";
    timeout: number;
    merge: MergeMode | undefined;
    approve: ApprovalMode;
    chromePath: string | undefined;
    chromeProfile: string | undefined;
    chromeUserDataDir: string | undefined;
    username: string | undefined;
}

export function getDefaultSettingsFile() {
    const homedir = os.homedir();
    const settingsDir = path.join(homedir, ".focus-dt");
    return path.join(settingsDir, "config.json");
}

export function saveSettings(settings: Settings, file = getDefaultSettingsFile()) {
    if (path.extname(file) !== ".json") throw new Error(`Configuration file must have a .json extension: '${file}'`);
    const json = { ...settings } as Partial<Settings>;
    if (json.needsAction && json.needsReview) {
        json.needsAction = undefined;
        json.needsReview = undefined;
    }
    if (json.draft === false) json.draft = undefined;
    if (json.wip === false) json.wip = undefined;
    if (json.skipped === false) json.skipped = undefined;
    if (json.oldest === false) json.oldest = undefined;
    if (json.approve === "manual") json.approve = undefined;
    if (json.port === 9222) json.port = undefined;
    if (json.timeout === 10000) json.timeout = undefined;
    if (json.chromePath === "") json.chromePath = undefined;
    if (json.chromeProfile === "") json.chromeProfile = undefined;
    if (json.chromeUserDataDir === "") json.chromeUserDataDir = undefined;
    const settingsDir = path.dirname(file);
    try { fs.mkdirSync(settingsDir, { recursive: true }); } catch { }
    fs.writeFileSync(file, JSON.stringify(json, undefined, "  "), "utf8");
}

export function readSettings(file = getDefaultSettingsFile()) {
    try {
        const text = fs.readFileSync(file, "utf8");
        const settings = { ...getDefaultSettings(), ...JSON.parse(text) } as Settings;
        if ((settings.approve as string) === "only") settings.approve = "manual";
        return settings;
    }
    catch {
        return getDefaultSettings();
    }
}

export function getDefaultSettings(): Settings {
    return {
        needsReview: false,
        needsAction: false,
        draft: false,
        wip: false,
        skipped: false,
        oldest: false,
        approve: "manual",
        merge: undefined,
        port: 9222,
        timeout: 10000,
        chromePath: undefined,
        chromeProfile: undefined,
        chromeUserDataDir: undefined,
        username: undefined
    };
}

export function getDefaultSkippedFile() {
    const homedir = os.homedir();
    const settingsDir = path.join(homedir, ".focus-dt");
    return path.join(settingsDir, "skipped.json");
}

export interface SkippedFiles {
    version: 2,
    skipped: [number, number][];
}

export function readSkipped(file = getDefaultSkippedFile()) {
    try {
        const text = fs.readFileSync(file, "utf8");
        let object = JSON.parse(text) as number[] | SkippedFiles;
        if (Array.isArray(object)) {
            if (!object.every(x => typeof x === "number")) {
                return undefined;
            }
            object = { version: 2, skipped: object.map(pull_number => [pull_number, Date.now()]) };
            saveSkipped(object, file);
        }
        if (typeof object === "object" && object.version === 2) {
            return object;
        }
    }
    catch {
        // do nothing
    }
    return undefined;
}

export function saveSkipped(skipped: Map<number, number> | SkippedFiles | undefined, file = getDefaultSkippedFile()) {
    if (path.extname(file) !== ".json") throw new Error(`Skipped PR file must have a .json extension: '${file}'`);
    if (skipped instanceof Map) {
        if (skipped.size === 0) {
            skipped = undefined;
        }
        else {
            skipped = { version: 2, skipped: [...skipped] };
        }
    }
    if (!skipped?.skipped.length) {
        try {
            fs.unlinkSync(file);
        }
        catch {
            // do nothing
        }
    }
    else {
        const settingsDir = path.dirname(file);
        try { fs.mkdirSync(settingsDir, { recursive: true }); } catch { }
        fs.writeFileSync(file, JSON.stringify(skipped, undefined, "  "), "utf8");
    }
}
