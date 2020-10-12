import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Settings {
    needsReview: boolean;
    needsAction: boolean;
    oldest: boolean;
    draft: boolean;
    wip: boolean;
    skipped: boolean;
    port: number | "random";
    timeout: number;
    merge: "merge" | "squash" | "rebase" | undefined;
    approve: "manual" | "auto" | "always" | "only";
    chromePath: string | undefined;
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
    const settingsDir = path.dirname(file);
    try { fs.mkdirSync(settingsDir, { recursive: true }); } catch { }
    fs.writeFileSync(file, JSON.stringify(json, undefined, "  "), "utf8");
}

export function readSettings(file = getDefaultSettingsFile()) {
    try {
        const text = fs.readFileSync(file, "utf8");
        return { ...getDefaultSettings(), ...JSON.parse(text) } as Settings;
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
        chromePath: undefined
    };
}

export function getDefaultSkippedFile() {
    const homedir = os.homedir();
    const settingsDir = path.join(homedir, ".focus-dt");
    return path.join(settingsDir, "skipped.json");
}

export function saveSkipped(skipped: Set<number> | number[] | undefined, file = getDefaultSkippedFile()) {
    if (path.extname(file) !== ".json") throw new Error(`Skipped PR file must have a .json extension: '${file}'`);
    if (skipped && !Array.isArray(skipped)) skipped = [...skipped];
    if (!skipped?.length) {
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

export function readSkipped(file = getDefaultSkippedFile()) {
    try {
        const text = fs.readFileSync(file, "utf8");
        const array = JSON.parse(text) as number[];
        if (Array.isArray(array) && array.every(x => typeof x === "number")) return array;
    }
    catch {
        // do nothing
    }
}