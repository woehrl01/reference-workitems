import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import minimatch from 'minimatch'

let regexMatchIssue: RegExp

async function run(): Promise<void> {
  try {
    if (!context.payload.pull_request) {
      return
    }

    const token: string = core.getInput('github-token')
    const issueRegexMatch: string = core.getInput('issue-regex-match')
    const composerMatch: string = core.getInput('composer-lock-glob')
    const failIfNoIssues: boolean = core.getInput('fail-if-no-issues') === 'true'

    regexMatchIssue = new RegExp(issueRegexMatch, 'g')

    const github = getOctokit(token)

    const bodyIssues = await extractAllIssuesFromBody()
    const allCommmitIssues = await extractAllIssuesFromCommits(github)
    const allDependencIssues = await extractAllDependencyIssues(github, composerMatch)

    const allIssues = [...bodyIssues, ...allCommmitIssues, ...allDependencIssues]

    const prTitle = context.payload.pull_request.title
    const newTitle = await replaceIssueNumbers(prTitle, allIssues)

    if (prTitle !== newTitle) {
      core.debug(`New title: ${newTitle}`)
      await github.rest.pulls.update({
        ...context.repo,
        pull_number: context.payload.pull_request.number,
        title: newTitle,
      })
    }

    if (failIfNoIssues && !allIssues.length) {
      core.setFailed('No linked issues found')
    }

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
      core.info(`Found issue ${issue} in commit message`)
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
    core.info(`Found issue ${issue} in body`)
  }
  return bodyIssues
}

async function extractAllDependencyIssues(github: InstanceType<typeof GitHub>, composerMatch: string): Promise<string[]> {
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

  const allDependencIssues = []
  for (const file of files.data) {
    if (!minimatch(file.filename, composerMatch, { matchBase: false })) {
      continue
    }

    core.debug(`Found file ${file.filename} changed in PR matching glob ${composerMatch} for composer`)

    const loadDependencies = await extractFromPackageManager(github, base, file.filename, head, file.filename)
    for (const issue of loadDependencies) {
      core.info(`Found issue ${issue} in dependency`)
      allDependencIssues.push(issue)
    }
  }

  return allDependencIssues
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

async function extractFromPackageManager(github: InstanceType<typeof GitHub>, baseSha: string, baseFileName: string, headSha: string, headFileName: string): Promise<string[]> {
  core.debug(`Base sha: ${baseSha} and file name: ${baseFileName}`)
  core.debug(`Head sha: ${headSha} and file name: ${headFileName}`)

  let baseContent: ComposerLock | null = null
  try {
    const baseContentData = await github.rest.repos.getContent({
      headers: {
        Accept: 'application/vnd.github.v3.raw'
      },
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: baseFileName,
      ref: baseSha
    })

    if (!baseContentData.data) {
      core.debug(`No content found for ${baseFileName}`)
      return []
    }

    baseContent = JSON.parse(baseContentData.data.toString()) as ComposerLock
  } catch (error) {
    core.debug(`Base file ${baseFileName} not found. Error: ${error}`)
  }


  let headContent: ComposerLock | null = null
  try {
    const headContentData = await github.rest.repos.getContent({
      headers: {
        Accept: 'application/vnd.github.v3.raw'
      },
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: headFileName,
      ref: headSha
    })

    if (!headContentData.data) {
      core.debug(`No content found for ${headFileName}`)
      return []
    }

    headContent = JSON.parse(headContentData.data.toString()) as ComposerLock
  } catch (error) {
    core.debug(`Head file ${headFileName} not found. Error: ${error}`)
  }

  if (!baseContent || !headContent) {
    return []
  }

  const previousDependencies: { [key: string]: string } = {}
  for (const dependency of baseContent.packages) {
    if (dependency.source.type !== 'git') {
      continue
    }

    previousDependencies[dependency.source.url] = dependency.source.reference
  }

  core.debug(`Previous dependencies: ${JSON.stringify(previousDependencies)}`)

  const newDependencies: { [key: string]: string } = {}
  for (const dependency of headContent.packages) {
    if (dependency.source.type !== 'git') {
      continue
    }

    newDependencies[dependency.source.url] = dependency.source.reference
  }

  core.debug(`New dependencies: ${JSON.stringify(newDependencies)}`)

  const changedDependencies = Object.keys(newDependencies).filter(key => previousDependencies[key] !== newDependencies[key])

  core.debug(`Changed dependencies: ${JSON.stringify(changedDependencies)}`)

  const changedDependenciesIssues = []
  for (const dependency of changedDependencies) {

    const previousSha = previousDependencies[dependency]
    const newSha = newDependencies[dependency]

    if (!previousSha) {
      core.debug(`No previous sha found for ${dependency}. Skip. Ignore new dependency`)
      continue
    }

    const dependencyIssues = await extractFromGitHub(github, dependency, previousSha, newSha)
    for (const issue of dependencyIssues) {
      changedDependenciesIssues.push(issue)
    }
  }

  return changedDependenciesIssues
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

  const match = /(github\.com:){0,1}(?<owner>[^:]*)\/(?<repo>[^.]*)(.git){0,1}$/.exec(repo)
  if (!match || !match.groups) {
    core.debug(`Invalid repo ${repo}`)
    return []
  }

  const ownerName = match.groups.owner
  const repoName = match.groups.repo

  core.debug(`Owner: ${ownerName}`)
  core.debug(`Repo: ${repoName}`)
  core.debug(`Base sha: ${baseSha}`)
  core.debug(`Head sha: ${headSha}`)

  const allCommitIssues = []

  try {
    const commits = await github.rest.repos.compareCommits({
      owner: ownerName,
      repo: repoName,
      base: baseSha,
      head: headSha
    })

    core.debug(`Found ${commits.data.commits.length} commits in repo ${repo}`)

    for (const commit of commits.data.commits) {
      core.debug(`Found related commit ${commit.sha} in repo ${repo}`)

      const commitMessage = commit.commit.message
      const commitIssues = await readAllIssues(commitMessage || '')
      for (const issue of commitIssues) {
        allCommitIssues.push(issue)
        core.debug(`Found issue ${issue} in related commit message from repo ${repo}`)
      }
    }
  } catch (error) {
    core.debug(`error: ${error}`)
    throw error
  }

  return allCommitIssues
}


run()
