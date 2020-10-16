import prompts = require("prompts");
import { argv } from "./options";
import { spawn } from "child_process";
import { getDefaultSettings, getDefaultSettingsFile, saveSettings, Settings } from "./settings";
import { getChromePath } from "./chrome";

export async function init() {
    const defaults = getDefaultSettings();
    let {
        token,
        username,
        password,
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
        chromePath,
        useCredentialManager
    } = argv;

    if (port <= 0) port = "random";

    if (!needsReview && !needsAction) {
        needsReview = true;
        needsAction = true;
    }

    if (!token) {
        token = process.env.GITHUB_API_TOKEN ?? process.env.FOCUS_DT_GITHUB_API_TOKEN ?? process.env.AUTH_TOKEN
    }

    if (!token && (!username || !password)) {
        if (useCredentialManager) {
            const entries = new Map<string, string>();
            await new Promise<void>((resolve) => {
                // 'git credential fill' takes arguments via stdin using `<key>=<value>\n`, and outputs results in the same format.
                // see https://git-scm.com/docs/git-credential#IOFMT
                const proc = spawn("git", ["credential", "fill"], { stdio: "pipe" });
                proc.stdout
                    .setEncoding("utf8")
                    .on("data", (data: string) => {
                        const lines = data.split(/\r?\n/g);
                        for (const line of lines) {
                            const match = /^([^=]+)=(.*)$/.exec(line);
                            if (!match) continue;
                            entries.set(match[1], match[2]);
                        }
                    });
                proc.stderr
                    .setEncoding("utf8")
                    .on("data", (data: string) => {
                        console.log(data);
                    });
                proc
                    .on("error", () => resolve())
                    .on("close", () => resolve());
                // write inputs
                proc.stdin.write("protocol=https\n");
                proc.stdin.write("host=github.com\n");
                proc.stdin.write("path=DefinitelyTyped/DefinitelyTyped.git\n");
                if (username) proc.stdin.write(`username=${username}\n`);
                if (password) proc.stdin.write(`password=${password}\n`);
                proc.stdin.write("\n");
            });
            username = entries.get("username");
            password = entries.get("password");
            if (username === "PersonalAccessToken") {
                token = password;
                username = undefined;
                password = undefined;
            }
            if (!token && (!username || !password)) {
                process.exit(-1);
            }
        }
        else {
            ({ token, username, password } = await prompts([
                {
                    type: "select",
                    name: "choice",
                    message: "GitHub Authentication",
                    choices: [
                        { title: "token", value: "token" },
                        { title: "username", value: "username" },
                    ],
                },
                {
                    type: (_, answers) => answers.choice === "token" ? "text" : null,
                    name: "token",
                    message: "token"
                },
                {
                    type: (_, answers) => answers.choice === "username" ? "text" : null,
                    name: "username",
                    message: "username"
                },
                {
                    type: (_, answers) => answers.choice === "username" ? "text" : null,
                    name: "password",
                    message: "password"
                },
            ], { onCancel() { process.exit(1); } }));
        }
    }

    const defaultMerge: "merge" | "squash" | "rebase" | undefined =
        merge === "merge" || merge === "squash" || merge === "rebase" ? merge : undefined;

    const approvalMode: "manual" | "auto" | "always" | "only" =
        approve === "manual" || approve === "auto" || approve === "always" || approve === "only" ? approve : "manual";

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
        chromePath: chromePath ?? await getChromePath()
    };

    if (save || saveTo) {
        saveSettings(settings, saveTo);
        console.log(`Settings saved to '${saveTo ?? getDefaultSettingsFile()}'.`);
        process.exit(0);
    }

    return {
        token,
        username,
        password,
        settings
    };
}