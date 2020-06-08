import { regQuery } from "./registry";
import { spawn, ChildProcess } from "child_process";
import { chromeConnection } from "vscode-chrome-debug-core";
import { existsSync } from "fs";
import Registry = require("winreg");
import { EventEmitter } from "events";

const defaultChromePaths: Partial<Record<NodeJS.Platform, string[]>> = {
    win32: ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:\Program Files (x86)\Microsoft\Edge Beta\Application\msedge.exe"],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/mnt/c/Program Files (x86)/Microsoft/Edge Beta/Application/msedge.exe"],
};

const indexUrl = `file:///${require.resolve("../assets/index.html").replace(/\\/g, "/").replace(/^\//, "")}`;

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

export class Chrome extends EventEmitter {
    private _port: number;
    private _timeout: number;
    private _opening = false;
    private _proc: ChildProcess | undefined;
    private _connection!: chromeConnection.ChromeConnection;

    constructor(port: number, timeout: number) {
        super();
        this._port = port;
        this._timeout = timeout;
    }

    get isOpen() {
        return !this._opening && !!this._connection && this._connection.isAttached;
    }

    async navigateTo(url: string) {
        if (!this.isOpen) {
            await this.open(url);
        }
        else {
            await this._connection.api.Page.navigate({
                url,
                transitionType: "typed"
            });
        }
    }

    async reset() {
        await this.navigateTo(indexUrl);
    }

    async open(url = indexUrl) {
        if (this.isOpen) return;
        try {
            this._opening = true;
            this._proc = undefined;
            this._connection = undefined!;

            const chromePath = await getChromePath();
            const proc = spawn(chromePath, [
                '--no-first-run',
                '--no-default-browser-check',
                '--enable-automation',
                `--remote-debugging-port=${this._port}`,
                url,
            ], { detached: true });
            proc.unref();

            const connection = new chromeConnection.ChromeConnection(undefined, undefined);
            await connection.attach("127.0.0.1", this._port, url, this._timeout);
            await connection.run();

            this._proc = proc;
            this._connection = connection;
            this._connection.onClose(() => this.emit("closed"));
        }
        finally {
            this._opening = false;
        }
    }

    async close() {
        if (!this.isOpen) return;
        const closePromise = new Promise<"close">(resolve => this._connection.onClose(() => resolve("close")));
        const timeoutPromise = new Promise<"timeout">(resolve => setTimeout(resolve, 1000, "timeout"));
        try { await this._connection.api.Browser.close(); } catch {}
        const result = await Promise.race([closePromise, timeoutPromise]);
        if (result === "timeout") {
            try { this._connection.close(); } catch { }
            try { this._proc?.kill(); } catch { }
        }
        this._connection = undefined!;
        this._proc = undefined;
    }
}
