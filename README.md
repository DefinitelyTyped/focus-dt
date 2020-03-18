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
  --version        Show version number                                 [boolean]
  --token          GitHub Auth Token                                    [string]
  --username       GitHub Username                                      [string]
  --password       GitHub Password                                      [string]
  --review         Include items from the 'Review' column of 'Pull Request
                   Status Board'                                       [boolean]
  --checkAndMerge  Include items from the 'Check and Merge' column of 'Pull
                   Request Status Board'                               [boolean]
  --oldest         Sort so that the least recently updated cards come first
                                                                       [boolean]
  --newest         Sort so that the most recently updated cards come first
                                                                       [boolean]
  --port           The remote debugging port to use to wait for the chrome tab
                   to exit.                                             [number]
  --verbose, -v    Increases the log level                               [count]
  --help           Show help                                           [boolean]
```

### Token Acquisition

If not GitHub auth token is provided, then the script will look in your host environment for: `GITHUB_API_TOKEN`, `FOCUS_DT_GITHUB_API_TOKEN` and `AUTH_TOKEN` before asking for a token.
