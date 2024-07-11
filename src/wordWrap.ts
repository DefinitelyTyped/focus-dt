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

interface Token {
    kind: "escape" | "word" | "word-break" | "line-break";
    value: string;
}

const tokenizerRegExp = /(?<escape>(?:\u001b\[\d*(?:;\d*)+m)+)|(?<lineBreak>\r?\n)|(?<wordBreak>[\s\u200b]+)|(?<character>.)/yu;

function * tokenize(s: string): IterableIterator<Token> {
    let pos = 0;
    let wordStart = 0;
    while (pos < s.length) {
        tokenizerRegExp.lastIndex = pos;
        const match = tokenizerRegExp.exec(s);
        if (!match?.groups) throw new Error();
        const { escape, lineBreak, wordBreak, character } = match.groups;
        const nextPos = match.index + match[0].length;
        if (!character) {
            if (wordStart < pos) {
                yield { kind: "word", value: s.slice(wordStart, pos) };
            }
            if (escape) {
                yield { kind: "escape", value: escape };
            }
            else if (lineBreak) {
                yield { kind: "line-break", value: lineBreak };
            }
            else if (wordBreak) {
                yield { kind: "word-break", value: wordBreak };
            }
            wordStart = nextPos;
        }
        pos = nextPos;
    }
    if (wordStart < s.length) {
        yield { kind: "word", value: s.slice(wordStart) };
    }
}

export function wordWrap(s: string, width: number) {
    const lines: string[] = [];
    let lineSize = 0;
    let line = "";
    for (const token of tokenize(s)) {
        if (token.kind === "line-break") {
            lines.push(line);
            line = "";
            lineSize = 0;
            continue;
        }
        if (token.kind === "escape") {
            line += token.value;
            continue;
        }
        if (lineSize + token.value.length > width) {
            lines.push(line.replace(/\s+$/, ""));
            line = "";
            lineSize = 0;
            if (token.kind === "word-break" && token.value === " ") {
                continue;
            }
        }
        line += token.value;
        lineSize += token.value.length;
    }
    if (line) {
        lines.push(line);
    }
    return lines;
}
