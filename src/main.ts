import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'

const regexMatchIssue = /(AB#[0-9]+)/

async function run(): Promise<void> {
  try {
    if (!context.payload.pull_request) {
      return
    }

    const token: string = core.getInput('github-token')

    const github = getOctokit(token)

    const prTitle = context.payload.pull_request.title

    const bodyIssues = await readAllIssues(
      context.payload.pull_request.body || ''
    )

    const commits = await github.rest.pulls.listCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number
    })

    /*const { data: diff } = await github.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      mediaType: {
        format: "patch",
      },
    })*/

    for (const issue of bodyIssues) {
      core.debug(`Found issue ${issue} in body`)
    }

    for (const commit of commits.data) {
      const commitMessage = commit.commit.message
      const commitIssues = await readAllIssues(commitMessage || '')
      for (const issue of commitIssues) {
        core.debug(`Found issue ${issue} in commit message`)
      }
    }

    const newTitle = replaceIssueNumbers(prTitle, bodyIssues)
    core.debug(`New title: ${newTitle}`)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function readAllIssues(body: string): Promise<string[]> {
  const matches = body.match(regexMatchIssue)

  if (!matches) {
    return []
  }

  return matches.map(match => match.toString())
}

async function replaceIssueNumbers(
  prTitle: string,
  issues: string[]
): Promise<string> {
  const titleWithoutIssues = prTitle.replace(/\(\)/, '')

  return titleWithoutIssues + issues.map(issue => `${issue}`).join(', ')
}

run()
