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

import Registry = require("winreg");

export const HKLM = Registry.HKLM;

export function regQuery(hive: string, key: string, valueName: string = Registry.DEFAULT_VALUE) {
    return new Promise<string | undefined>((resolve, reject) => {
        const reg = new Registry({ hive, key });
        reg.keyExists((err, exists) => {
            if (err) return reject(err);
            if (!exists) return resolve(undefined);
            reg.valueExists(valueName, (err, exists) => {
                if (err) return reject(err);
                if (!exists) return resolve(undefined);
                reg.get(valueName, (err, item) => {
                    if (err) return reject(err);
                    resolve(item.value);
                });
            })
        })
    });
}
