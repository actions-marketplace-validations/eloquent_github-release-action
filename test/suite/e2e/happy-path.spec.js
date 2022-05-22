import escapeStringRegexp from 'escape-string-regexp'

import {
  buildBodyExpression,
  buildBranchName,
  buildTagName,
  buildWorkflow,
  describeOrSkip,
  SETUP_TIMEOUT,
} from '../../helpers/e2e.js'

import {owner, repo} from '../../helpers/fixture-repo.js'
import {readRunId} from '../../helpers/gha.js'

import {
  createBranchForCi,
  createTag,
  getReleaseByTag,
  listAnnotationsByWorkflowRun,
  listDiscussionsByCategory,
  waitForCompletedTagWorkflowRun,
} from '../../helpers/octokit.js'

describeOrSkip('End-to-end tests', () => {
  describe('Happy path', () => {
    const label = 'happy-path'
    const runId = readRunId()
    const branchName = buildBranchName(runId, label)
    const tagName = buildTagName('1.0.0', runId, label)
    const workflow = buildWorkflow(branchName, {
      'discussion-category': 'releases',
    })

    const tagAnnotation = `1.0.0
this
should
form
the
release
name

# Heading 1
## Heading 2

this
should
form
one
paragraph

#1
`

    const config = `assets:
  - path: assets/text/file-a.txt
  - path: assets/json/file-b.json
    name: custom-name-b.json
    label: Label for file-b.json, which will download as custom-name-b.json
  - path: assets/text/file-c.*.txt
    name: custom-name-c.txt
  - path: assets/json/file-d.*.json
`

    const files = [
      {
        path: '.github/release.eloquent.yml',
        content: config,
      },
      {
        path: 'assets/text/file-a.txt',
        content: 'file-a\n',
      },
      {
        path: 'assets/json/file-b.json',
        content: '{"file-b":true}\n',
      },
      {
        // makes a filename like "file-c.2572064453.txt"
        path: `assets/text/file-c.${Math.floor(Math.random() * 10000000000)}.txt`,
        content: 'file-c\n',
      },
      {
        path: 'assets/json/file-d.0.json',
        content: '{"file-d":0}\n',
      },
      {
        path: 'assets/json/file-d.1.json',
        content: '{"file-d":1}\n',
      },
    ]

    // points to a commit history with PRs for generating release notes
    const parentCommit = '4b8277d28bee33b7c323164b2f2750adf98917be'

    let workflowRun, annotations, release

    beforeAll(async () => {
      const {headSha, workflowFileName} = await createBranchForCi(branchName, workflow, {
        commit: parentCommit,
        files,
      })

      await createTag(headSha, tagName, tagAnnotation)

      workflowRun = await waitForCompletedTagWorkflowRun(workflowFileName, tagName)
      annotations = await listAnnotationsByWorkflowRun(workflowRun)
      release = await getReleaseByTag(tagName)

      if (release?.html_url != null) await page.goto(release?.html_url)
    }, SETUP_TIMEOUT)

    it('should produce a workflow run that concludes in success', () => {
      expect(workflowRun.conclusion).toBe('success')
    })

    it('should annotate the workflow run with a link to the release', () => {
      expect(annotations).toPartiallyContain({
        annotation_level: 'notice',
        title: `Released - ${release.name}`,
        message: `Created ${release.html_url}`,
      })
    })

    it('should produce a stable release', () => {
      expect(release.prerelease).toBe(false)
    })

    it('should produce a published release', () => {
      expect(release.draft).toBe(false)
    })

    it('should produce the expected release name', () => {
      expect(release.name).toBe('1.0.0 this should form the release name')
    })

    it.each`
      description              | expression
      ${'markdown heading 1'}  | ${`//h1[normalize-space()='Heading 1']`}
      ${'markdown heading 2'}  | ${`//h2[normalize-space()='Heading 2']`}
      ${'markdown paragraphs'} | ${`//*[normalize-space()='this should form one paragraph']`}
      ${'issue link'}          | ${`//a[@href='https://github.com/${owner}/${repo}/issues/1'][normalize-space()='#1']`}
    `('should produce the expected release body elements ($description)', async ({expression}) => {
      expect(await page.$x(buildBodyExpression(expression))).not.toBeEmpty()
    })

    it.each`
      name                    | size  | contentType           | label
      ${'file-a.txt'}         | ${7}  | ${'text/plain'}       | ${''}
      ${'custom-name-b.json'} | ${16} | ${'application/json'} | ${'Label for file-b.json, which will download as custom-name-b.json'}
      ${'custom-name-c.txt'}  | ${7}  | ${'text/plain'}       | ${''}
      ${'file-d.0.json'}      | ${13} | ${'application/json'} | ${''}
      ${'file-d.1.json'}      | ${13} | ${'application/json'} | ${''}
    `('should produce the expected release assets ($name)', ({name, size, contentType, label}) => {
      expect(release.assets).toPartiallyContain({
        state: 'uploaded',
        name,
        size,
        content_type: contentType,
        label,
      })
    })

    it('should create a linked discussion', async () => {
      let count = 0
      let match

      const pattern = new RegExp(
        `href="https:\/\/github\.com` +
        `\/${escapeStringRegexp(owner)}` +
        `\/${escapeStringRegexp(repo)}` +
        `\/releases\/tag\/${escapeStringRegexp(encodeURIComponent(tagName))}"`
      )
      console.log(String(pattern))

      for await (const discussion of listDiscussionsByCategory('releases')) {
        console.log(discussion)

        if (pattern.test(discussion.bodyHTML)) {
          match = discussion
          break
        }

        if (++count > 100) break
      }

      expect(match?.title).toBe(release.name)
    })
  })
})
