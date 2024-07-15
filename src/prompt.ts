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

import * as readline from "readline";
import chalk from "chalk";
import stripAnsi = require("strip-ansi");

let currentPrompt: EvaluatedPrompt<any, any> | undefined;
const promptStack: EvaluatedPrompt<any, any>[] = [];
const newLineRegExp = /\r\n?|\n/g;

export interface PromptContext<R, S> {
    readonly prompt: Prompt<R, S>;
    readonly state: Partial<S>;
    showAdvanced: boolean;
    result: R | undefined;

    hide(): Promise<boolean>;
    show(): Promise<boolean>;
    refresh(): Promise<void>;
    close(result?: R): Promise<void>;
}

export interface Prompt<R = unknown, S = {}> {
    /** A header message to display above the prompt title. */
    readonly header?: string | Evaluatable<string, R, S>;
    /** The title of the prompt. */
    readonly title: string | Evaluatable<string, R, S>;
    /** The options presented in the prompt */
    readonly options: readonly Option<R, S>[] | Evaluatable<readonly Option<R, S>[], R, S>;
    onEnter?: (context: PromptContext<R, S>) => void | PromiseLike<void>;
    onExit?: (context: PromptContext<R, S>) => void | PromiseLike<void>;
}

export type PromptKey = string | [string, ...string[]];

export interface Option<R, S> {
    /** The key associated with the option. If this is an array, the first entry is the default key and the remaining entries are alternate keys. */
    readonly key: PromptKey | Evaluatable<PromptKey, R, S>;
    /** The description for the option. Appears in the place of ${desc} in `> Press ${key} to ${desc}.` */
    readonly description: string | Evaluatable<string, R, S>;
    /** Indicates whether the option is an advanced option and is hidden by default. */
    readonly advanced?: boolean | Evaluatable<boolean, R, S>;
    /** Indicates whether the option is disabled and should not be handled. Disabled options are greyed out. */
    readonly disabled?: boolean | Evaluatable<boolean, R, S>;
    /** Indicates whether the option is hidden and should not be displayed. Hidden options can still be triggered. */
    readonly hidden?: boolean | Evaluatable<boolean, R, S>;
    /** Indicates whether the option is checked. */
    readonly checked?: boolean | undefined | Evaluatable<boolean | undefined, R, S>;
    readonly checkColor?: { color: chalk.ChalkFunction | undefined } | Evaluatable<{ color: chalk.ChalkFunction | undefined } | undefined, R, S>;
    readonly checkStyle?: "checkbox" | "radio" | undefined | Evaluatable<"checkbox" | "radio" | undefined, R, S>;
    /** The action to execute when the option is selected. */
    readonly action: (prompt: PromptContext<R, S>, key: Key) => void | PromiseLike<void>;
}

interface EvaluatedPrompt<R, S> {
    prompt: Prompt<R, S>;               // the original `Prompt` this was created from.
    context: PromptContext<R, S>;       // an object that exposes some prompt context to consumers.
    state: Partial<S>;
    header?: string;                    // the evaluated header of the prompt.
    title: string;                      // the evaluated title of the prompt.
    options: EvaluatedOption<R, S>[];   // the evaluated options of the prompt.
    result?: R;
    promise: Promise<void>;             // a promise that is resolved when the prompt is closed.
    resolve: () => void;                // a callback used to resolve the promise for the prompt.
    reject: (reason: any) => void;      // a callback used to reject the promise for the prompt.
    visible?: boolean;                  // indicates whether the prompt is currently visible.
    closed?: boolean;                   // indicates whether the prompt has been closed.
    keypressBlocked?: boolean;          // indicates whether keypress events are blocked.
    hasAdvancedOption?: boolean;        // indicates whether the prompt has any advanced options.
    hasCheckedOption?: boolean;         // indicates whether the prompt has any checked options.
    showAdvanced: boolean;              // indicates whether advanced options are currently shown.
    formattedBasic?: string;            // caches the formatted output for the prompt without advanced options.
    formattedBasicLines?: number;       // caches the number of lines rendered for the prompt without advanced options.
    formattedAdvanced?: string;         // caches the formatted output for the prompt with advanced options.
    formattedAdvancedLines?: number;    // caches the number of lines rendered for the prompt with advanced options.
}

interface EvaluatedOption<R, S> {
    option: Option<R, S>;                           // the original `Option` this was created from.
    key: Key | readonly [Key, ...Key[]];            // the evaluated key for the option.
    description: string;                            // the evaluated description for the option.
    advanced?: boolean;                             // the evaluated value indicating whether the option is an advanced option.
    disabled?: boolean;                             // the evaluated value indicating whether the option is disabled.
    hidden?: boolean;                               // the evaluated value indicating whether the option is hidden.
    checked?: boolean;                              // the evaluated value indicating whether the option is checked.
    checkColor?: { color: chalk.ChalkFunction | undefined };
    checkStyle?: "checkbox" | "radio";
    formatted?: string;                             // caches the formatted output for the option.
}

function hasAdvancedOption(prompt: EvaluatedPrompt<any, any>) {
    if (prompt.hasAdvancedOption === undefined) {
        prompt.hasAdvancedOption = prompt.options.some(opt => opt.advanced && !opt.hidden);
    }
    return prompt.hasAdvancedOption;
}

function hasCheckedOption(prompt: EvaluatedPrompt<any, any>) {
    if (prompt.hasCheckedOption === undefined) {
        prompt.hasCheckedOption = prompt.options.some(opt => opt.checked !== undefined && !opt.hidden && (!opt.advanced || prompt.showAdvanced));
    }
    return prompt.hasCheckedOption;
}

const ctrlRegExp = /\bctrl[-+]/ig;
const shiftRegExp = /\bshift[-+]/ig;
const metaRegExp = /\b(alt|meta)[-+]/ig;
const parseKeyCache = new Map<string, Key>();

export interface Key {
    name: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
}

/**
 * Parse a text like `ctrl+shift+s` into a `readline.Key`.
 */
function parseKey(text: string) {
    text = text.toLowerCase();
    let key = parseKeyCache.get(text);
    if (!key) {
        const withoutCtrl = text.replace(ctrlRegExp, "");
        const withoutShift = withoutCtrl.replace(shiftRegExp, "");
        let name = withoutShift.replace(metaRegExp, "");
        const ctrl = withoutCtrl !== text;
        const shift = withoutShift !== withoutCtrl;
        const meta = name !== withoutShift;
        if (name === "return") name = "enter";
        if (name === "escape") name = "esc";
        key = { name, ctrl, shift, meta };
        parseKeyCache.set(text, key);
    }
    return key;
}

/**
 * Format a prompt key.
 */
function formatKey(key: Key): string {
    let text = "";
    if (key.ctrl) text += "ctrl+";
    if (key.meta) text += (process.platform === "win32" ? "alt+" : "meta+");
    if (key.shift) text += "shift+";
    text += key.name;
    return text;
}

function makeKey(name: string, { ctrl = false, shift = false, meta = false } = {}): Key {
    return { name, ctrl, shift, meta };
}

function normalizeKey({ ctrl = false, shift = false, meta = false, sequence = "", name = sequence }: readline.Key): Key {
    if (ctrl && name === "m") return makeKey("enter")
    if (!ctrl && !shift && !meta && name === "enter") return makeKey("enter", { ctrl: true });
    if (name === "escape") return makeKey("esc");
    if (name === "return") name = "enter";
    return { name, ctrl, shift, meta };
}

/**
 * Tests whether an actual `PromptKey` is a match for an expected `PromptKey`.
 * @param actual
 * @param expected
 */
function matchKey(actual: string | Key, expected: string | Key | readonly [string | Key, ...(string | Key)[]]): boolean {
    if (isArray(expected)) return expected.some(expected => matchKey(actual, expected));
    if (typeof actual === "string") return matchKey(parseKey(actual), expected);
    if (typeof expected === "string") return matchKey(actual, parseKey(expected));
    return expected.name === actual.name
        && expected.shift === actual.shift
        && expected.ctrl === actual.ctrl
        && expected.meta === actual.meta;
}

function formatChecked(checked: boolean | undefined, checkStyle: "checkbox" | "radio" | undefined, checkColor: chalk.ChalkFunction | undefined) {
    switch (checkStyle) {
        case "radio":
            switch (checked) {
                case true: return (checkColor ?? chalk.green)("ø ");
                case false: return (checkColor ?? chalk.gray)("o ");
            }
            break;
        case "checkbox":
        default:
            switch (checked) {
                case true: return (checkColor ?? chalk.green)("✔ ");
                case false: return (checkColor ?? chalk.red)("⨯ ");
            }
            break;
    }
    return "  ";
}

/**
 * Formats a prompt options.
 */
function formatOption(option: EvaluatedOption<any, any>, prompt: EvaluatedPrompt<any, any>) {
    if (!option.formatted) {
        const checked = hasCheckedOption(prompt) ? formatChecked(option.checked, option.checkStyle, option.checkColor?.color) : "";
        const formatted = ` ${checked}> Press ${chalk.yellow(formatKey(isArray(option.key) ? option.key[0] : option.key))} to ${option.description.replace(/\.$/, "")}.\n`;
        option.formatted = option.disabled ? chalk.gray(stripAnsi.default(formatted)) : formatted;
    }
    return option.formatted;
}

/**
 * Formats a prompt.
 */
function formatPrompt(prompt: EvaluatedPrompt<any, any>) {
    const key = prompt.showAdvanced ? "formattedAdvanced" : "formattedBasic";
    let text = prompt[key];
    if (text === undefined) {
        text = "";
        if (prompt.header) {
            text += `${prompt.header}\n\n`;
        }
        text += chalk.bold(`${prompt.title}:\n`);
        for (const option of prompt.options) {
            if (option.hidden) continue;
            if (!option.advanced || prompt.showAdvanced) {
                text += formatOption(option, prompt);
            }
        }
        prompt[key] = text;
    }
    return text;
}

function countLines(prompt: EvaluatedPrompt<any, any>) {
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

const quitOption: Option<any, any> = {
    key: ["q", "ctrl+c", "ctrl+d"],
    description: "quit",
    action: quit
};

const advancedOption: Option<any, any> = {
    key: ["h", "?"],
    description: context => `${context.showAdvanced ? "hide" : "show"} advanced options`,
    action: async (prompt) => {
        const size = getPromptLineCount();
        if (currentPrompt?.prompt === prompt.prompt) {
            await hidePrompt(false);
        }
        prompt.showAdvanced = !prompt.showAdvanced;
        if (currentPrompt?.prompt === prompt.prompt) {
            await refreshPrompt();
            if (currentPrompt?.prompt === prompt.prompt && size !== getPromptLineCount()) {
                await onPromptSizeChange();
            }
            if (currentPrompt?.prompt === prompt.prompt) {
                await showPrompt(false);
            }
        }
    }
};

const onPromptSizeChangeCallbacks: (() => void | Promise<void>)[] = [];
export function addOnPromptSizeChange(cb: () => void | Promise<void>) {
    onPromptSizeChangeCallbacks.push(cb);
}

async function onPromptSizeChange() {
    for (const onPromptSizeChange of onPromptSizeChangeCallbacks) {
        try {
            const result = onPromptSizeChange();
            if (result) await result;
        }
        catch (e) {
            console.error(e);
        }
    }
}

const onQuitCallbacks: (() => void | Promise<void>)[] = [];
let quitPromise: Promise<void> | undefined;

/**
 * Performs cleanup of displayed prompts before exiting the process.
 */
export function quit() {
    if (quitPromise) return quitPromise;
    return quitPromise = (async () => {
        await hidePrompt();
        unregisterOnKeypress();
        while (currentPrompt) {
            currentPrompt.visible = false;
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

/**
 * Registers a callback to be executed when `quit()` is called.
 */
export function addOnQuit(callback: () => void | Promise<void>) {
    onQuitCallbacks.push(callback);
}

function onKeypress(ch: string | undefined, _key: readline.Key | undefined) {
    const key = _key ? normalizeKey(_key) : ch ? makeKey(ch) : undefined;
    if (!key) return;
    if (matchKey(key, ["q", "ctrl+c", "ctrl+d"])) {
        quit();
        return;
    }

    if (!currentPrompt) return;
    const prompt = currentPrompt;
    if (!prompt.visible || prompt.keypressBlocked) return;
    prompt.keypressBlocked = true;

    for (const option of prompt.options) {
        if (!option.disabled && matchKey(key, option.key)) {
            const result = option.option.action(prompt.context, key);
            if (result) {
                Promise.resolve(result).then(() => { prompt.keypressBlocked = false; });
                return;
            }
            break;
        }
    }

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

export function getPromptLineCount() {
    return currentPrompt ? countLines(currentPrompt) : 0;
}

/**
 * Determines whether there is an active prompt.
 */
export function hasPrompt() {
    return currentPrompt !== undefined;
}

/**
 * Determines whether the active prompt is currently visible.
 */
export function isPromptVisible() {
    return !!currentPrompt?.visible;
}

/**
 * Gets the active prompt.
 */
export function getCurrentPrompt() {
    return currentPrompt?.prompt;
}

/**
 * Make the active prompt visible.
 */
export async function showPrompt(raiseEvents = true) {
    if (currentPrompt && !currentPrompt.visible) {
        process.stdout.write(formatPrompt(currentPrompt) + "\n");
        currentPrompt.visible = true;
        if (raiseEvents) {
            await onPromptSizeChange();
        }
        return true;
    }
    return false;
}

/**
 * Reevaluate and update the active prompt.
 */
export async function refreshPrompt() {
    if (currentPrompt) {
        const wasVisible = isPromptVisible();
        if (wasVisible) await hidePrompt(false);
        updatePrompt(currentPrompt);
        if (wasVisible) await showPrompt(true);
    }
}

/**
 * Makes the active prompt invisible.
 */
export async function hidePrompt(raiseEvents = true) {
    if (currentPrompt?.visible) {
        readline.moveCursor(process.stdout, 0, -countLines(currentPrompt));
        readline.clearScreenDown(process.stdout);
        currentPrompt.visible = false;
        if (raiseEvents) {
            await onPromptSizeChange();
        }
        return true;
    }
    return false;
}

export type Evaluatable<T, R, S> = (context: PromptContext<R, S>) => T;

type EvaluateConstraint<T> = { [P in keyof T]: P extends "call" | "apply" | "bind" ? never : T[P] };

function evaluate<T extends EvaluateConstraint<T>, R, S>(value: T | Evaluatable<T, R, S>, context: PromptContext<R, S>): T {
    return typeof value === "function" ? value(context) : value;
}

function evaluateOption<R, S>(option: Option<R, S>, context: PromptContext<R, S>): EvaluatedOption<R, S> {
    const key = evaluate(option.key, context);
    return {
        option,
        key: isArray(key) ? key.map(parseKey) as [Key, ...Key[]] : parseKey(key),
        description: evaluate(option.description, context),
        advanced: evaluate(option.advanced, context),
        disabled: evaluate(option.disabled, context),
        hidden: evaluate(option.hidden, context),
        checked: evaluate(option.checked, context),
        checkColor: evaluate(option.checkColor, context),
        checkStyle: evaluate(option.checkStyle, context),
    };
}

function updatePrompt<R, S>(evaluated: EvaluatedPrompt<R, S>) {
    const prompt = evaluated.prompt;
    evaluated.header = evaluate(prompt.header, evaluated.context);
    evaluated.title = evaluate(prompt.title, evaluated.context);
    evaluated.options = evaluate(prompt.options, evaluated.context).map(opt => evaluateOption(opt, evaluated.context));
    if (hasAdvancedOption(evaluated)) {
        evaluated.options.unshift(evaluateOption(advancedOption, evaluated.context));
    }
    evaluated.options.push(evaluateOption(quitOption, evaluated.context));
    evaluated.formattedBasic = undefined;
    evaluated.formattedBasicLines = undefined;
    evaluated.formattedAdvanced = undefined;
    evaluated.formattedAdvancedLines = undefined;
}

async function evaluatePrompt<R, S>(prompt: Prompt<R, S>): Promise<EvaluatedPrompt<R, S>> {
    let resolve!: () => void;
    let reject!: (reason: any) => void;
    const promise = new Promise<void>((res, rej) => (resolve = res, reject = rej));
    const state: Partial<S> = {};
    const evaluated: EvaluatedPrompt<R, S> = {
        prompt,
        state,
        context: {
            prompt,
            state,
            get showAdvanced() { return !!evaluated.showAdvanced; },
            set showAdvanced(value: boolean) { evaluated.showAdvanced = value; },

            get result() { return evaluated.result; },
            set result(value: R | undefined) { evaluated.result = value; },

            async show() {
                if (evaluated === currentPrompt) {
                    return await showPrompt();
                }
                else if (!evaluated.visible) {
                    evaluated.visible = true;
                    return true;
                }
                return false;
            },
            async hide() {
                if (evaluated === currentPrompt) {
                    return await hidePrompt();
                } else if (evaluated.visible) {
                    evaluated.visible = false;
                    return true;
                }
                return false;
            },
            async refresh() {
                if (evaluated === currentPrompt) {
                    await refreshPrompt();
                } else {
                    updatePrompt(evaluated);
                }
            },
            async close(result) {
                if (result !== undefined) {
                    this.result = result;
                }
                if (evaluated === currentPrompt) {
                    await popPrompt();
                }
                else {
                    evaluated.closed = true;
                }
            }
        },
        promise,
        resolve,
        reject,
        header: undefined,
        title: undefined!,
        options: undefined!,
        result: undefined,
        showAdvanced: false,
        formattedBasic: undefined,
        formattedBasicLines: undefined,
        formattedAdvanced: undefined,
        formattedAdvancedLines: undefined
    };
    await evaluated.prompt.onEnter?.(evaluated.context);
    updatePrompt(evaluated);
    return evaluated;
}

/**
 * Pushes a new prompt, returing a promise that is resolved when the prompt has closed.
 */
export async function pushPrompt<R, S>(prompt: Prompt<R, S>): Promise<R | undefined> {
    await hidePrompt(false);
    if (currentPrompt !== undefined) {
        promptStack.push(currentPrompt);
    }
    else {
        registerOnKeypress();
    }
    const thisPrompt = currentPrompt = await evaluatePrompt(prompt);
    await showPrompt();
    await thisPrompt.promise;
    await thisPrompt.prompt.onExit?.(thisPrompt.context);
    return thisPrompt.result;
}

/**
 * Closes the current prompt and displays the previous prompt, if one exists.
 */
export async function popPrompt() {
    const hidden = await hidePrompt(false);
    if (currentPrompt) {
        currentPrompt.closed = true;
        currentPrompt.resolve();
        currentPrompt = promptStack.pop();
        while (currentPrompt?.closed) {
            currentPrompt.resolve();
            currentPrompt = promptStack.pop();
        }
        if (currentPrompt !== undefined) {
            await showPrompt();
        }
        else {
            unregisterOnKeypress();
            if (hidden) {
                await onPromptSizeChange();
            }
        }
    }
}