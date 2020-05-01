const fetch = require(`node-fetch`)
const path = require(`path`)
const Dropbox = require(`dropbox`).Dropbox
const { createRemoteFileNode } = require(`gatsby-source-filesystem`)


const defaultOptions = {
  path: ``,
  recursive: true,
  extensions: [`.jpg`, `.png`, `.md`],
  createFolderNodes: true,
}

const TYPE_MARKDOWN = `dropboxMarkdown`
const TYPE_IMAGE = `dropboxImage`
const TYPE_FOLDER = `dropboxFolder`
const TYPE_DEFAULT = `dropboxNode`

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
 * Get the folder id from a path and then retrive and filter files
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
  if (datum.internal.type === TYPE_IMAGE || datum.internal.type === TYPE_MARKDOWN || datum.internal.type === TYPE_DEFAULT) {
    const remoteDataCacheKey = `dropbox-file-${datum.id}`
    const cacheRemoteData = await cache.get(remoteDataCacheKey)

    if (cacheRemoteData) {
      fileNodeID = cacheRemoteData.fileNodeID
      touchNode({ nodeId: cacheRemoteData.fileNodeID })
    }
    if (!fileNodeID) {
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

function extractFiles(data, options){
  return data.entries.filter(entry => entry[`.tag`] === `file` && options.extensions.includes(path.extname(entry.name)))
}

function extractFolders(data){
 return data.entries.filter(entry => entry[`.tag`] === `folder`)
}

function getNodeType(file, options) {
  let nodeType = TYPE_DEFAULT

  if(options.createFolderNodes) {
    const extension = path.extname(file.path_display)

    switch(extension) {
      case `.md`:
        nodeType = TYPE_MARKDOWN
        break
      case `.png` || `.jpg`:
        nodeType = TYPE_IMAGE
        break
      default:
        nodeType = TYPE_DEFAULT
        break
    }
  }

  return nodeType
}

function createNodeData(data, options) {
  const files = extractFiles(data, options)

  const fileNodes = files.map(file => {
    const data = {
      name: file.name,
      dbxPath: file.path_display,
      path: `root${file.path_display}`,
      directory: path.dirname(`root${file.path_display}`),
      lastModified: file.client_modified,
    }

    return {
      id: file.id,
      parent: `__SOURCE__`,
      children: [],
      internal: {
        type: getNodeType(file, options),
        contentDigest: JSON.stringify(data),
      },
      ...data,
    }
  })

  if(options.createFolderNodes) {
    const folders = extractFolders(data)
  
    const folderNodes = folders.map(folder => {
      const data = {
        name: folder.name,
        dbxPath: folder.path_display,
        path: `root${folder.path_display}`,
        directory: path.dirname(`root${folder.path_display}`),
      }

      return{
        id: folder.id,
        parent: `__SOURCE__`,
        children: [],
        internal: {
          type: TYPE_FOLDER,
          contentDigest: JSON.stringify(data),
        },
        ...data,
      }
    })
  
    // We need an extra folder for the home directory of the dropbox app
    folderNodes.push({
      id: `dropboxRoot`,
      parent: `__SOURCE__`,
      children: [],
      internal: {
        type: TYPE_FOLDER,
        contentDigest: JSON.stringify({ name: `root`, path: `root/`, folderPath: `root`,})
      },
      name: `root`,
      path: `root/`,
      folderPath: `root`,
    })

    const nodes = [...fileNodes, ...folderNodes]

    return nodes
  } else {
    return fileNodes
  }
}


exports.sourceNodes = async (
  { actions: { createNode, touchNode }, store, cache, createNodeId },
  pluginOptions,
  ) => {
  const options = { ...defaultOptions, ...pluginOptions }
  const dbx = new Dropbox({ fetch, accessToken: options.accessToken })
  const data = await getData(dbx, options)
  const nodeData = createNodeData(data, options)

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
    }))
}


exports.createSchemaCustomization = ({ actions, schema }) => {
  const { createTypes } = actions
  const typeDefs = [
    `type dropboxFolder implements Node {
      dropboxImage: [dropboxImage] @link(from: "path", by: "directory")
      dropboxMarkdown: [dropboxMarkdown] @link(from: "path", by: "directory")
    }
    `,
  ]
  createTypes(typeDefs)
}
