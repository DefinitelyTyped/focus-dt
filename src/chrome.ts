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

import { regQuery, HKLM } from "./registry.js";
import { spawn, ChildProcess } from "child_process";
import { chromeConnection } from "vscode-chrome-debug-core";
import { existsSync } from "fs";
import { EventEmitter } from "events";
import { URL } from "url";

const defaultChromePaths: Partial<Record<NodeJS.Platform, string[]>> = {
    win32: ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome"],
};

const indexUrl = new URL("../assets/index.html", import.meta.url).toString();

export async function getChromePath() {
    let chromePath: string | undefined;
    if (process.platform === "win32") {
        chromePath =
            await regQuery(HKLM, "SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command") ||
            await regQuery(HKLM, "SOFTWARE\\Wow6432Node\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command");
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
    private _path: string | undefined;
    private _userDataDir: string | undefined;
    private _userProfile: string | undefined;
    private _port: number;
    private _timeout: number;
    private _opening = false;
    private _proc: ChildProcess | undefined;
    private _connection!: chromeConnection.ChromeConnection;

    constructor(port: number | "random", timeout: number, path?: string, userDataDir?: string, userProfile?: string) {
        super();
        this._port = port === "random" ? getRandomPort() : port;
        this._timeout = timeout;
        this._path = path;
        this._userDataDir = userDataDir;
        this._userProfile = userProfile;
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

            const chromePath = this._path ?? (this._path = await getChromePath());
            const chromeArgs = [
                '--no-first-run',
                '--no-default-browser-check',
                '--enable-automation',
                `--remote-debugging-port=${this._port}`,
                url,
            ];
            if (this._userDataDir) {
                chromeArgs.push(`--user-data-dir=${this._userDataDir}`);
            }
            if (this._userProfile) {
                chromeArgs.push(`--profile-directory=${this._userProfile}`);
            }
            const proc = spawn(chromePath, chromeArgs, { detached: true });
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

function getRandomPort() {
    return 9000 + Math.floor(Math.random() * 999);
}
