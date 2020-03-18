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

import { argv } from "./options";
import prompts = require("prompts");
import Github = require("@octokit/rest");
import { ProjectService, Column, Card } from "./github";
import { getChromePath, spawnChromeAndWait } from "./chrome";

function getRandomPort() {
    return 9000 + Math.floor(Math.random() * 999);
}


async function main() {
    const chromePath = await getChromePath();

    let {
        token,
        username,
        password,
        review,
        checkAndMerge,
        draft,
        port = getRandomPort(),
        timeout = 10000
    } = argv;

    if (!review && !checkAndMerge) {
        review = true;
        checkAndMerge = true;
    }

    if (!token) {
        token = process.env.GITHUB_API_TOKEN ?? process.env.FOCUS_DT_GITHUB_API_TOKEN ?? process.env.AUTH_TOKEN 
    }

    if (!token && (!username || !password)) {
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

    if (!token && (!username || !password)) {
        return;
    }

    const service = new ProjectService({
        github: {
            auth: token || {
                username: username!,
                password: password!,
                async on2fa() {
                    const { otp } = await prompts({
                        type: "text",
                        name: "otp",
                        message: "GitHub 2FA code"
                    }, { onCancel() { process.exit(1); } });
                    return otp;
                }
            }
        },
        owner: "DefinitelyTyped",
        repo: "DefinitelyTyped",
        project: "Pull Request Status Board",
        columns: ["Check and Merge", "Review"],
    });

    const project = await service.getProject();
    const columns = await service.getColumns(project);
    const checkAndMergeCards = checkAndMerge ? await service.getCards(columns["Check and Merge"], !!argv.oldest) : undefined;
    const reviewCards = review ? await service.getCards(columns["Review"], !!argv.oldest) : undefined;

    if (checkAndMergeCards) {
        console.log(`'Check and Merge' count: ${checkAndMergeCards.length}`);
    }

    if (reviewCards) {
        console.log(`'Review' count: ${reviewCards.length}`);
    }

    console.log();

    if (checkAndMergeCards) {
        await runDown(columns["Check and Merge"], checkAndMergeCards.slice());
    }

    if (reviewCards) {
        await runDown(columns["Review"], reviewCards.slice());
    }

    async function runDown(column: Column, cards: Card[]) {
        const count = cards.length;
        if (count === 0) {
            return;
        }

        console.log(`${column.name}:`);

        let card: Github.ProjectsListCardsResponseItem | undefined;
        while (card = cards.shift()) {
            console.log();

            const result = await service.getPull(card, draft);
            if (result.error) {
                console.log(`[${count - cards.length}/${count}] ${result.message}, skipping.`);
                continue;
            }

            const { pull, labels } = result;

            console.log(`
[${count - cards.length}/${count}] ${pull.title}
\t${pull.html_url}
\tupdated: ${card.updated_at}
\t${[...labels].join(', ')}
`.trim());

            await spawnChromeAndWait(chromePath, pull.html_url, port, !!argv.verbose, timeout);
        }
    }
}

main().catch(e => console.error(e));
