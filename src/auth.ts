/*!
   Copyright 2024 Microsoft Corporation

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

import { spawnSync } from "node:child_process";

export interface AuthStatus {
    authenticated: boolean | undefined;
    scopes: readonly string[] | undefined;
}

export function ghInstalled() {
    const { status } = spawnSync("gh", ["--version"], {
        stdio: "ignore",
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return status === 0;
}

export async function ghAuthStatus(token: string | undefined): Promise<AuthStatus> {
    if (!token) {
        return { authenticated: false, scopes: undefined };
    }
    const response = await fetch("https://api.github.com", {
        method: "HEAD",
        headers: { "Authorization": `token ${token}` }
    });
    const scopes = response.headers.get("x-oauth-scopes")?.split(/, ?/g);
    return { authenticated: true, scopes };
}

export function ghAuthRefresh() {
    try {
        const { status } = spawnSync("gh", ["auth", "refresh", "--hostname", "github.com", "--scopes", "read:project"], {
            stdio: "inherit",
            shell: true,
            windowsVerbatimArguments: true,
            windowsHide: true
        });
        if (status === 0) {
            return ghAuthToken();
        }
    }
    catch {
        return undefined;
    }
}

export function ghAuthLogin() {
    try {
        const { status } = spawnSync("gh", ["auth", "login", "--hostname", "github.com", "--scopes", "read:project", "--web"], {
            stdio: "inherit",
            shell: true,
            windowsVerbatimArguments: true,
            windowsHide: true
        });
        if (status === 0) {
            return ghAuthToken();
        }
    }
    catch {
        return undefined;
    }
}

export function ghAuthToken() {
    try {
        const { stdout, status } = spawnSync("gh", ["auth", "token"], {
            encoding: "utf8",
            stdio: "pipe",
            shell: true,
            windowsVerbatimArguments: true,
            windowsHide: true
        });
        return status ? undefined : stdout;
    }
    catch {
        return undefined;
    }
}
