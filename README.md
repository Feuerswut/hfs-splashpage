# hfs-splashpage

Display a splash page before users can access your site.

Visitors get an interstitial page until they accept; acceptance is remembered in a cookie.
Which requests are covered is decided by a rule list.

## Rules

One list, evaluated **lowest priority first**, and the **first match decides**. A request
that matches nothing falls back to `Apply To Paths` — by default, it gets the splash page.

| Field | Meaning |
|---|---|
| Prio | Evaluation order, ascending. See below. |
| Name | Free text, for your own benefit. |
| Pattern | Regular expression, case-insensitive. A literal string under `Query param`. |
| Match | What the pattern is tested against. See below. |
| Rule | `Allow` skips the splash, `Deny` forces it, `Disabled` ignores the row. |

### What a rule matches against

For `GET https://feuerswut.de/res/x.css?v=2`, on a domain that HFS `roots` maps to the
folder `/feuerswut.de`:

| Match | Subject | Example |
|---|---|---|
| `Path` | What the visitor asked for. Query string removed, `.` `..` `//` normalized away, **no** root folder. | `/res/x.css` |
| `VFS path` | The same request as HFS resolved it, root folder included. | `/feuerswut.de/res/x.css` |
| `Full URL` | The whole original address, untouched. | `https://feuerswut.de/res/x.css?v=2` |
| `Query param` | The query parameters, compared literally — not a regex. | `v=2` |

`Path` is the default and is what you want almost every time: it is the URL as it appears
in the address bar, so a rule written for one domain keeps working on another even when
the two are rooted at different folders. `VFS path` is the subject earlier versions used,
and is the one to pick when a rule is really about where the file lives on the server.

`Query param` takes a literal `name=value` that has to equal one whole parameter, or a bare
`name` to match that parameter whatever its value — which is the useful form for share
links, whose value differs every time:

| Pattern | `?sharelink=abc` | `?token=AbC` | `?sharelinkX=1` |
|---|---|---|---|
| `sharelink` | matches | no | no |
| `token=AbC` | no | matches | no |
| `token=abc` | no | **no** — values are case-sensitive | no |

Parameter *names* are compared case-insensitively, values exactly. Nothing needs escaping,
so `weird[=x` is a perfectly good pattern here even though it is not a valid regex.

### The grid is kept in evaluation order

Rules run by ascending priority, and the stored list is re-sorted into that order every
time it changes, so the grid always reads top to bottom the way it runs. Reordering is
therefore done by editing a number, not by dragging.

If two rows end up sharing a priority, the one that was lower in the grid is bumped by one
— `5, 20, 20, 999` becomes `5, 20, 21, 999`. The tie-break was already resolved that way
internally; writing it back just makes it visible. Leave a number blank and it counts as
`100`. Reopen the dialog after saving to see the new order.

### Patterns match the whole subject

A pattern has to match the subject from beginning to end — it is not a search. This is the
single most common source of surprises, so it is worth being explicit:

| Pattern | `/s/files` | `/s/files/a.txt` |
|---|---|---|
| `/s/files` | matches | **no** |
| `/s/files/.*` | no | matches |
| `/s/files(/.*)?` | matches | matches |
| `.*/s/files.*` | matches | matches |

If you want the old "match anywhere" behaviour for one rule, wrap it yourself: `.*(?:X).*`.

`Full URL` rules almost always need that wrap, because they target a fragment of the URL
rather than the whole of it — e.g. `.*\?sharelink=[^&]+`. For query parameters specifically,
reach for `Query param` instead: that same rule is just `sharelink`, with no wrap, no escapes
and no risk of the `.*` on either end matching more than you meant.

Query rules are exempt from all of this, being literals rather than patterns.

### Which way round the list works

`Apply To Paths` decides what happens to a request no rule matched, and so decides what kind
of list you are writing:

- **Run on all paths** (default) — everything is covered and each `Allow` rule carves out an
  exception. A **deny-list**.
- **Run on no paths (whitelist)** — nothing is covered until a `Deny` rule says so. An
  **allow-list**, for gating a handful of landing pages and leaving assets, downloads and API
  endpoints alone:

| Prio | Pattern | Rule |
|---|---|---|
| 10 | `/` | Deny |
| 20 | `/s/[^/]+/?` | Deny |

Earlier versions had no such setting and the same thing was done by parking a catch-all
`Allow` on `.*` at priority 999. That still works; the setting is just the honest way to say
it, and it cannot be shadowed by a rule you add later.

## Domains

`Show Splash Page` does the same job one level up — it says what a domain that is **not** in
the `Domains` list gets, and thereby what that list means:

- **On all domains** (default) — every domain is covered, and the list is an exception list.
- **On no domains** — no domain is covered, and the list is a whitelist.
- **Plugin disabled** — nothing runs at all, and the rest of the form is hidden.

Patterns are matched against the `Host` header with the port stripped, and have to match the
whole host name: `feuerswut\.de` matches but `feuerswut` does not, and does not cover
`sub.feuerswut.de` either — write `(.*\.)?feuerswut\.de` for that. A disabled row counts as
not listed, whichever way round the list is being read.

## Other options

- **Skip Splash for WebDAV Clients** — on by default, and worth leaving on. A mounted drive
  cannot show an interstitial: the splash page would arrive as the *content* of every file
  and directory the client asked for, so the mount looks like it is full of identical HTML.
  See below for what counts as WebDAV.
- **Log Every Decision** — writes one line per request into the log panel of this dialog,
  naming the rule that decided it. Noisy; for troubleshooting only.
- **Cookie Name / Duration** — how acceptance is remembered.
- **Use Custom HTML File** — replaces the bundled page. The path field has a browse button
  that opens HFS's server-side file picker, starting at the bundled `public/index.html` so
  you can find the file to copy. The file is re-read on every request, so edits appear
  without reloading the plugin; if it cannot be read the bundled page is served instead and
  the reason is logged. `{{COOKIE_NAME}}` and `{{COOKIE_DAYS}}` are substituted before it is
  served.

Requests to the admin panel (`/~`) are never covered. An accepted cookie wins over a `Deny`
rule, so a visitor who already accepted is not prompted again.

### How WebDAV is detected

This plugin is a middleware, and middlewares run *before* HFS decides whether a request is
WebDAV — so HFS's own answer is not available yet and the test has to be repeated here. A
request counts as WebDAV if any of these hold:

| Signal | |
|---|---|
| Method | `PROPFIND`, `MKCOL`, `MOVE`, `COPY`, `LOCK`, `UNLOCK`, `PROPPATCH` |
| Header | `Depth`, `Destination`, `Overwrite`, `Translate`, `If`, `Lock-Token`, `X-Expected-Entity-Length` |
| `OPTIONS` probe | an `OPTIONS` request without `Access-Control-Request-Method` — i.e. not a browser CORS preflight |
| User agent | a known client: Windows miniredir, davfs, Cyberduck, WinSCP, Nextcloud, Cadaver, GVFS and similar |

The first two rows are exactly what HFS itself checks. The last two are added on top: a mount
begins with an `OPTIONS` probe carrying none of the above, so without it the very first
request of a mount would still get a page. They can be turned off by setting
`ADVANCED_WEBDAV_DETECTION` to `false` at the top of `init` in `plugin.js`; setting
`DEBUG_WEBDAV` to `true` next to it logs the verdict and the reason for every request.

## Narrow windows

Both grids shed columns as the dialog gets smaller, rather than turning into a sideways
scroll. `Rules` drops `Match`, then `Pattern`, then `Prio`, then `Rule`; `Domains` drops
`Pattern`, then `Enabled`. Either way you are left with `Name`.

Most of what goes is not lost — a dropped column is re-rendered inside the `Name` cell
underneath the name, so the narrowest rule row still reads:

```
robots.txt
10  allow  path
```

The one exception is the rule `Pattern`. A regex is long enough to wrap over several lines
at that width and would push the priority and the action out of sight, so it is simply
dropped; host patterns are kept, being a plain domain and the only thing on that row worth
seeing.

Editing is unaffected — the row dialog always shows every field.

## Upgrading from 0.6 and earlier

The old `Enabled` switch, `Selected Hosts`, `Path Exceptions` and `Full URL Exceptions` are
migrated automatically the first time 0.7 starts, and the old lists are then emptied. The
log panel records exactly what was carried over. The aim is that the upgrade changes nothing
about which requests get the splash page.

Path exceptions become `VFS path` rules rather than `Path` ones. They used to be tested
against the path HFS had already resolved, root folder included, and that subject is what
`VFS path` now means — carrying them to `Path` would break them on any domain with a root
folder. Rules you write yourself still default to `Path`.

Old patterns were matched with a *search* rather than a whole-subject match, so any pattern
not anchored at **both** ends is rewritten as `.*(?:X).*` to go on meaning what it did, and
the rewrite is logged so you can tighten it later. Only `^…$` patterns are carried untouched,
that being the one shape a search and a whole-subject match already agreed on. Anchoring one
end was never enough: `^/res/` meant "starts with", not "is".

Host patterns are the one deliberate change. They are carried across as they are, and now
have to match the whole host name — `feuerswut\.de` no longer covers `sub.feuerswut.de`.
Each one is logged with a reminder to check it.

The old on/off switch becomes the scope setting: off becomes **Plugin disabled**, an empty
host list becomes **On all domains**, and a host list becomes **On no domains** with that list
read as the whitelist — including a list whose entries were all switched off, which selected
nothing and so left the plugin idle. `Apply To Paths` stays at **Run on all paths**, which is
what 0.6 did. If you had no exceptions at all, the rule list starts empty rather than picking
up the default `robots.txt` rule a fresh install gets.

The migration lives in [`dist/migrate.js`](dist/migrate.js), ordered by config version, and
runs once — the stored `configVersion` is what decides, so it is safe across restarts and
reloads.
