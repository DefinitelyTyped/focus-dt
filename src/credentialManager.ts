import { spawnSync } from "child_process";

export interface GitCredentialRequest {
    protocol: string;
    host: string;
    path?: string;
    username?: string;
    password?: string;
}

export interface GitCredential {
    protocol: string;
    host: string;
    path?: string;
    username: string;
    password: string;
}

export interface GitUrlCredentialRequest {
    url: string;
    username?: string;
    password?: string;
}

export interface GitUrlCredential {
    url: string;
    username: string;
    password: string;
}

export function stringifyGitCredential(credential: GitCredentialRequest | GitUrlCredentialRequest | GitCredential | GitUrlCredential) {
    let s = "";
    for (const [key, value] of Object.entries(credential)) {
        if (value !== undefined) {
            if (/[\0\r\n=]/.test(key)) throw new TypeError(`'key' cannot contain NUL, newline, or '=' characters`);
            if (/[\0\r\n]/.test(value)) throw new TypeError(`'value' cannot contain NUL or newline characters`);
            s += `${key}=${value}\n`;
        }
    }
    s += "\n";
    return s;
}

export function parseGitCredentialRequest(text: string) {
    const credential: Partial<GitCredentialRequest & GitUrlCredentialRequest> = { };
    for (const [key, value] of Array.from(text.matchAll(/^([^=]+)=(.*)$/gm), m => [m[1], m[2]])) {
        if (key in credential) throw new TypeError("Duplicate key");
        switch (key) {
            case "url":
            case "protocol":
            case "host":
            case "path":
            case "username":
            case "password":
                break;
            default:
                throw new TypeError(`Invalid key '${key}'.`);
        }
        credential[key] = value;
    }
    if (credential.url !== undefined) {
        if (credential.protocol !== undefined) throw new TypeError("'url' cannot be combined with 'protocol'");
        if (credential.host !== undefined) throw new TypeError("'url' cannot be combined with 'host'");
        if (credential.path !== undefined) throw new TypeError("'url' cannot be combined with 'path'");
        return credential as GitUrlCredentialRequest;
    }
    if (credential.protocol === undefined) throw new TypeError("GitCredential missing 'url' or 'protocol'");
    if (credential.host === undefined) throw new TypeError("GitCredential missing 'host'");
    return credential as GitCredentialRequest;
}

export function parseGitCredential(text: string): GitCredential | GitUrlCredential {
    const credential = parseGitCredentialRequest(text);
    if (credential.username === undefined) throw new TypeError("GitCredential missing 'username'")
    if (credential.password === undefined) throw new TypeError("GitCredential missing 'password'")
    return credential as GitCredential | GitUrlCredential;
}

export function fillGitCredential(credential: GitCredentialRequest | GitUrlCredentialRequest) {
    const { stdout, status } = spawnSync("git", ["credential", "fill"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "inherit"],
        input: stringifyGitCredential(credential),
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return status ? undefined : parseGitCredential(stdout);
}

export function approveGitCredential(credential: GitCredential | GitUrlCredential) {
    const { status } = spawnSync("git", ["credential", "approve"], {
        encoding: "utf8",
        stdio: ["pipe", "inherit", "inherit"],
        input: stringifyGitCredential(credential),
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return !status;
}

export function rejectGitCredential(credential: GitCredential | GitUrlCredential) {
    const { status } = spawnSync("git", ["credential", "reject"], {
        encoding: "utf8",
        stdio: ["pipe", "inherit", "inherit"],
        input: stringifyGitCredential(credential),
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return !status;
}

export interface AuthStatus {
    authenticated?: boolean;
    active?: boolean;
    protocol?: string;
    scopes?: readonly string[];
}

export function ghAuthStatus() {
    try {
        const { stdout, status } = spawnSync("gh", ["auth", "status", "--hostname", "github.com"], {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "inherit"],
            shell: true,
            windowsVerbatimArguments: true,
            windowsHide: true
        });
        if (status === 0) {
            const authStatus: AuthStatus = {};
            for (const [key, value] of Array.from(stdout.matchAll(/^\s* (?:- (Active account|Git operations protocol|Token(?: scopes)?):\s*(.*)|(✓ Logged in to .*))$/gm), m => m[3] ? ["authenticated", "true"] :
                [({
                    "Active account": "active",
                    "Git operations protocol": "protocol",
                    "Token": "token",
                    "Token scopes": "scopes"
                } as Record<string, string>)[m[1]], m[2]])) {
                if (key in authStatus) throw new TypeError("Duplicate key");
                switch (key) {
                    case "authenticated":
                        authStatus.authenticated = true;
                        break;
                    case "active":
                        authStatus.active = value === "true";
                        break;
                    case "protocol":
                        authStatus.protocol = value;
                        break;
                    case "scopes":
                        authStatus.scopes = JSON.parse(`[${value.replaceAll(`'`, `"`)}]`);
                        break;
                    case "token":
                        break;
                    default:
                        throw new TypeError(`Invalid key '${key}'.`);
                }
            }
            return authStatus;
        }
    }
    catch {
        return undefined;
    }
}

export function ghAuthRefresh() {
    const { status } = spawnSync("gh", ["auth", "refresh", "--hostname", "github.com", "--scopes", "project"], {
        stdio: "inherit",
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return status === 0;
}

export function ghAuthLogin() {
    const { status } = spawnSync("gh", ["auth", "login", "--hostname", "github.com", "--scopes", "project", "--web"], {
        stdio: "inherit",
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return status === 0;
}

export function ghAuthToken() {
    const { stdout, status } = spawnSync("gh", ["auth", "token"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "inherit"],
        shell: true,
        windowsVerbatimArguments: true,
        windowsHide: true
    });
    return status ? undefined : stdout;
}
