import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import fetch from 'node-fetch'

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

    const allDependencIssues = await extractAllDependencyIssues(github)

    const allIssues = [...bodyIssues, ...allCommmitIssues, ...allDependencIssues]

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

async function extractAllDependencyIssues(github: InstanceType<typeof GitHub>): Promise<string[]> {
  if (!context.payload.pull_request) {
    return []
  }

  const base = context.payload.pull_request.base.sha
  const head = context.payload.pull_request.head.sha

  core.debug(`Base sha: ${base}`)
  core.debug(`Head sha: ${head}`)

  const files = await github.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number
  })

  for (const file of files.data) {
    if (!file.filename.endsWith('.json')) {
      continue
    }

    core.debug(`Found file ${file.filename} changed in PR`)
    const headUrl = file.raw_url
    const baseUrl = file.raw_url.replace(head, base)
    core.debug(`File content of PR: ${headUrl}`)
    core.debug(`File content of base: ${baseUrl}`)


  }

  const headUrl = 'https://github.com/woehrl01/reference-workitems/raw/8fad6c5f92239947bcee8224ec8fcd4cc62e5e13/__tests__/testcases/after-composer.lock'
  const baseUrl = 'https://github.com/woehrl01/reference-workitems/raw/8fad6c5f92239947bcee8224ec8fcd4cc62e5e13/__tests__/testcases/prev-composer.lock'

  for (const issue of await extractFromPackageManager(github, headUrl, baseUrl)) {
    core.debug(`Found issue ${issue} in dependency`)
  }


  return []
}

type ComposerLock = {
  packages: {
    name: string,
    source: {
      type: string,
      url: string,
      reference: string
    }
  }[]
}



async function extractFromPackageManager(github: InstanceType<typeof GitHub>, baseFileUrl: string, headFileUrl: string): Promise<string[]> {

  const baseFileRequest = await fetch(baseFileUrl)
  const baseContent = await baseFileRequest.json() as ComposerLock

  const headFileRequest = await fetch(headFileUrl)
  const headContent = await headFileRequest.json() as ComposerLock

  const previousDependencies: { [key: string]: string } = {}
  for (const dependency of baseContent.packages) {
    if (dependency.source.type !== 'git') {
      continue
    }

    previousDependencies[dependency.source.url] = dependency.source.reference
  }

  const newDependencies: { [key: string]: string } = {}
  for (const dependency of headContent.packages) {
    if (dependency.source.type !== 'git') {
      continue
    }

    newDependencies[dependency.source.url] = dependency.source.reference
  }

  const changedDependencies = Object.keys(newDependencies).filter(key => previousDependencies[key] !== newDependencies[key])
  const changedDependenciesIssues = []
  for (const dependency of changedDependencies) {

    const dependencyIssues = await extractFromGitHub(github, dependency, previousDependencies[dependency], newDependencies[dependency])
    for (const issue of dependencyIssues) {
      changedDependenciesIssues.push(issue)
    }
  }

  return changedDependenciesIssues

  // 1. implement diff for package manager here which detectes the commit delta of the repo

  // 1.1 for each diff:

  // 2. call github api to get the commits between the changes

  // 3. extract the issues from the commit messages
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

  const titleWithoutIssues = prTitle.replace(/ \([^)]*?\)$/, '')

  const issueText = [...new Set(issues)].map(issue => `${issue}`).join(', ')

  return `${titleWithoutIssues} (${issueText})`
}


async function extractFromGitHub(github: InstanceType<typeof GitHub>, repo: string, baseSha: string, headSha: string): Promise<string[]> {
  const commits = await github.rest.repos.compareCommits({
    owner: repo.split('/')[0],
    repo: repo.split('/')[1],
    base: baseSha,
    head: headSha
  })

  core.debug(`Found ${commits.data.commits.length} commits in repo ${repo}`)

  const allCommitIssues = []
  for (const commit of commits.data.commits) {
    core.debug(`Found related commit ${commit.sha} in repo ${repo}`)

    const commitMessage = commit.commit.message
    const commitIssues = await readAllIssues(commitMessage || '')
    for (const issue of commitIssues) {
      allCommitIssues.push(issue)
      core.debug(`Found issue ${issue} in related commit message from repo ${repo}`)
    }
  }

  return allCommitIssues
}


run()
