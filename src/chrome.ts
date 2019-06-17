import { regQuery } from "./registry";
import { spawn } from "child_process";
import { chromeConnection } from "vscode-chrome-debug-core";
import { existsSync } from "fs";
import Registry = require("winreg");

const defaultChromePaths: Partial<Record<NodeJS.Platform, string[]>> = {
    win32: ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome"],
};

export async function getChromePath() {
    let chromePath: string | undefined;
    if (process.platform === "win32") {
        chromePath =
            await regQuery(Registry.HKLM, "SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command") ||
            await regQuery(Registry.HKLM, "SOFTWARE\\Wow6432Node\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command");
    }
    if (!chromePath) {
        const chromePaths = defaultChromePaths[process.platform] || defaultChromePaths.linux;
        if (chromePaths) {
            for (const candidate of chromePaths) {
                if (existsSync(candidate)) {
                    chromePath = candidate;
                    break;
                }
            }
        }
    }
    if (chromePath && /^".*"$/.test(chromePath)) {
        chromePath = chromePath.slice(1, -1);
    }
    if (!chromePath) {
        throw new Error("Could not find chrome.");
    }
    return chromePath;
}

export async function spawnChromeAndWait(chromePath: string, url: string, port: number, verbose: boolean) {
    if (verbose) {
        console.log(`Launching chrome with debugger on port ${port}...`);
    }

    const proc = spawn(chromePath, [
        '--no-first-run',
        '--no-default-browser-check',
        `--remote-debugging-port=${port}`,
        url,
    ], { detached: true });
    proc.unref();

    if (verbose) {
        console.log(`Attaching debugger on port ${port}...`);
    }

    const connection = new chromeConnection.ChromeConnection(undefined, undefined);
    await connection.attach("localhost", port, url, 10000);
    await connection.run();
    await new Promise(resolve => connection.onClose(resolve));

    if (verbose) {
        console.log(`Chrome debugger was detached`);
    }
}