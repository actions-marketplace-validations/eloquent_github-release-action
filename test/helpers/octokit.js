import {Octokit} from 'octokit'
import {dump, load} from 'js-yaml'

import {owner, repo} from './fixture-repo.js'
import {readRunId} from './gha.js'
import {readEmptyTreeHash} from './git.js'
import {sleep} from './timers.js'

let octokit

export function createOctokit () {
  if (octokit == null) octokit = new Octokit({auth: process.env.FIXTURE_GITHUB_TOKEN})

  return octokit
}

export async function createFile (branch, path, content) {
  const octokit = createOctokit()

  const {data} = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    branch,
    path,
    message: `Create ${path}`,
    content: Buffer.from(content).toString('base64'),
  })

  return data
}

export async function createOrphanBranch (branch) {
  const octokit = createOctokit()

  const {data: commit} = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: 'Create an empty initial commit',
    tree: await readEmptyTreeHash(),
  })

  const {data: ref} = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: commit.sha,
  })

  return {commit, ref}
}

export async function createOrphanBranchForCi (suffix, workflowSteps) {
  const {GITHUB_SHA: actionSha = 'main'} = process.env

  const branch = `ci-${readRunId()}-${suffix}`
  const {commit, ref} = await createOrphanBranch(branch)

  const workflow = dump({
    name: branch,
    on: {
      push: {
        tags: ['*'],
      },
    },
    jobs: {
      publish: {
        'runs-on': 'ubuntu-latest',
        name: 'Publish release',
        steps: [
          {
            name: 'Checkout',
            uses: 'actions/checkout@v2',
          },

          ...load(workflowSteps.replace('{action}', `eloquent/github-release-action@${actionSha}`)),
        ],
      },
    },
  })

  const workflowFile = await createFile(
    branch,
    `.github/workflows/publish-release.${branch}.yml`,
    workflow,
  )

  const headSha = workflowFile.commit.sha

  return {commit, headSha, ref, workflowFile}
}

export async function createTag(sha, tag, annotation) {
  const octokit = createOctokit()

  let targetSha = sha
  let object

  if (typeof annotation === 'string' && annotation.length > 0) {
    const {data} = await octokit.rest.git.createTag({
      owner,
      repo,
      type: 'commit',
      object: sha,
      tag,
      message: annotation,
    })

    object = data
    targetSha = object.sha
  }

  const {data: ref} = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/tags/${tag}`,
    sha: targetSha,
  })

  return {object, ref}
}

export async function getReleaseByTag (tag) {
  const octokit = createOctokit()

  const {data} = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag,
  })

  return data
}

/**
 * This function is a mess. Originally I was trying to use GitHub's API in a
 * "sane" way, searching only for workflow runs related to each specific tag,
 * using query parameters that made sense, restricting the results to completed
 * runs, etc.
 *
 * Unfortunately, GitHub's API starting omitting workflow runs when specifying
 * simple filters like "status=completed" - including workflow runs that
 * definitely matched the filters. No idea why this should be the case. So
 * instead, I was forced to use a unique workflow filename for each test branch,
 * and manually filter the workflow runs myself.
 */
 export async function waitForCompletedTagWorkflowRun (fileName, tag) {
  const octokit = createOctokit()

  while (true) {
    await sleep(15 * 1000)

    let run

    try {
      const {data: {workflow_runs}} = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: fileName, // fileName does not include a path
        per_page: 1, // fileName is unique - there should only ever be one run
      })

      run = workflow_runs[0]
    } catch (error) {
      // handle 404s when the workflow has not yet been created
      if (error.status !== 404) throw error
    }

    // run has not yet been created
    if (run == null) continue

    const {
      event,
      head_branch: runTag, // note that GitHub also uses this property for the tag name in a tag push run
      status,
    } = run

    // skip incomplete or unrelated workflow runs
    if (event !== 'push' || status !== 'completed' || runTag !== tag) continue

    return run
  }
}
