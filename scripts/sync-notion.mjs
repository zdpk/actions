#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@notionhq/client'
import { NotionToMarkdown } from 'notion-to-md'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function die(msg) {
  console.error(`[sync-notion] ${msg}`)
  process.exit(1)
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

function getPlainText(richItems = []) {
  return richItems.map((r) => r.plain_text || '').join('')
}

function frontmatter(data) {
  const esc = (v) => String(v ?? '').replace(/"/g, '\\"')
  const lines = [
    '---',
    `title: "${esc(data.title)}"`,
    data.slug ? `slug: "${esc(data.slug)}"` : null,
    data.date ? `date: "${esc(data.date)}"` : null,
    data.updated ? `updated: "${esc(data.updated)}"` : null,
    data.notion_id ? `notion_id: "${esc(data.notion_id)}"` : null,
    '---',
    '',
  ].filter(Boolean)
  return lines.join('\n')
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function fileChanged(file, nextContent) {
  try {
    const prev = await fs.readFile(file, 'utf8')
    return prev !== nextContent
  } catch (e) {
    return true
  }
}

async function main() {
  const env = process.env
  const NOTION_DATABASE_ID = env.NOTION_DATABASE_ID
  const NOTION_TOKEN = env.NOTION_TOKEN
  const DEST_DIR = env.DEST_DIR || 'content/posts'
  const SLUG_PROPERTY = env.SLUG_PROPERTY || 'Slug'
  const TITLE_PROPERTY = env.TITLE_PROPERTY || 'Name'
  const PUBLISHED_PROPERTY = env.PUBLISHED_PROPERTY || ''
  const DRAFT_PROPERTY = env.DRAFT_PROPERTY || ''
  const STATUS_PROPERTY = env.STATUS_PROPERTY || ''
  const PUBLISHED_STATUS_NAME = env.PUBLISHED_STATUS_NAME || 'Published'
  const DRAFT_STATUS_NAME = env.DRAFT_STATUS_NAME || 'Draft'
  const SYNC_PROPERTY = env.SYNC_PROPERTY || ''
  const TAGS_PROPERTY = env.TAGS_PROPERTY || ''
  const CATEGORY_PROPERTY = env.CATEGORY_PROPERTY || ''
  const EXCERPT_PROPERTY = env.EXCERPT_PROPERTY || ''
  const COVER_URL_PROPERTY = env.COVER_URL_PROPERTY || ''
  const DATE_PROPERTY = env.DATE_PROPERTY || ''
  const FILENAME_PROPERTY = env.FILENAME_PROPERTY || ''
  const AUTHOR_PROPERTY = env.AUTHOR_PROPERTY || ''
  const DRY_RUN = String(env.DRY_RUN || 'false').toLowerCase() === 'true'

  if (!NOTION_DATABASE_ID) die('Missing NOTION_DATABASE_ID')
  if (!NOTION_TOKEN && !DRY_RUN) die('Missing NOTION_TOKEN')

  const absDest = path.resolve(process.cwd(), DEST_DIR)
  await ensureDir(absDest)

  let created = 0, updated = 0, unchanged = 0, total = 0

  if (DRY_RUN) {
    // Minimal dry-run to check write/update logic
    const now = new Date().toISOString()
    const items = [
      { id: 'dry_1', title: 'Hello Dry Run', slug: 'hello-dry-run', date: now, updated: now, content: '# Hello Dry Run\n\nSample content.' },
      { id: 'dry_2', title: 'Second Post', slug: 'second-post', date: now, updated: now, content: 'Content 2' },
    ]
    for (const it of items) {
      total++
      const fm = frontmatter({ title: it.title, slug: it.slug, date: it.date, updated: it.updated, notion_id: it.id })
      const body = `${fm}${it.content}\n`
      const file = path.join(absDest, `${it.slug}.mdx`)
      if (await fileChanged(file, body)) {
        await fs.writeFile(file, body, 'utf8')
        if ((await fs.stat(file)).size === body.length) created++
        else updated++
      } else {
        unchanged++
      }
    }
  } else {
    const notion = new Client({ auth: NOTION_TOKEN })
    const n2m = new NotionToMarkdown({ notionClient: notion })

    let cursor = undefined
    do {
      const resp = await notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
      })
      for (const page of resp.results) {
        total++
        const props = page.properties || {}

        // Optional gating: Sync checkbox
        if (SYNC_PROPERTY && props[SYNC_PROPERTY] && props[SYNC_PROPERTY].type === 'checkbox') {
          if (!props[SYNC_PROPERTY].checkbox) continue
        }

        // Optional publish filter (checkbox or status select)
        if (PUBLISHED_PROPERTY && props[PUBLISHED_PROPERTY] && props[PUBLISHED_PROPERTY].type === 'checkbox') {
          if (!props[PUBLISHED_PROPERTY].checkbox) continue
        } else if (STATUS_PROPERTY && props[STATUS_PROPERTY] && props[STATUS_PROPERTY].type === 'select') {
          const s = props[STATUS_PROPERTY].select ? props[STATUS_PROPERTY].select.name : undefined
          if (s && s !== PUBLISHED_STATUS_NAME) continue
        }

        let title = ''
        const titleProp = props[TITLE_PROPERTY]
        if (titleProp && titleProp.type === 'title') {
          title = getPlainText(titleProp.title)
        } else {
          title = 'Untitled'
        }

        let slug = ''
        const slugProp = props[SLUG_PROPERTY]
        if (slugProp && (slugProp.type === 'rich_text' || slugProp.type === 'title')) {
          slug = slugify(getPlainText(slugProp[slugProp.type]))
        } else if (slugProp && slugProp.type === 'url' && slugProp.url) {
          slug = slugify(slugProp.url)
        } else {
          slug = slugify(title)
        }

        // Optional filename override
        if (FILENAME_PROPERTY && props[FILENAME_PROPERTY]) {
          const fp = props[FILENAME_PROPERTY]
          if (fp.type === 'rich_text') slug = slugify(getPlainText(fp.rich_text)) || slug
          else if (fp.type === 'title') slug = slugify(getPlainText(fp.title)) || slug
          else if (fp.type === 'url' && fp.url) slug = slugify(fp.url) || slug
        }

        // Extract optional metadata
        const draft = (function () {
          if (DRAFT_PROPERTY && props[DRAFT_PROPERTY] && props[DRAFT_PROPERTY].type === 'checkbox') {
            return !!props[DRAFT_PROPERTY].checkbox
          }
          if (PUBLISHED_PROPERTY && props[PUBLISHED_PROPERTY] && props[PUBLISHED_PROPERTY].type === 'checkbox') {
            return !props[PUBLISHED_PROPERTY].checkbox
          }
          if (STATUS_PROPERTY && props[STATUS_PROPERTY] && props[STATUS_PROPERTY].type === 'select') {
            const s = props[STATUS_PROPERTY].select ? props[STATUS_PROPERTY].select.name : undefined
            if (s === DRAFT_STATUS_NAME) return true
          }
          return undefined
        })()

        const tags = (function () {
          if (TAGS_PROPERTY && props[TAGS_PROPERTY] && props[TAGS_PROPERTY].type === 'multi_select') {
            return (props[TAGS_PROPERTY].multi_select || []).map((t) => t.name).filter(Boolean)
          }
          return undefined
        })()

        const category = (function () {
          if (CATEGORY_PROPERTY && props[CATEGORY_PROPERTY] && props[CATEGORY_PROPERTY].type === 'select') {
            return props[CATEGORY_PROPERTY].select ? props[CATEGORY_PROPERTY].select.name : undefined
          }
          return undefined
        })()

        const excerpt = (function () {
          if (EXCERPT_PROPERTY && props[EXCERPT_PROPERTY] && (props[EXCERPT_PROPERTY].type === 'rich_text')) {
            return getPlainText(props[EXCERPT_PROPERTY].rich_text)
          }
          return undefined
        })()

        const cover = (function () {
          if (COVER_URL_PROPERTY && props[COVER_URL_PROPERTY]) {
            const p = props[COVER_URL_PROPERTY]
            if (p.type === 'url' && p.url) return p.url
            if (p.type === 'files' && Array.isArray(p.files) && p.files.length > 0) {
              const f = p.files[0]
              if (f.type === 'external') return f.external.url
              if (f.type === 'file') return f.file.url
            }
          }
          return undefined
        })()

        const date = (function () {
          if (DATE_PROPERTY && props[DATE_PROPERTY] && props[DATE_PROPERTY].type === 'date') {
            const d = props[DATE_PROPERTY].date
            if (d) return d.start || d.end || page.created_time
          }
          return page.created_time
        })()

        const author = (function () {
          if (!AUTHOR_PROPERTY || !props[AUTHOR_PROPERTY]) return undefined
          const p = props[AUTHOR_PROPERTY]
          if (p.type === 'people') {
            const names = (p.people || []).map((u) => u.name).filter(Boolean)
            return names.length > 0 ? names : undefined
          }
          if (p.type === 'rich_text') {
            const t = getPlainText(p.rich_text)
            return t ? [t] : undefined
          }
          if (p.type === 'title') {
            const t = getPlainText(p.title)
            return t ? [t] : undefined
          }
          return undefined
        })()

        const mdBlocks = await n2m.pageToMarkdown(page.id)
        const md = n2m.toMarkdownString(mdBlocks)
        const content = [md.parent, ...(md.children || []).map((c) => c.parent)].filter(Boolean).join('\n\n')

        const fm = frontmatter({
          title,
          slug,
          date,
          updated: page.last_edited_time,
          notion_id: page.id,
          draft,
        })
        // Append optional fields after base frontmatter header
        const extraLines = []
        if (Array.isArray(tags)) extraLines.push(`tags: [${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`)
        if (category) extraLines.push(`category: "${category.replace(/"/g, '\\"')}"`)
        if (excerpt) extraLines.push(`excerpt: "${excerpt.replace(/"/g, '\\"')}"`)
        if (cover) extraLines.push(`cover: "${cover.replace(/"/g, '\\"')}"`)
        if (Array.isArray(author)) extraLines.push(`authors: [${author.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`)

        let body = fm
        if (extraLines.length > 0) {
          // insert after starting '---' lines: rebuild frontmatter with extras
          const parts = fm.split('\n')
          // parts: '---', title..., '---', ''
          const endIdx = parts.findIndex((l, i) => i > 0 && l.trim() === '---')
          const head = parts.slice(0, endIdx)
          const tail = parts.slice(endIdx)
          body = head.concat(extraLines, tail).join('\n')
        }
        body += `${content}\n`
        const file = path.join(absDest, `${slug}.mdx`)

        if (await fileChanged(file, body)) {
          const existed = await fs
            .stat(file)
            .then(() => true)
            .catch(() => false)
          await fs.writeFile(file, body, 'utf8')
          if (existed) updated++
          else created++
        } else {
          unchanged++
        }
      }
      cursor = resp.has_more ? resp.next_cursor : undefined
    } while (cursor)
  }

  console.log(`[sync-notion] total=${total} created=${created} updated=${updated} unchanged=${unchanged}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
