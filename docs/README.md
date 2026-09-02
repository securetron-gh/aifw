# AI-FW Knowledge Base

The AI-FW documentation, organized by section. The rendered version lives at
[aifw.io/docs](https://aifw.io/docs); this folder mirrors it as Markdown.

## Sections

1. [Getting Started](getting-started/README.md) - what AI-FW is, and the quick start
2. [Guides](guides/README.md) - deep dives into each capability
3. [Tutorials](tutorials/README.md) - hands-on walkthroughs
4. [How-To](how-to/README.md) - focused recipes for admin tasks
5. [API Reference](api-reference/README.md) - endpoints and protocols
6. [Admin Reference](admin/README.md) - every admin page and its options
7. [Community Edition](community-edition/README.md) - the free edition license and daily token allowance

## Editing

Each page is an MDX file with `title`, `description`, and `order` frontmatter.
The `NN-` prefix on filenames controls ordering within a section. Pages are
rendered at `https://aifw.io/docs/<section>/<slug>`.

See the website repository (`aifw-website`, `src/content/docs/`) for the source
of truth, which regenerates this content.
