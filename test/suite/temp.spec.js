import {readRunId} from '../helpers/gha.js'
import {createAnnotatedTag, createLightweightTag, createOrphanBranchForCi, waitForCompletedTagWorkflowRun} from '../helpers/octokit.js'

describe('Temporary', () => {
  it('should be able to create stuff', async () => {
    const tag = `0.1.0+ci-${readRunId()}-a`
    const {commit, ref, workflowFile} = await createOrphanBranchForCi('a')
    const headSha = workflowFile.data.commit.sha
    const annotatedTag = await createAnnotatedTag(headSha, tag, '0.1.0\nsubject-a\nsubject-b\n\nbody-a\nbody-b\n')
    // const lightweightTag = await createLightweightTag(headSha, `0.1.0+ci-${readRunId()}-b`)

    const {workflowRun, retryCount} = await waitForCompletedTagWorkflowRun('publish-release.yml', tag)

    console.log(JSON.stringify({workflowRun, retryCount}, null, 2))
  }, 5 * 60 * 1000)
})