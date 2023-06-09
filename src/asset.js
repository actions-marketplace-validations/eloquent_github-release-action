import { create as createGlob } from "@actions/glob";
import { readFile, stat } from "fs/promises";
import { lookup } from "mime-types";
import { basename } from "path";

export async function modifyReleaseAssets({
  config,
  error,
  group,
  info,
  owner,
  release,
  repo,
  repos,
  request,
  warning,
}) {
  const existingAssets = release.assets;
  const desiredAssets = await findAssets(info, warning, config.assets);

  if (existingAssets.length < 1 && desiredAssets.length < 1) {
    info("No release assets to modify");

    return [true, []];
  }

  return group("Modifying release assets", async () => {
    const { toUpload, toUpdate } = diffAssets(existingAssets, desiredAssets);

    info(`${toUpload.length} to upload, ${toUpdate.length} to update`);

    const [uploadResults, updateResults] = await Promise.all([
      Promise.allSettled(toUpload.map((desired) => uploadAsset(desired))),
      Promise.allSettled(
        toUpdate.map(([existing, desired]) => updateAsset(existing, desired))
      ),
    ]);

    const uploadResult = analyzeResults(uploadResults);
    const updateResult = analyzeResults(updateResults);

    logResults(
      info,
      error,
      uploadResult,
      "{successCount} uploaded, {failureCount} failed to upload"
    );
    logResults(
      info,
      error,
      updateResult,
      "{successCount} updated, {failureCount} failed to update"
    );

    const isSuccess = uploadResult.isSuccess && updateResult.isSuccess;
    const sortedAssets = [...uploadResult.assets, ...updateResult.assets].sort(
      compareApiAsset
    );

    return [isSuccess, sortedAssets];
  });

  async function deleteAsset(existing) {
    info(
      `Deleting existing release asset ${JSON.stringify(existing.name)} (${
        existing.id
      })`
    );

    await repos.deleteReleaseAsset({
      owner,
      repo,
      asset_id: existing.id,
    });
  }

  async function updateAsset(existing, desired) {
    await deleteAsset(existing);

    return uploadAsset(desired);
  }

  async function uploadAsset(desired) {
    const { upload_url: url } = release;
    const { label, name, path } = desired;
    const contentType = lookup(path);
    const data = await readFile(path);

    info(
      `Uploading release asset ${JSON.stringify(desired.name)} (${contentType})`
    );

    const { data: apiAsset } = await request({
      method: "POST",
      url,
      name,
      data,
      label,
      headers: {
        "Content-Type": contentType,
      },
    });

    const normalized = normalizeApiAsset(apiAsset);
    info(
      `Uploaded release asset ${JSON.stringify(desired.name)}: ${JSON.stringify(
        normalized,
        null,
        2
      )}`
    );

    return normalized;
  }
}

export async function findAssets(info, warning, assets) {
  const found = [];
  for (const asset of assets) found.push(...(await findAsset(info, asset)));

  const seen = new Set();

  return found.filter(({ name }) => {
    const lowercaseName = name.toLowerCase();

    if (!seen.has(lowercaseName)) {
      seen.add(lowercaseName);

      return true;
    }

    warning(
      `Release asset ${JSON.stringify(
        name
      )} found multiple times. Only the first instance will be used.`
    );

    return false;
  });
}

async function findAsset(info, asset) {
  const { path: pattern, optional: isOptional } = asset;
  const globber = await createGlob(pattern);
  const assets = [];

  for await (const path of globber.globGenerator()) {
    // ignore directories
    const stats = await stat(path);
    if (!stats.isDirectory()) assets.push({ path });
  }

  if (assets.length < 1) {
    const quotedPattern = JSON.stringify(pattern);

    if (isOptional) {
      info(
        `No release assets found for optional asset with path glob pattern ${quotedPattern}`
      );

      return [];
    }

    throw new Error(
      `No release assets found for mandatory asset with path glob pattern ${quotedPattern}`
    );
  }

  // name and label options only apply when the glob matches a single file
  if (assets.length > 1) return assets.map(normalizeAsset);

  const [{ path }] = assets;
  const { name, label } = asset;

  return [normalizeAsset({ label, name, path })];
}

function normalizeAsset(asset) {
  const { label = "", path, name } = asset;

  return {
    label,
    name: name || basename(path),
    path,
  };
}

function diffAssets(existingAssets, desiredAssets) {
  const toUpdate = [];
  const toUpload = [];

  for (const desired of desiredAssets) {
    const existing = existingAssets.find(
      (existing) => existing.name === desired.name
    );

    if (existing == null) {
      toUpload.push(desired);
    } else {
      toUpdate.push([existing, desired]);
    }
  }

  return {
    toUpdate,
    toUpload,
  };
}

function analyzeResults(results) {
  let isSuccess = true;
  let successCount = 0;
  const assets = [];
  let failureCount = 0;
  const failureReasons = [];

  for (const { status, value, reason } of results) {
    if (status === "fulfilled") {
      ++successCount;
      assets.push(value);
    } else {
      isSuccess = false;
      ++failureCount;
      failureReasons.push(reason);
    }
  }

  return {
    isSuccess,
    successCount,
    assets,
    failureCount,
    failureReasons,
  };
}

async function logResults(info, error, result, messageTemplate) {
  const { successCount, failureCount, failureReasons } = result;
  const message = messageTemplate
    .replace("{successCount}", successCount)
    .replace("{failureCount}", failureCount);

  if (failureCount > 0) {
    info(`${message}:`);
    for (const reason of failureReasons) error(reason.stack);
    info("");
  } else {
    info(message);
  }
}

function normalizeApiAsset(apiAsset) {
  const {
    url: apiUrl,
    browser_download_url: downloadUrl,
    id,
    node_id: nodeId,
    name,
    label,
    state,
    content_type: contentType,
    size,
    download_count: downloadCount,
    created_at: createdAt,
    updated_at: updatedAt,
  } = apiAsset;

  return {
    apiUrl,
    downloadUrl,
    id,
    nodeId,
    name,
    label,
    state,
    contentType,
    size,
    downloadCount,
    createdAt,
    updatedAt,
  };
}

function compareApiAsset(a, b) {
  return a.name.localeCompare(b.name);
}
