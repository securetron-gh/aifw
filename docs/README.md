# AI-FW Knowledge Base

The AI-FW documentation, organized by section. The rendered version lives at
[aifw.io/docs](https://aifw.io/docs); this folder mirrors it as Markdown.

## Sections

1. [Getting Started](getting-started/README.md) - what AI-FW is, and the quick start
2. [Guides](guides/README.md) - deep dives into each capability
3. [Solutions](solutions/README.md) - problem-first recipes for common AI governance tasks
4. [Tutorials](tutorials/README.md) - hands-on walkthroughs
5. [How-To](how-to/README.md) - focused recipes for admin tasks
6. [API Reference](api-reference/README.md) - endpoints and protocols
7. [Admin Reference](admin/README.md) - every admin page and its options
8. [Community Edition](community-edition/README.md) - the free edition license and monthly token allowance

## Editing

Each page is an MDX file with `title`, `description`, and `order` frontmatter.
The `NN-` prefix on filenames controls ordering within a section. Pages are
rendered at `https://aifw.io/docs/<section>/<slug>`.

See the website repository (`aifw-website`, `src/content/docs/`) for the source
of truth, which regenerates this content.
