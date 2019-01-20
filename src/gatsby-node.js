const fetch = require(`node-fetch`)
const path = require(`path`)
const Dropbox = require(`dropbox`).Dropbox
const { createRemoteFileNode } = require(`gatsby-source-filesystem`)


const defaultOptions = {
  path: ``,
  recursive: true,
  extensions: [`.jpg`, `.png`, `.md`],
}


/**
 * Dropbox API calls
 */

async function getFolderId(dbx, path) {
  return dbx.filesGetMetadata({ path })
}

async function listFiles(dbx, path, recursive) {
  return dbx.filesListFolder({ path, recursive })
}

async function getTemporaryUrl(dbx, path) {
  return dbx.sharingGetSharedLinkFile({ path })
}

/**
 * Get the folder id from a path and then retrive and filter files
 */

async function getFiles(dbx, options) {
  let folderId = ``
  try {
    if (options.path !== ``) {
      const folder = await getFolderId(dbx, options.path)
      folderId = folder.id
    }
    const files = await listFiles(dbx, folderId, options.recursive)
    return files.entries.filter(entry => entry[`.tag`] === `file` && options.extensions.includes(path.extname(entry.name)))
  } catch (e) {
    console.warn(e.error)
    return []
  }
}

/**
 * Use filesystem to create remote file
 */

async function processRemoteFile(
  { dbx, datum, cache, store, createNode, touchNode, createNodeId }
) {
  let fileNodeID
  if (datum.internal.type === `DropboxNode`) {
    const remoteDataCacheKey = `dropbox-file-${datum.id}`
    const cacheRemoteData = await cache.get(remoteDataCacheKey)

    if (cacheRemoteData) {
      fileNodeID = cacheRemoteData.fileNodeID
      touchNode({ nodeId: cacheRemoteData.fileNodeID })
    }
    if (!fileNodeID) {
      try {
        const { url } = await getTemporaryUrl(dbx, datum.path)
        const ext = path.extname(datum.name)
        const fileNode = await createRemoteFileNode({
          url,
          store,
          cache,
          createNode,
          createNodeId,
          ext,
          name: path.basename(datum.name, ext),
        })
        if (fileNode) {
          fileNodeID = fileNode.id
          await cache.set(remoteDataCacheKey, { fileNodeID })
        }
      } catch (e) {
        console.log(`Error creating remote file`, e)
      }
    }
  }
  if (fileNodeID) {
    datum.localFile___NODE = fileNodeID
  }
  return datum
}

exports.sourceNodes = async (
  { actions: { createNode, touchNode }, store, cache, createNodeId },
  pluginOptions,
  ) => {
  const options = { ...defaultOptions, ...pluginOptions }
  const dbx = new Dropbox({ fetch, accessToken: options.accessToken })
  const files = await getFiles(dbx, options)
  Promise.all(
    files.map(async file => {
      const node = await processRemoteFile({
        datum: {
          id: file.id,
          parent: `__SOURCE__`,
          children: [],
          internal: {
            type: `DropboxNode`,
            contentDigest: file.content_hash,
          },
          name: file.name,
          path: file.path_display,
          lastModified: file.client_modified,
        },
        dbx,
        createNode,
        touchNode,
        store,
        cache,
        createNodeId,
      })
      createNode(node)
    }))
}
