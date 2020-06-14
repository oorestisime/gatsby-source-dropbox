const fetch = require(`node-fetch`)
const path = require(`path`)
const Dropbox = require(`dropbox`).Dropbox
const { createRemoteFileNode } = require(`gatsby-source-filesystem`)


const defaultOptions = {
  path: ``,
  recursive: true,
  createFolderNodes: false,
  extensions: [`.jpg`, `.png`, `.md`],
}

const NODE_TYPES = {
  MARKDOWN: `dropboxMarkdown`,
  IMAGE: `dropboxImage`,
  FOLDER: `dropboxFolder`,
  DEFAULT: `dropboxNode`,
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
  return dbx.filesGetTemporaryLink({ path })
}

/**
 * Get the folder id from a path and then retrieve and filter files
 */

async function getData(dbx, options) {
  let folderId = ``
  try {
    if (options.path !== ``) {
      const folder = await getFolderId(dbx, options.path)
      folderId = folder.id
    }
    const files = await listFiles(dbx, folderId, options.recursive)
    return files
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
  const isDbxRemoteNode = Object.values(NODE_TYPES).some(entry => entry === datum.internal.type) && datum.internal.type !== NODE_TYPES.FOLDER
  
  if (isDbxRemoteNode) {
    let isUpToDate
    const remoteDataCacheKey = `dropbox-file-${datum.id}`
    const cacheRemoteData = await cache.get(remoteDataCacheKey)

    if (cacheRemoteData) {
      isUpToDate = cacheRemoteData.contentDigest === datum.internal.contentDigest && true
      fileNodeID = cacheRemoteData.fileNodeID
      
      if(isUpToDate) {
        touchNode({ nodeId: cacheRemoteData.fileNodeID, contentDigest: datum.internal.contentDigest })
      }
    }

    const sourceRemoteFile = !fileNodeID || !isUpToDate && true

    if (sourceRemoteFile) {
      try {
        const url = await getTemporaryUrl(dbx, datum.dbxPath)
        const ext = path.extname(datum.name)
        const fileNode = await createRemoteFileNode({
          url: url.link,
          store,
          cache,
          createNode,
          createNodeId,
          ext,
          name: path.basename(datum.name, ext),
          parentNodeId: datum.id,
        })
        if (fileNode) {
          fileNodeID = fileNode.id
          await cache.set(remoteDataCacheKey, { fileNodeID, contentDigest: datum.internal.contentDigest })
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

/**
 * Helper functions for node creation
 */

function extractFiles(data, options){
  return data.entries.filter(entry => entry[`.tag`] === `file` && options.extensions.includes(path.extname(entry.name)))
}

function extractFolders(data){
 return data.entries.filter(entry => entry[`.tag`] === `folder`)
}

function getNodeType(file, options) {
  let nodeType = NODE_TYPES.DEFAULT

  if(options.createFolderNodes) {
    const extension = path.extname(file.path_display)

    switch(extension) {
      case `.md`:
        nodeType = NODE_TYPES.MARKDOWN
        break
      case `.png`:
        nodeType = NODE_TYPES.IMAGE
        break
      case `.jpg`:
        nodeType = NODE_TYPES.IMAGE
        break
      case `.jpeg`:
        nodeType = NODE_TYPES.IMAGE
        break
      default:
        nodeType = NODE_TYPES.DEFAULT
        break
    }
  }

  return nodeType
}

/**
 * Function to create linkable nodes
 */

function createNodeData(data, options, createContentDigest) {
  const files = extractFiles(data, options)

  const fileNodes = files.map(file => {
    const nodeDatum = {
      id: file.id,
      parent: `__SOURCE__`,
      children: [],
      dbxPath: file.path_display,
      path: `root${file.path_display}`,
      directory: path.dirname(`root${file.path_display}`),
      name: file.name,
      lastModified: file.client_modified,
    }
    return {
      ...nodeDatum,
      internal: {
        type: getNodeType(file, options),
        contentDigest: createContentDigest(nodeDatum),
      },
    }
  })

  if(options.createFolderNodes) {
    const folders = extractFolders(data)
  
    const folderNodes = folders.map(folder => {
      const nodeDatum = {
        id: folder.id,
        parent: `__SOURCE__`,
        children: [],
        dbxPath: folder.path_display,
        path: `root${folder.path_display}`,
        name: folder.name,
        directory: path.dirname(`root${folder.path_display}`),
      }
      return{
        ...nodeDatum,
        internal: {
          type: NODE_TYPES.FOLDER,
          contentDigest: createContentDigest(nodeDatum),
        },
      }
    })
  
    // Creating an extra node for the root folder
    const rootDatum = {
      id: `dropboxRoot`,
      parent: `__SOURCE__`,
      children: [],
      name: `root`,
      path: `root/`,
      folderPath: `root`,
    }
    folderNodes.push({
      ...rootDatum,
      internal: {
        type: NODE_TYPES.FOLDER,
        contentDigest: createContentDigest(rootDatum),
      },
    })

    const nodes = [...fileNodes, ...folderNodes]
    return nodes

  } else {
    return fileNodes
  }
}

exports.sourceNodes = async (
  { actions: { createNode, touchNode }, store, cache, createNodeId, createContentDigest },
  pluginOptions,
  ) => {
  const options = { ...defaultOptions, ...pluginOptions }
  const dbx = new Dropbox({ fetch, accessToken: options.accessToken })
  const data = await getData(dbx, options)
  const nodeData = createNodeData(data, options, createContentDigest)

  return Promise.all(
    nodeData.map(async nodeDatum => {
      const node = await processRemoteFile({
        datum: nodeDatum ,
        dbx,
        createNode,
        touchNode,
        store,
        cache,
        createNodeId,
      })
      createNode(node)
    })
  )
}

/**
 * Schema definitions to link files to folders
 */

exports.createSchemaCustomization = ({ actions }, pluginOptions) => {
  const options = { ...defaultOptions, ...pluginOptions }

  if(options.createFolderNodes) {
    const { createTypes } = actions
    const typeDefs = [
      `type dropboxImage implements Node {
        dbxPath: String,
        path: String,
        directory: String,
        name: String,
        lastModified: String,
      }`,
      `type dropboxMarkdown implements Node {
        dbxPath: String,
        path: String,
        directory: String,
        name: String,
        lastModified: String,
      }`,
      `type dropboxFolder implements Node {
        dropboxImage: [dropboxImage] @link(from: "path", by: "directory")
        dropboxMarkdown: [dropboxMarkdown] @link(from: "path", by: "directory")
      }`,
    ]
    createTypes(typeDefs)
  }
}
