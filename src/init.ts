import { argv } from "./options";
import { getDefaultSettings, getDefaultSettingsFile, saveSettings, Settings } from "./settings";
import { getChromePath } from "./chrome";
import { fillGitCredential, GitCredential, GitUrlCredential } from "./credentialManager";

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

    if (port <= 0) port = "random";

    if (!needsReview && !needsAction) {
        needsReview = true;
        needsAction = true;
    }

    if (!token) {
        token = process.env.GITHUB_API_TOKEN ?? process.env.FOCUS_DT_GITHUB_API_TOKEN ?? process.env.AUTH_TOKEN;
    }

    let credential: GitCredential | GitUrlCredential | undefined;
    if (!token) {
        credential = fillGitCredential({
            protocol: "https",
            host: "github.com",
            path: "DefinitelyTyped/DefinitelyTyped.git",
            username
        });
        if (!credential) {
            process.exit(-1);
        }
        token = credential.password;
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

    return {
        token,
        credential,
        settings
    };
}