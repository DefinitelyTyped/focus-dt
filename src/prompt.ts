import * as readline from "readline";
import chalk from "chalk";

let currentPrompt: PromptState | undefined;
const promptStack: PromptState[] = [];
const newLineRegExp = /\r\n?|\n/g;

export interface Prompt {
    header?: string | (() => string);
    title: string | (() => string);
    options: Option[];
    onCancel?: () => void;
}

export type PromptKey = string | readline.Key | readonly (string | readline.Key)[];

export interface Option {
    readonly key: PromptKey;
    readonly description: string | (() => string);
    readonly advanced?: boolean;
    readonly disabled?: boolean | (() => boolean);
    action: (key: readline.Key) => void | PromiseLike<void>;
}

interface PromptState extends Prompt {
    source: Prompt;
    promise: Promise<void>;
    resolve: () => void;
    header?: string;
    title: string;
    options: OptionState[];
    visible?: boolean;
    keypressBlocked?: boolean;
    hasAdvancedOption?: boolean;
    showAdvanced?: boolean;
    formattedBasic?: string;
    formattedBasicLines?: number;
    formattedAdvanced?: string;
    formattedAdvancedLines?: number;
}

interface OptionState extends Option {
    readonly description: string;
    readonly disabled?: boolean;
    formatted?: string;
}

function hasAdvancedOption(prompt: PromptState) {
    if (prompt.hasAdvancedOption === undefined) {
        prompt.hasAdvancedOption = prompt.options.some(opt => opt.advanced && !opt.disabled);
    }
    return prompt.hasAdvancedOption;
}

const ctrlRegExp = /\bctrl[-+]/ig;
const shiftRegExp = /\bshift[-+]/ig;
const metaRegExp = /\b(alt|meta)[-+]/ig;
const parseKeyCache = new Map<string, readline.Key>();

function parseKey(text: string) {
    text = text.toLowerCase();
    let key = parseKeyCache.get(text);
    if (!key) {
        const withoutCtrl = text.replace(ctrlRegExp, "");
        const withoutShift = withoutCtrl.replace(shiftRegExp, "");
        const withoutMeta = withoutShift.replace(metaRegExp, "");
        const name = withoutMeta;
        key = {
            ctrl: withoutCtrl !== text,
            shift: withoutShift !== withoutCtrl,
            meta: withoutMeta !== withoutShift,
            name: name === "esc" ? "escape" : name
        };
        parseKeyCache.set(text, key);
    }
    return key;
}

const formatKeyCache = new Map<string, string>();

function formatKey(option: Option) {
    let key = isArray(option.key) ? option.key[0] : option.key;
    if (typeof key === "string") key = parseKey(key);

    const cacheKey = `${key.ctrl ? 1 : 0},${key.meta ? 1 : 0},${key.shift ? 1 : 0},${key.name ? key.name.toLowerCase() : ""}`;
    let text = formatKeyCache.get(cacheKey);
    if (text === undefined) {
        text = "";
        if (key.ctrl) text += "ctrl+";
        if (key.meta) text += (process.platform === "win32" ? "alt+" : "meta+");
        if (key.shift) text += "shift+";
        switch (key.name) {
            case undefined: break;
            case "escape": text += "esc"; break;
            default:
                text += key.name;
                break;
        }
        formatKeyCache.set(cacheKey, text);
    }
    return text;
}

function formatOption(option: OptionState) {
    if (!option.formatted) {
        option.formatted = ` > Press ${chalk.yellow(formatKey(option))} to ${option.description.replace(/\.$/, "")}.\n`;
    }
    return option.formatted;
}

const quitOption: OptionState = {
    key: [parseKey("q"), parseKey("ctrl+c"), parseKey("ctrl+d")],
    description: "quit",
    action: quit
};

function formatPrompt(prompt: PromptState) {
    const key = prompt.showAdvanced ? "formattedAdvanced" : "formattedBasic";
    let text = prompt[key];
    if (text === undefined) {
        text = "";
        if (prompt.header) {
            text += `${prompt.header}\n\n`;
        }
        text += chalk.bold(`${prompt.title}:\n`);
        for (const option of prompt.options) {
            if (option.disabled) continue;
            if (!option.advanced || prompt.showAdvanced) {
                text += formatOption(option);
            }
        }
        text += formatOption(quitOption);
        prompt[key] = text;
    }
    return text;
}

function countLines(prompt: PromptState) {
    const key = prompt.showAdvanced ? "formattedAdvancedLines" : "formattedBasicLines";
    let count = prompt[key];
    if (count === undefined) {
        const text = formatPrompt(prompt);
        let match: RegExpExecArray | null;
        count = 1;
        newLineRegExp.lastIndex = -1;
        while (match = newLineRegExp.exec(text)) {
            count++;
        }
        prompt[key] = count;
    }
    return count;
}

function isArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function matchKey(actual: PromptKey, expected: PromptKey): boolean {
    if (isArray(actual)) return actual.some(actual => matchKey(actual, expected));
    if (isArray(expected)) return expected.some(expected => matchKey(actual, expected));
    if (typeof actual === "string") actual = parseKey(actual);
    if (typeof expected === "string") expected = parseKey(expected);
    return (expected.name === "enter" ? "return" : expected.name) === (actual.name === "enter" ? "return" : actual.name)
        && !!expected.shift === !!actual.shift
        && !!expected.ctrl === !!actual.ctrl
        && (!!expected.meta === !!actual.meta || expected.name === "escape");
}

const onQuitCallbacks: (() => void | Promise<void>)[] = [];

export function addOnQuit(callback: () => void | Promise<void>) {
    onQuitCallbacks.push(callback);
}

let quitPromise: Promise<void> | undefined;

export function quit() {
    if (quitPromise) return quitPromise;
    return quitPromise = (async () => {
        hidePrompt();
        unregisterOnKeypress();
        while (currentPrompt) {
            currentPrompt.visible = false;
            currentPrompt.onCancel?.();
            currentPrompt = promptStack.pop();
        }
        let onQuit: (() => void | Promise<void>) | undefined;
        while (onQuit = onQuitCallbacks.shift()) {
            try {
                const result = onQuit();
                if (result) await result;
            }
            catch (e) {
                console.error(e);
            }
        }

        process.stdout.write("\n");
        process.exit(0);
    })();
}

function onKeypress(ch: string, key: readline.Key) {
    if (!key) key = parseKey(ch);
    if (matchKey(key, { name: "q" }) ||
        matchKey(key, { ctrl: true, name: "c" }) ||
        matchKey(key, { ctrl: true, name: "d" })) {
        quit();
        return;
    }
    if (!currentPrompt) return;

    const prompt = currentPrompt;
    if (!prompt.visible || prompt.keypressBlocked) return;
    prompt.keypressBlocked = true;

    if (hasAdvancedOption(prompt) && (matchKey(key, { name: "h" }) || matchKey(key, { name: "?" }))) {
        hidePrompt();
        prompt.showAdvanced = !prompt.showAdvanced;
        refreshPrompt();
        showPrompt();
        prompt.keypressBlocked = false;
        return;
    }

    for (const option of prompt.options) {
        if (!option.disabled && matchKey(key, option.key)) {
            const result = option.action(key);
            if (typeof result === "object") {
                result.then(() => { prompt.keypressBlocked = false; });
                return;
            }
            prompt.keypressBlocked = false;
            return;
        }
    }

    readline.moveCursor(process.stdout, 0, -1);
    readline.clearScreenDown(process.stdout);
    console.log(`key: ${key.name}, ctrl: ${key.ctrl}, meta: ${key.meta}, shift: ${key.shift}`);
    prompt.keypressBlocked = false;
}

let keypressRegistered = false;
let stdinWasPaused = false;

function registerOnKeypress() {
    if (!keypressRegistered) {
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(true);
        }
        stdinWasPaused = process.stdin.isPaused();
        if (stdinWasPaused) {
            process.stdin.resume();
        }
        process.stdin.setEncoding("utf8");
        readline.emitKeypressEvents(process.stdin, { escapeCodeTimeout: 50 } as any);
        process.stdin.on("keypress", onKeypress);
        keypressRegistered = true;
    }
}

function unregisterOnKeypress() {
    if (keypressRegistered) {
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
        }
        if (stdinWasPaused) {
            process.stdin.pause();
        }
        process.stdin.off("keypress", onKeypress);
        keypressRegistered = false;
    }
}

export function hasPrompt() {
    return currentPrompt !== undefined;
}

export function isPromptVisible() {
    return !!currentPrompt?.visible;
}

export function getCurrentPrompt() {
    return currentPrompt?.source;
}

export function showPrompt() {
    if (currentPrompt && !currentPrompt.visible) {
        process.stdout.write(formatPrompt(currentPrompt) + "\n");
        currentPrompt.visible = true;
        return true;
    }
    return false;
}

export function refreshPrompt() {
    if (currentPrompt) {
        const wasVisible = isPromptVisible();
        if (wasVisible) hidePrompt();
        updatePromptState(currentPrompt);
        if (wasVisible) showPrompt();
    }
}

export function hidePrompt() {
    if (currentPrompt?.visible) {
        readline.moveCursor(process.stdout, 0, -countLines(currentPrompt));
        readline.clearScreenDown(process.stdout);
        currentPrompt.visible = false;
        return true;
    }
    return false;
}

function evaluate<T extends undefined | string | boolean>(value: T | (() => T)): T {
    return typeof value === "function" ? value() : value;
}

function updatePromptState(promptState: PromptState) {
    const prompt = promptState.source;
    promptState.header = evaluate(prompt.header);
    promptState.title = evaluate(prompt.title);
    promptState.options = prompt.options.map(opt => ({
        ...opt,
        description: evaluate(opt.description),
        disabled: evaluate(opt.disabled),
    }));
    if (hasAdvancedOption(promptState)) {
        const advancedOption: OptionState = {
            key: [parseKey("h"), parseKey("?")],
            description: `${promptState.showAdvanced ? "hide" : "show"} advanced options`,
            action: () => {
                if (currentPrompt === promptState) {
                    hidePrompt();
                }
                promptState.showAdvanced = !promptState.showAdvanced;
                if (currentPrompt === promptState) {
                    refreshPrompt();
                    showPrompt();
                }
            }
        };
        promptState.options.unshift(advancedOption);
    }
    promptState.formattedBasic = undefined;
    promptState.formattedBasicLines = undefined;
    promptState.formattedAdvanced = undefined;
    promptState.formattedAdvancedLines = undefined;
}

function createPromptState(prompt: Prompt): PromptState {
    let resolve!: () => void;
    const promise = new Promise<void>(res => resolve = res);
    const promptState: PromptState = {
        source: prompt,
        ...prompt,
        promise,
        resolve,
        header: undefined,
        title: "",
        options: [],
        formattedBasic: undefined,
        formattedBasicLines: undefined,
        formattedAdvanced: undefined,
        formattedAdvancedLines: undefined
    };
    updatePromptState(promptState);
    return promptState;
}

export function pushPrompt(prompt: Prompt) {
    hidePrompt();
    if (currentPrompt !== undefined) {
        promptStack.push(currentPrompt);
    }
    else {
        pause();
        registerOnKeypress();
    }
    currentPrompt = createPromptState(prompt);
    showPrompt();
    return currentPrompt.promise;
}

export function popPrompt() {
    hidePrompt();
    currentPrompt?.resolve();
    currentPrompt = promptStack.pop();
    if (currentPrompt !== undefined) {
        showPrompt();
    }
    else {
        unpause();
        unregisterOnKeypress();
    }
}

let pauseCount = 0;
let pausePromise = Promise.resolve();
let pauseResolve = () => {};

export function pause() {
    if (pauseCount === 0) {
        pausePromise = new Promise(resolve => pauseResolve = resolve);
    }
    pauseCount++;
}

export function unpause() {
    if (pauseCount > 0) {
        pauseCount--;
        if (pauseCount === 0) {
            pauseResolve();
        }
    }
}

export function waitForPause() {
    return pausePromise;
}