const Promise = require("bluebird");
const path = require("path");
const execa = require("execa");

const { FEATURE_FLAGS } = require("./buildHelpers/env");
const {
  createContentfulPages,
} = require("./buildHelpers/createContentfulPages");
const { createContentfulBlog } = require("./buildHelpers/createContentfulBlog");
const {
  createContentfulNewsletter,
} = require("./buildHelpers/createContentfulNewsletter");
const {
  createMdxPages,
  queryFragment: mdxPagesFragment,
  getFileName,
  getLocale,
} = require("./buildHelpers/createMdxPages");
const {
  createProjectDirectory,
  queryFragment: projectDirectoryQueryFragment,
} = require("./buildHelpers/createProjectDirectory");
const {
  createDocsPages,
  queryFragment: docsQueryFragment,
} = require("./buildHelpers/createDocsPages");
const {
  contentfulLocale,
  defaultLocale,
  supportedLanguages,
} = require("./buildHelpers/i18n");

exports.onCreateNode = ({ node, actions }) => {
  const { createNodeField } = actions;
  const filename = getFileName(node);
  if (filename) {
    // For any MDX files, we want to know if they have a locale associated with
    // them. Pull it from the filename.
    const locale = getLocale(filename);
    createNodeField({
      node,
      name: "locale",
      value: locale,
    });
  }
  if (node.internal.type === "Mdx" && node.fileAbsolutePath) {
    const pathSegment = node.fileAbsolutePath.split("src/content")[1] || "";
    const value = path.parse(pathSegment).dir;
    if (!value) {
      return;
    }
    createNodeField({
      node,
      name: "path",
      value,
    });
  }
};

// Build an object of catalogs keyed by the locale string.
// This happens during preBootstrap;
let catalogs;

exports.createPages = async ({ graphql, actions }) => {
  const result = await graphql(
    `
      {
        ${mdxPagesFragment}
        allContentfulBlogPost {
          edges {
            node {
              title
              slug
              category
              updatedAt
            }
          }
        }
        allContentfulNewsletter {
          edges {
            node {
              slug
            }
          }
        }
        ${projectDirectoryQueryFragment}
        ${FEATURE_FLAGS.docs ? docsQueryFragment : ""}
      }
    `,
  );
  if (result.errors) {
    console.log(result.errors);
    return Promise.reject(result.errors);
  }

  const docs = result.data.docs.edges;
  createDocsPages({ actions, docs });
  return;

  const mdxFiles = result.data.mdxPages.edges;
  createMdxPages({ actions, mdxFiles, catalogs });

  const posts = result.data.allContentfulBlogPost.edges;
  createContentfulPages({ posts, actions, catalogs });
  createContentfulBlog({ posts, actions, catalogs });

  const newsletters = result.data.allContentfulNewsletter.edges;
  createContentfulNewsletter({ newsletters, actions, catalogs });

  const { totalCount: projectCount } = result.data.allContentfulProject;
  const byCategory = result.data.allContentfulProjectCategory;
  createProjectDirectory({ projectCount, byCategory, actions });
};

exports.onCreatePage = ({ page, actions }) => {
  const { createPage, deletePage } = actions;
  // All of our other page generation techniques attach a `locale` field to
  // page context, so if it's missing, we don't have translated versions yet.
  // Make locale pages for them, and replace the original with context.
  if (!page.context.locale) {
    deletePage(page);
    createPage({
      ...page,
      context: {
        locale: defaultLocale,
        urlPath: page.path,
        contentfulLocale: contentfulLocale[defaultLocale],
        lastModified: new Date().toISOString(),
        // List alternate pages so we can include head <link>s to them
        alternateUrls: supportedLanguages
          .filter((l) => l !== defaultLocale)
          .map((l) => ({
            locale: l,
            path: `/${l}${page.path}`,
          })),
      },
    });
    supportedLanguages.forEach((locale) => {
      createPage({
        ...page,
        path: `/${locale}${page.path}`,
        context: {
          ...page.context,
          locale,
          urlPath: page.path,
          contentfulLocale: contentfulLocale[locale],
          lastModified: new Date().toISOString(),
          // List alternate pages so we can include head <link>s to them
          alternateUrls: supportedLanguages
            .filter((l) => l !== locale)
            .map((l) => ({
              locale: l,
              path: l === defaultLocale ? page.path : `/${l}${page.path}`,
            })),
        },
      });
    });
  }
};

// Enable absolute imports from `src/`
exports.onCreateWebpackConfig = ({ actions }) => {
  actions.setWebpackConfig({
    resolve: {
      modules: ["node_modules", "src"],
    },
  });
};

// Build lingui catalogs
exports.onPreBootstrap = async () => {
  console.log("[i18n] Building Lingui catalogs…");
  await execa("yarn", ["compile-i18n"]);
  console.log("[i18n] Done!");

  catalogs = supportedLanguages.reduce((accum, locale) => {
    accum[locale] = require(`./src/locale/${locale}/messages.js`);
    return accum;
  }, {});
};
