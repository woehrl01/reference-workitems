<p align="center">
  <a href="https://github.com/woehrl01/reference-workitems/actions"><img alt="typescript-action status" src="https://github.com/woehrl01/reference-workitems/workflows/build-test/badge.svg"></a>
</p>

# Reference (dependend) Workitems Github action

This work items updates the title of the PR with all linked workitems. It also updates the workitem if a dependency is changed (currently only composer is supported).

## Goal

Make sure that we can track when specific work items are part of a PR.

## Inputs

| input                | required | description                                                                                                                                                                                                     |
| -------------------- | :------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`       |    ❌    | The GitHub token used to create an authenticated client. You like need to provide a more powerful read only token if you need to access private git repos for your dependencies (default: `${{ github.token }}` |
| `issue-regex-match`  |    ❌    | The regex used to match the issue number (default: `(#[0-9]+)`)                                                                                                                                                 |
| `composer-lock-glob` |    ❌    | The glob used to find composer.lock files (default: `composer.lock`)                                                                                                                                            |
| `fail-if-no-issues`  |    ❌    | Whether to fail if the issue number is not found (default: `false`)                                                                                                                                             |

## Usage

```yml
name: Update pull request

on:
  pull_request:
    types: [opened, synchronize, edited]

jobs:
  title-and-description:
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest

    steps:
      - uses: woehrl01/reference-workitems@1.1
        with:
          github-token: ${{ secrets.READONLY_PRIVATE_REPO_GITHUB_TOKEN }}
          issue-regex-match: '(AB#[0-9]+)'
          fail-if-no-issues: 'true'
          composer-lock-glob: '**/composer.lock'
```
