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
import { wordWrap } from "./wordWrap.js";

const ESC = "\x1B";
const CSI = `${ESC}[`;
const emptyArray: readonly never[] = [];

interface ScreenSection {
    y: number;
    lines: string[];
}

interface PromptInfo {
    getPromptLineCount(): number;
    isPromptVisible(): boolean;
    showPrompt(raiseEvents?: boolean): Promise<boolean>;
    hidePrompt(raiseEvents?: boolean): Promise<boolean>;
    addOnPromptSizeChange(cb: () => void | Promise<void>): void;
}

export class Screen {
    private headerLines: string[] = [];
    private logLines: string[] = [];
    private progressLines: string[] = [];
    private pullLines: string[] = [];
    private writtenHeaderLines: ScreenSection = { y: 0, lines: [] };
    private writtenLogLines: ScreenSection = { y: 0, lines: [] };
    private writtenProgressLines: ScreenSection = { y: 0, lines: [] };
    private writtenPullLines: ScreenSection = { y: 0, lines: [] };
    private width = 120;
    private height = Infinity;
    private prompt: PromptInfo;
    private output: NodeJS.WriteStream;

    constructor(output: NodeJS.WriteStream, prompt: PromptInfo) {
        this.prompt = prompt;
        this.output = output;
        this.width = this.output.columns ?? Infinity;
        this.height = this.output.rows ?? Infinity;
        this.output.on("resize", () => process.nextTick(() => this.refresh()));
        this.prompt.addOnPromptSizeChange(() => {
            this.refresh(true);
        });
    }

    get headerStart() {
        return 0;
    }

    get progressStart() {
        return this.headerStart + this.writtenHeaderLines.lines.length;
    }

    get logStart() {
        return this.progressStart + this.writtenProgressLines.lines.length;
    }

    get pullStart() {
        return this.logStart + this.writtenLogLines.lines.length;
    }

    private _clear({ clearHeader = false, clearProgress = false, clearLog = false, clearPull = false }) {
        if (clearHeader || clearProgress || clearLog || clearPull) this.resetSection(this.writtenPullLines);
        if (clearHeader || clearProgress || clearLog) this.resetSection(this.writtenLogLines);
        if (clearHeader || clearProgress) this.resetSection(this.writtenProgressLines);
        if (clearHeader) this.headerLines.length = 0;
        if (clearProgress) this.progressLines.length = 0;
        if (clearLog) this.logLines.length = 0;
        if (clearPull) this.pullLines.length = 0;
    }

    clearHeader({ clearProgress = true, clearLog = true, clearPull = true } = {}) {
        this._clear({ clearHeader: true, clearProgress, clearLog, clearPull });
    }

    clearProgress({ clearLog = true, clearPull = true } = {}) {
        this._clear({ clearProgress: true, clearLog, clearPull });
    }

    clearLog({ clearPull = true } = {}) {
        this._clear({ clearLog: true, clearPull });
    }

    clearPull() {
        this._clear({ clearPull: true });
    }

    addProgress(line: string = "") {
        this.progressLines.push(...line.split(/\r?\n/g));
    }

    addHeader(line: string = "") {
        this.headerLines.push(...line.split(/\r?\n/g));
    }

    addLog(line: string = "") {
        const lines = line.split(/\r?\n/g);
        this.logLines.push(...lines);
    }

    addPull(line: string = "") {
        this.pullLines.push(...line.split(/\r?\n/g));
    }

    private resetSection(section: ScreenSection) {
        section.y = 0;
        section.lines.length = 0;
    }

    private reflowSource(source: readonly string[]) {
        if (source.some(line => line.length > this.width)) {
            let reflow: string[] = [];
            for (const line of source) {
                if (line.length > this.width) {
                    reflow.push(line);
                }
                else {
                    reflow = reflow.concat(wordWrap(line, this.width));
                }
            }
            source = reflow;
        }
        return source;
    }

    private writeLines(y: number, source: readonly string[], written: ScreenSection) {
        let i = 0;
        if (y !== written.y) {
            written.y = y;
            written.lines.length = 0;
        }
        else {
            while (i < source.length && i < written.lines.length && source[i] === written.lines[i]) {
                i++;
            }
            if (written.lines.length > i) {
                written.lines.length = i;
            }
        }
        this.cursorTo(0, y + i);
        while (i < source.length) {
            const s = source[i];
            this.clearLine();
            this.output.write(s + "\n");
            written.lines.push(s);
            i++;
        }
        return i;
    }

    render() {
        try {
            this.hideCursor();
            const writePull = this.pullLines.length > 0;
            const writeLog = writePull || this.logLines.length > 0;
            const writeProgress = writeLog || this.progressLines.length > 0;
            const writeHeader = writeProgress || this.headerLines.length > 0;
            const header = writeHeader ? this.reflowSource(this.headerLines) : emptyArray;
            const progress = writeProgress ? this.reflowSource(this.progressLines) : emptyArray;
            const pull = writePull ? this.reflowSource(this.pullLines) : emptyArray;
            let log = writeLog ? this.reflowSource(this.logLines) : emptyArray;
            let y = 0;
            if (writeHeader) {
                y += this.writeLines(y, header, this.writtenHeaderLines);
                if (writeProgress) {
                    y += this.writeLines(y, progress, this.writtenProgressLines);
                    if (writeLog) {
                        const limit = this.height - header.length - progress.length - pull.length - this.prompt.getPromptLineCount() - 1;
                        log = log.slice(-limit);
                        log = log.map(line => chalk.gray(line));
                        y += this.writeLines(y, log, this.writtenLogLines);
                        if (writePull) {
                            this.writeLines(y, pull, this.writtenPullLines);
                        }
                    }
                }
                this.clearScreenDown();
            }
        } 
        finally {
            this.showCursor();
        }
    }

    async refresh(force?: boolean) {
        const prompting = this.prompt.isPromptVisible();
        if (prompting) await this.prompt.hidePrompt(false);
        this.width = this.output.columns ?? Infinity;
        this.height = this.output.rows ?? Infinity;
        if (force) {
            this.writtenHeaderLines.y = 0;
            this.writtenHeaderLines.lines.length = 0;
            this.writtenProgressLines.y = 0;
            this.writtenProgressLines.lines.length = 0;
            this.writtenLogLines.y = 0;
            this.writtenLogLines.lines.length = 0;
            this.writtenPullLines.y = 0;
            this.writtenPullLines.lines.length = 0;
            this.cursorTo(0, 0);
            this.eraseDisplay();
            this.clearScreenDown();
            this.cursorTo(0, 0);
        }
        this.render();
        if (prompting) await this.prompt.showPrompt(false);
    }

    private hideCursor() {
        this.output.write(`${CSI}?25l`);
    }

    private showCursor() {
        this.output.write(`${CSI}?25h`);
    }

    private cursorTo(x: number, y?: number) {
        readline.cursorTo(this.output, x, y);
    }

    private clearLine(dir: -1 | 0 | 1 = 0) {
        readline.clearLine(this.output, dir);
    }

    private clearScreenDown() {
        readline.clearScreenDown(this.output);
    }

    private eraseDisplay() {
        this.output.write(`${CSI}3J`);
    }
}