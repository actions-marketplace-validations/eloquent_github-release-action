import { createProcessor } from "./markdown.js";
import { GENERATED_RELEASE_NOTES, TAG_BODY_RENDERED } from "./outputs.js";

export async function renderReleaseBody({
  config,
  env,
  group,
  info,
  owner,
  repo,
  repos,
  setOutput,
  tag,
  tagBody,
}) {
  const parts = [];

  if (tagBody.trim() !== "") {
    const renderedTagBody = await group(
      "Rendering tag annotation body",
      async () => {
        const process = createProcessor();
        const processed = (await process(tagBody)).trim();
        info(processed);

        return processed;
      }
    );

    setOutput(TAG_BODY_RENDERED, renderedTagBody);
    parts.push(renderedTagBody);
  }

  if (config.generateReleaseNotes) {
    const releaseNotes = await group(
      "Rendering automatically generated release notes",
      async () => {
        const {
          data: { body },
        } = await repos.generateReleaseNotes({ owner, repo, tag_name: tag });
        info(body);

        return body;
      }
    );

    setOutput(GENERATED_RELEASE_NOTES, releaseNotes);

    if (parts.length > 0) parts.push("");
    parts.push(releaseNotes);
  }

  // GitHub renders unaccompanied HTML comments as plaintext, so skip the attribution
  if (parts.length > 0) {
    parts.push("", `<!-- published by ${env.GITHUB_ACTION_REPOSITORY} -->`);
  }

  return parts.join("\n");
}
