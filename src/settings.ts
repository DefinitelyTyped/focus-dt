import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface Settings {
    needsReview: boolean;
    needsAction: boolean;
    oldest: boolean;
    draft: boolean;
    port: number | "random";
    timeout: number;
    merge: "merge" | "squash" | "rebase" | undefined;
    approve: "manual" | "auto" | "always" | "only";
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
    if (json.oldest === false) json.oldest = undefined;
    if (json.approve === "manual") json.approve = undefined;
    if (json.port === 9222) json.port = undefined;
    if (json.timeout === 10000) json.timeout = undefined;
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
        oldest: false,
        approve: "manual",
        merge: undefined,
        port: 9222,
        timeout: 10000
    };
}