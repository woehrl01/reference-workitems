import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'

const regexMatchIssue = /(AB#[0-9]+)/g

async function run(): Promise<void> {
  try {
    if (!context.payload.pull_request) {
      return
    }

    const token: string = core.getInput('github-token')
    const github = getOctokit(token)

    const bodyIssues = await extractAllIssuesFromBody()
    const allCommmitIssues = await extractAllIssuesFromCommits(github)

    const allIssues = [...bodyIssues, ...allCommmitIssues]

    const prTitle = context.payload.pull_request.title
    const newTitle = await replaceIssueNumbers(prTitle, allIssues)
    core.debug(`New title: ${newTitle}`)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function extractAllIssuesFromCommits(github: InstanceType<typeof GitHub>): Promise<string[]> {
  if (!context.payload.pull_request) {
    return []
  }

  const commits = await github.rest.pulls.listCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number
  })

  const allCommmitIssues = []
  for (const commit of commits.data) {
    const commitMessage = commit.commit.message
    const commitIssues = await readAllIssues(commitMessage || '')
    for (const issue of commitIssues) {
      allCommmitIssues.push(issue)
      core.debug(`Found issue ${issue} in commit message`)
    }
  }
  return allCommmitIssues
}

async function extractAllIssuesFromBody(): Promise<string[]> {
  if (!context.payload.pull_request) {
    return []
  }

  const bodyIssues = await readAllIssues(context.payload.pull_request.body || '')

  for (const issue of bodyIssues) {
    core.debug(`Found issue ${issue} in body`)
  }
  return bodyIssues
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

  if (!issues.length) {
    return prTitle
  }

  const titleWithoutIssues = prTitle.replace(/\(\)/, '')

  const issueText = [...new Set(issues)].map(issue => `${issue}`).join(', ')

  return `${titleWithoutIssues} (${issueText})`
}

run()
