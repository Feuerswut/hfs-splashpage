# hfs-splashpage

Display a splash page before users can access your site.

Visitors get an interstitial page until they accept; acceptance is remembered in a cookie.
Which requests are covered is decided by a rule list.

## Rules

One list, evaluated **lowest priority first**, and the **first match decides**. A request
that matches nothing gets the splash page.

| Field | Meaning |
|---|---|
| Prio | Evaluation order, ascending. See below. |
| Name | Free text, for your own benefit. |
| Pattern | Regular expression, case-insensitive. |
| Match | `Path` (`/s/files/a.txt`) or `Full URL` (`https://host/s/files/a.txt?x=1`). |
| Rule | `Allow` skips the splash, `Deny` forces it, `Disabled` ignores the row. |

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
rather than the whole of it — e.g. `.*\?sharelink=[^&]+`.

### Allow-list vs deny-list

Unmatched requests get the splash, so a list of `Allow` rules is a **deny-list**: everything
is covered except what you carve out.

For an **allow-list**, put a catch-all `Allow` on `.*` at a high priority and the pages you
actually want gated above it as `Deny`:

| Prio | Pattern | Rule |
|---|---|---|
| 10 | `/` | Deny |
| 20 | `/s/[^/]+/?` | Deny |
| 999 | `.*` | Allow |

Because `Deny` sits above the catch-all, only the landing pages are gated while assets,
downloads and API endpoints pass straight through.

## Domains

`Show Splash Page` picks the scope:

- **On all domains** — every request is a candidate.
- **On no domains** — the plugin is idle.
- **Only on selected domains** — the `Domains` list applies. Patterns match the whole host
  name with the port stripped, so `feuerswut\.de` matches but `feuerswut` does not.

## Other options

- **Skip Splash for WebDAV Clients** — WebDAV cannot render an interstitial, so mounts would
  otherwise break. Detected from HFS itself plus the request method and user agent.
- **Log Every Decision** — writes one line per request into the log panel of this dialog,
  naming the rule that decided it. Noisy; for troubleshooting only.
- **Cookie Name / Duration** — how acceptance is remembered.
- **Use Custom HTML File** — replaces the bundled page. `{{COOKIE_NAME}}` and
  `{{COOKIE_DAYS}}` are substituted before it is served.

Requests to the admin panel (`/~`) are never covered. An accepted cookie wins over a `Deny`
rule, so a visitor who already accepted is not prompted again.

## Upgrading from 0.6 and earlier

The old `Enabled` switch, `Selected Hosts`, `Path Exceptions` and `Full URL Exceptions` are
migrated automatically the first time 0.7 starts, and the old lists are then emptied. The
log panel records exactly what was carried over.

Old patterns were matched with a *search* rather than a whole-subject match. To keep
behaviour identical, any pattern that was not already anchored — plus every Full URL rule —
is rewritten as `.*(?:X).*` during the migration, and the rewrite is logged so you can
tighten it later.

Path patterns that already began with `^` or `/` are carried over untouched, which means
they now mean what they look like. Watch for `/$` in particular: as a search it matched
*every path ending in a slash*, and after the upgrade it matches only the site root.
