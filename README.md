# focus-dt

A simple command-line tool for running down PRs on DefinitelyTyped.

# Installation

```sh
npm i -g focus-dt
```

# Usage

```sh
focus-dt [options]
```

## Options

```
Authentication options:
  --token                     GitHub Auth Token. Uses %GITHUB_API_TOKEN%,
                              %FOCUS_DT_GITHUB_API_TOKEN%, or %AUTH_TOKEN% (in
                              that order) if available                  [string]
  --username                  GitHub Username                           [string]
  --password                  GitHub Password                           [string]
  --useCredentialManager, -C  Use 'git credential' to load/save the credential
                              to use                                   [boolean]

Configuration options:
  --config   Loads settings from a JSON file
                   [string] [default: "C:\Users\rbuckton\.focus-dt\config.json"]
  --save     Saves settings to '%HOMEDIR%/.focus-dt/config.json' and exits
                                                                       [boolean]
  --save-to  Saves settings to the specified file and exits             [string]

Browser options:
  --chromePath  The path to the chromium-based browser executable to use
                (defaults to detecting the current system path for chrome)
                                                                        [string]
  --port        The remote debugging port to use to wait for the chrome tab to
                exit                                                    [number]
  --timeout     The number of milliseconds to wait for the debugger to attach to
                the chrome process (default: 10,000)                    [number]

Options:
  --version      Show version number                                   [boolean]
  --skipped      Include previously skipped items                      [boolean]
  --needsReview  Include items from the 'Needs Maintainer Review' column of 'New
                 Pull Request Status Board'                            [boolean]
  --needsAction  Include items from the 'Needs Maintainer Action' column of 'New
                 Pull Request Status Board'                            [boolean]
  --oldest       Sort so that the least recently updated cards come first
                                                                       [boolean]
  --newest       Sort so that the most recently updated cards come first
                                                                       [boolean]
  --draft        Include 'Draft' PRs                                   [boolean]
  --wip          Include work-in-progress (WIP) PRs                    [boolean]
  --merge        Set the default merge option to one of 'merge', 'squash', or
                 'rebase'
                      [string] [choices: "merge", "squash", "rebase", undefined]
  --approve      Sets the approval option to one of 'manual', 'auto', 'always',
                 or 'only' (default 'manual'):
                 - 'manual' - Manually approve PRs in the CLI
                 - 'auto' - Approve PRs when merging if they have no other
                 approvers
                 - 'always' - Approve PRs when merging if you haven't already
                 approved
                 - 'only' - Manually approve PRs in the CLI and advance to the
                 next item (disables merging)
                          [string] [choices: "manual", "auto", "always", "only"]
  --verbose, -v  Increases the log level                                 [count]
  --help, -h     Show help                                             [boolean]
```

### Token Acquisition

If not GitHub auth token is provided, then the script will look in your host environment for: `GITHUB_API_TOKEN`, `FOCUS_DT_GITHUB_API_TOKEN` and `AUTH_TOKEN` before asking for a token.
