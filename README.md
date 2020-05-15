# gatsby-source-dropbox [![npm version](https://badge.fury.io/js/gatsby-source-dropbox.svg)](https://badge.fury.io/js/gatsby-source-dropbox)

Source plugin for getting data from Dropbox account.

## Install

`npm install --save gatsby-source-dropbox`

## How to use

Configure the plugin

```javascript
// In your gatsby-config.js
plugins: [
  {
    resolve: `gatsby-source-dropbox`,
    options: {
      accessToken: `access-token`,
      extensions: ['.pdf', '.jpg', '.png', '.md'],
      path: '/path/to/folder',
      recursive: false,
      createFolderNodes: false,
    },
  },
]
```

#### Options

* **accessToken:** the token to use for querying dropbox. In order to get an access token you will need to create an app https://www.dropbox.com/developers/apps and generate one.
* **extensions:** list of extensions used to filter out results
* **path:** the folder to use to retrieve data. Defaults to '' which is the root of the dropbox project.
* **recursive:** use this to retrieve files from subdirectories as well
* **createFolderNodes** use this if you want see your nodes structured by the folders they where in

## How to query
### With `createFolderNodes: false`

The plugin provides some basic information of the remote files such as:

* **name** the filename,
* **path** the file path,
* **lastModified** the last modification date,

The plugin makes use of the create remote node API of gatsby to locally download all the files in order to use them with other transformer plugins such as gatsby-transformer-sharp for images or gatsby-transformer-remark for markdown files.

Example:

```graphql
query {
  allDropboxNode {
    edges {
      node {
        id
        name
        lastModified
        path
        localFile {
          childMarkdownRemark {
            html
          }
        }
      }
    }
  }
}
```

### With `createFolderNodes: true`

By setting this to true, you will get the following types in graphql:

```graphql
allDropboxFolder
allDropboxImage
allDropboxMarkdown
allDropboxNode # everything that's not one of the above, will be of this type
```

You can now easily query for files within a folder. Lets say you have a simple portfolio structured like this on your dropbox:

```markdown
.
+-- Project-01-Lorem-Name
|   +-- Description.md
|   +-- Gallery-Image-01.jpg
|   +-- Gallery-Image-02.jpg
+-- Project-02-Ipsum-Name
|   +--Description.md
|   +--Gallery-Image-01.jpg
|   +--Gallery-Image-02.jpg
```

You can now query like following in `gatsby-node.js` and create project pages with a corresponding template:

```graphql
query MyQuery {
  allDropboxFolder(filter: {name: {regex: "/Project/"}}) {
    group(field: name) {
      nodes {
        name
        dropboxImage {
          localFile {
            childImageSharp {
              fluid {
                src
              }
            }
          }
        }
        dropboxMarkdown {
          localFile {
            childMarkdownRemark {
              html
            }
          }
        }
      }
    }
  }
}
```


