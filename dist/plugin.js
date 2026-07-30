// Plugin metadata HFS v3
exports.version = 0.7;
exports.description = "Display a splash page before users can access the site";
exports.apiRequired = 13;

exports.author = "feuerswut";
exports.repo = "feuerswut/hfs-splashpage"

// The config form and the plugin log sit side by side in a wrapping flex row.
// "maxWidth" is read by the admin panel and applied to the form alone, so it
// cannot cap the log -- only the dialog body can, which is what "width" is for.
// Capping both at the same 1250px keeps the form too wide for the log to fit
// beside it, so the log always wraps to the end instead of taking the right
// column, and the two panels line up at the same width.
//
// The nested rule clears the two min-widths the admin panel puts on that row:
// "min-content" on the form and "min(40em, 90vw)" on the log. Both are floors
// that survive a window being made narrow again -- the rule grid settles at
// whatever width it was widest at, and min-content then refuses to give it
// back, so the dialog overflows instead of shrinking. With the floors gone the
// row follows the viewport in both directions and the grid scrolls internally.
// "> * > *" is the form box and the log paper: they are the only two children
// of the flex row, which is itself the only child of the dialog body.
exports.configDialog = { sx: {
    width: 'min(85vw, 1250px)',
    maxWidth: '1250px',
    '& > * > *': { minWidth: '0 !important' },
} }

// Bringing an older stored config up to date lives entirely in its own file:
// all it leaves behind here is the legacy keys it needs in the config form and
// a single call from init(). Nothing in it runs per request.
const migration = require('./migrate')

// $hideUnder drops a column once the grid gets narrow, which is what keeps the
// rows from turning into a sideways scroll instead of shrinking. The number it
// compares against is the *grid's* measured width, not the window's, so the
// thresholds have to be converted: the grid sits in a dialog body that is 85vw
// wide (see configDialog) less its padding -- 24px a side from 600px up, 8px
// below that -- and a few px of form gutter. Hence the arithmetic. It is an
// estimate of the chrome, not a measurement, so if a column disappears a little
// earlier or later than you want, nudge the number in the call.
const gridAt = w => Math.round(0.85 * w - (w < 600 ? 24 : 56))

// A column that is hidden is not lost: $mergeRender on a column that is still
// visible re-renders the hidden one inside it, in a smaller font under the
// name. That is why both grids also get autoRowHeight -- the extra lines need
// somewhere to go.
//
// The rule grid deliberately leaves its pattern out of that: a regex is the one
// value here long enough to wrap over several lines at 400px, and it would push
// the short facts -- priority, action -- off the bottom of what you can read at
// a glance. Host patterns stay, being a plain domain and the only thing on that
// row worth seeing. Open the row to edit either way.
const MERGE_PATTERN = { fontFamily: 'monospace', width: '100%' }
const MERGE_TAG = { color: 'text.secondary', mr: 1 }

exports.config = {
    // The two scope settings are deliberately the same shape: each says what
    // happens to something nothing was said about, and each turns the list
    // under it into the opposite kind of list. Domains first, paths second --
    // a request has to get past the domain question before the rules are even
    // consulted.
    mode: {
        type: 'select',
        label: 'Show Splash Page',
        defaultValue: 'all',
        options: {
            "On all domains": 'all',
            "On no domains": 'none',
            "Plugin disabled": 'off',
        },
        helperText: "What a domain that is *not* in the list below gets. **On all domains** makes that list an exception list -- everything is covered except the domains you name. **On no domains** makes it a whitelist -- nothing is covered except the domains you name. **Plugin disabled** stops the plugin doing anything at all.",
    },
    hosts: {
        type: 'array',
        label: 'Domains',
        defaultValue: [],
        showIf: values => values.mode !== 'off',
        helperText: "Matched against the Host header with the port stripped. The pattern must match the whole host. Whether being listed here means covered or exempt is set by **Show Splash Page** above; either way, a disabled row counts as not listed.",
        autoRowHeight: true,
        fields: {
            name: {
                type: 'string',
                label: 'Name',
                $width: 3,
                // Name is the one flex column with a floor, because it is the
                // column that is always there and the grid's 50px default is
                // far below readable. 130 is set by the tightest band rather
                // than by the narrowest one: between the widths at which
                // Enabled and Pattern go, the row still has to hold name +
                // Enabled (100) + the actions column (90), and the floor has to
                // leave that under the grid width or it scrolls sideways at
                // exactly the size the hiding was meant to rescue.
                $column: { minWidth: 130 },
                $mergeRender: { pattern: MERGE_PATTERN, enabled: MERGE_TAG }
            },
            pattern: {
                type: 'string',
                label: 'Pattern (regex)',
                $width: 5,
                getError: v => {
                    if (!v) return "pattern is required"
                    try { new RegExp(v); return false }
                    catch (e) { return "invalid regex: " + e.message }
                },
                // No floor: pattern stays purely flexible so it gives ground
                // before anything else does, and the grid shrinks instead of
                // scrolling. It is also the first thing to be hidden outright,
                // so the squeezed state it can reach is short-lived.
                $hideUnder: gridAt(650)
            },
            enabled: {
                type: 'boolean',
                label: 'Enabled',
                defaultValue: true,
                $width: 100,
                $hideUnder: gridAt(420)
            }
        }
    },
    pathMode: {
        type: 'select',
        label: 'Apply To Paths',
        defaultValue: 'all',
        options: {
            "Run on all paths": 'all',
            "Run on no paths (whitelist)": 'none',
        },
        showIf: values => values.mode !== 'off',
        helperText: "What a request that matches no rule gets. **Run on all paths** is the usual way round: everything is covered, and each rule below carves out an exception. **Run on no paths** inverts it -- nothing is covered until a `Deny` rule says so, which is how you gate a handful of pages and leave the rest of the server alone. It replaces the old trick of parking a catch-all `.*` allow rule at priority 999.",
    },
    rules: {
        type: 'array',
        label: 'Rules',
        defaultValue: [
            { priority: 10, name: 'robots.txt', pattern: '.*/robots\\.txt', match: 'path', rule: 'allow' },
        ],
        showIf: values => values.mode !== 'off',
        helperText: "Evaluated low priority first; the first match decides. The list is re-sorted into that order when you save, and two rows sharing a number are separated by bumping the lower one, so what you see is what runs. **The pattern must match the whole subject**, so `/s/files` does not cover `/s/files/a.txt` -- write `/s/files(/.*)?` for that. A request that matches nothing falls back to **Apply To Paths** above.\n\nWhat the pattern is tested against depends on **Match**:\n- **Path** -- what the visitor asked for, with the query string removed, `.`/`..`/`//` normalized away, and *without* the per-domain root folder HFS prepends. `https://site.tld/res/x.css` is `/res/x.css` even when that domain is rooted at `/site.tld`.\n- **VFS path** -- the same request as HFS resolved it, root folder included: `/site.tld/res/x.css`. This is what earlier versions called Path.\n- **Full URL** -- the whole original address, scheme and host and query string included: `https://site.tld/?sharelink=abc`.\n- **Query param** -- *not* a regex. A literal `name=value` that has to equal one of the query parameters, or a bare `name` to match that parameter whatever its value. Names are compared case-insensitively, values exactly.",
        autoRowHeight: true,
        fields: {
            priority: {
                type: 'number',
                label: 'Prio',
                defaultValue: 100,
                min: 0,
                // Fixed pixels ($width >= 8). Sized to the header rather than
                // the value -- the grid prints the raw stored value, so these
                // three columns only ever have to hold "Prio"/"Match"/"Rule"
                // and a short word. Whatever they give up goes to Pattern,
                // which is the column that actually needs the room.
                $width: 56,
                $hideUnder: gridAt(500)
            },
            name: {
                type: 'string',
                label: 'Name',
                $width: 3,
                // Same reasoning as the host grid: the binding case is the band
                // where Prio is gone but Rule (98) is not, so name + 98 + the
                // actions column has to stay under the grid width.
                $column: { minWidth: 130 },
                // Order is display order, and it puts the priority next to the
                // action so the last thing left standing reads "10 allow path".
                // Pattern is deliberately absent -- see MERGE_PATTERN above.
                $mergeRender: { priority: MERGE_TAG, rule: MERGE_TAG, match: MERGE_TAG }
            },
            pattern: {
                type: 'string',
                label: 'Pattern',
                $width: 5,
                // The second argument carries the rest of the row, which is how
                // this can tell that a query rule is a literal string and must
                // not be rejected for being an invalid regex. Older admin
                // panels may not pass it -- then it just validates as before.
                getError: (v, o) => {
                    if (!v) return "pattern is required"
                    if (o && o.values && o.values.match === 'query') return false
                    try { new RegExp(v); return false }
                    catch (e) { return "invalid regex: " + e.message }
                },
                // Purely flexible, as in the host grid above.
                $hideUnder: gridAt(650)
            },
            match: {
                type: 'select',
                label: 'Match',
                defaultValue: 'path',
                options: {
                    "Path": 'path',
                    "VFS path": 'vfs',
                    "Full URL": 'url',
                    "Query param": 'query',
                },
                $width: 78,
                $hideUnder: gridAt(700)
            },
            rule: {
                type: 'select',
                label: 'Rule',
                defaultValue: 'allow',
                options: {
                    "Allow (no splash)": 'allow',
                    "Deny (splash)": 'deny',
                    "Disabled": 'disabled',
                },
                $width: 98,
                $hideUnder: gridAt(450)
            }
        }
    },
    ignoreWebdav: {
        type: 'boolean',
        label: 'Skip Splash for WebDAV Clients',
        defaultValue: true,
        showIf: values => values.mode !== 'off',
        helperText: "A mounted drive cannot show an interstitial: the splash page would arrive as the *content* of every file and directory the client asked for, so the mount looks like it is full of identical HTML. With this on, a request that looks like WebDAV is passed straight through.\n\nA request counts as WebDAV if it uses a WebDAV method (`PROPFIND`, `MKCOL`, `MOVE`, `COPY`, `LOCK`, `UNLOCK`, `PROPPATCH`), carries a WebDAV-only header (`Depth`, `Destination`, `Overwrite`, `Translate`, `If`, `Lock-Token`, `X-Expected-Entity-Length`), is a non-CORS `OPTIONS` probe, or comes from a known client user-agent. The first two are the same test HFS itself uses; the rest are added because this plugin runs *before* HFS gets to look at the request, so its own detection is not available yet.\n\nOnly turn this off if you have no WebDAV clients and want them gated too.",
    },
    debug: {
        type: 'boolean',
        label: 'Log Every Decision',
        defaultValue: false,
        showIf: values => values.mode !== 'off',
        helperText: "Writes one line per request to the log below, naming the rule that decided it. Noisy; for troubleshooting only.",
    },
    cookieName: {
        type: 'string',
        label: 'Cookie Name',
        defaultValue: 'example-splashpage',
        showIf: values => values.mode !== 'off'
    },
    cookieDays: {
        type: 'number',
        label: 'Cookie Duration (days)',
        defaultValue: 365,
        min: 1,
        showIf: values => values.mode !== 'off'
    },
    useCustomHTML: {
        type: 'boolean',
        label: 'Use Custom HTML File',
        defaultValue: false,
        showIf: values => values.mode !== 'off'
    },
    customHTMLPath: {
        // "real_path" is a plain string field with a browse button on the end,
        // opening the admin panel's server-side file picker. It hands back a
        // path relative to the server's working directory when the file is
        // under it and an absolute one otherwise -- which is exactly what
        // readFileSync resolves against, so either form works as stored.
        // The picker starts in the folder holding the bundled page rather than
        // the plugin root, because that is the file to copy and edit -- and
        // with the mask applied the plugin root shows no files at all.
        type: 'real_path',
        label: 'Custom HTML File Path',
        defaultValue: '',
        files: true,
        folders: false,
        fileMask: '*.html|*.htm',
        defaultPath: require('path').join(__dirname, 'public'),
        showIf: values => values.mode !== 'off' && values.useCustomHTML,
        helperText: "Read fresh on every request, so edits show up without reloading the plugin. If it cannot be read the bundled page is served instead and the reason is logged.",
    },

    // The legacy keys the upgrade reads, defined next to the code that reads
    // them. They hide themselves once emptied, so they only ever appear on an
    // install that has something left to carry over.
    ...migration.legacyConfig,
}

exports.init = api => {
    const fs = require('fs')
    const path = require('path')

    // --- Advanced options (not exposed in UI) ---
    const ADVANCED_WEBDAV_DETECTION = true  // also detect by user agent and by OPTIONS probe
    const DEBUG_WEBDAV = false              // log WebDAV detection details per request
    // --------------------------------------------

    const ADMIN_BASE = '/~'

    // WebDAV detection. HFS has its own -- webdav.ts computes
    //   isWebdavAuthRequest = WEBDAV_METHODS.has(ctx.method)
    //                      || WEBDAV_HINT_HEADERS.some(h => ctx.get(h))
    // and remembers the ip+user-agent of anything that asks that way -- but the
    // webdav middleware is mounted *after* pluginsMiddleware in HFS's chain, so
    // by the time it runs we have already decided whether to serve the splash
    // page. Nothing has been set on ctx yet, and ctx.state.webdavDetected does
    // not exist in HFS 3.1.0 at all. So the method and header lists below are
    // copies of HFS's, kept deliberately identical, and the rest is what we add
    // to make up for not having its per-client memory.
    const WEBDAV_METHODS = new Set(['PROPFIND', 'MKCOL', 'MOVE', 'LOCK', 'UNLOCK',
        // Not in HFS's list, but no browser sends them and no interstitial can
        // answer them, so treating them as WebDAV can only help.
        'COPY', 'PROPPATCH'])
    const WEBDAV_HEADERS = ['depth', 'destination', 'overwrite', 'translate', 'if',
        'lock-token', 'x-expected-entity-length']
    // HFS's own KNOWN_UA is /webdav|miniredir|davclnt/i; this is that plus the
    // clients that identify themselves by name instead.
    const WEBDAV_UA = /webdav|miniredir|davclnt|davfs|cyberduck|bitkinex|webdrive|netdrive|cadaver|konqueror\/|gvfs\/|sabredav|owncloud|nextcloud|winscp|goodsync/i

    const defaultHTMLPath = path.join(__dirname, 'public/index.html')
    let defaultHTML = '<html><body><h1>Error loading splash page</h1></body></html>'

    try {
        defaultHTML = fs.readFileSync(defaultHTMLPath, 'utf8')
    } catch (e) {
        api.log('Error loading index.html:', e.message)
    }

    // ---------------------------------------------------------------- matching

    // Patterns must match the whole subject. The old engine used a bare
    // RegExp.test(), which searches anywhere in the string -- that is how a
    // pattern like "/$", meant as "the site root", silently came to mean "any
    // path ending in a slash" and let every directory through.
    function compile(pattern) {
        return new RegExp('^(?:' + pattern + ')$', 'i')
    }

    // Resolves "." and ".." and collapses repeated slashes, so a rule cannot be
    // stepped around by asking for "/public/../private". HFS already refuses
    // traversal before plugins run, but that check works on the decoded path
    // and this one is free, so both subjects get normalized rather than
    // trusting the request to arrive tidy. A trailing slash is meaningful --
    // "/x" and "/x/" are different pages -- so it survives.
    function normalizePath(p) {
        const out = []
        for (const seg of String(p || '').split('/')) {
            if (!seg || seg === '.') continue
            if (seg === '..') { out.pop(); continue }
            out.push(seg)
        }
        return '/' + out.join('/') + (out.length && /\/$/.test(p) ? '/' : '')
    }

    // Query rules hold a literal, not a regex, because the thing you want to
    // write is "sharelink=abc" and every character of a share token would
    // otherwise have to be escaped. The literal has to equal a whole parameter,
    // so it can't accidentally match a fragment of a longer value; with no "="
    // it matches the parameter by name alone, whatever the value is -- which is
    // the useful form for share links, whose value changes every time.
    function queryMatches(query, literal) {
        const eq = literal.indexOf('=')
        const wantName = (eq < 0 ? literal : literal.slice(0, eq)).toLowerCase()
        const wantValue = eq < 0 ? null : literal.slice(eq + 1)
        for (const k of Object.keys(query || {})) {
            if (k.toLowerCase() !== wantName) continue
            if (wantValue === null) return true
            const v = query[k]
            for (const one of (Array.isArray(v) ? v : [v]))
                if (String(one) === wantValue) return true
        }
        return false
    }

    let compiledRules = []
    let compiledHosts = []

    function buildRules(list) {
        const out = []
        for (const r of (list || [])) {
            if (!r || !r.pattern) continue
            const action = r.rule || 'allow'
            if (action === 'disabled') continue
            // Anything unrecognised falls back to 'path' -- including rows
            // written by v0.7, which stored 'path' for what is now 'vfs'.
            const target = r.match === 'url' ? 'url'
                : r.match === 'vfs' ? 'vfs'
                : r.match === 'query' ? 'query'
                : 'path'
            let re = null
            if (target !== 'query')
                try { re = compile(r.pattern) }
                catch (e) {
                    api.log('rule "' + (r.name || r.pattern) + '" ignored, invalid regex: ' + e.message)
                    continue
                }
            const prio = Number(r.priority)
            out.push({
                re,
                literal: String(r.pattern),
                action,
                target,
                name: r.name || r.pattern,
                priority: Number.isFinite(prio) ? prio : 100,
            })
        }
        // Array.prototype.sort is stable, so equal priorities keep grid order.
        out.sort((a, b) => a.priority - b.priority)
        return out
    }

    function priorityOf(r) {
        const n = Number(r && r.priority)
        return Number.isFinite(n) ? n : 100
    }

    // The grid shows rules in stored order but they run by ascending priority,
    // so editing a number leaves the two disagreeing until this puts the stored
    // list back in evaluation order. Ties are then broken by nudging the later
    // row up by one, which makes the integers themselves say what will happen
    // instead of hiding the tie-break in the sort. Returns a tidied copy, or
    // null when the list already reads the way it runs -- so the config is only
    // rewritten when it would actually change.
    function tidyRules(list) {
        if (!Array.isArray(list) || !list.length) return null
        const decorated = list.map((r, i) => ({ r, i }))
        // Decorated by index because a plain sort is only guaranteed stable
        // within one engine, and the tie-break has to be reproducible.
        decorated.sort((a, b) => (priorityOf(a.r) - priorityOf(b.r)) || (a.i - b.i))
        let changed = decorated.some((x, i) => x.i !== i)
        const out = []
        let last = -Infinity
        for (const x of decorated) {
            const want = priorityOf(x.r) <= last ? last + 1 : priorityOf(x.r)
            if (want !== x.r.priority) changed = true
            out.push(Object.assign({}, x.r, { priority: want }))
            last = want
        }
        return changed ? out : null
    }

    function buildHosts(list) {
        const out = []
        for (const h of (list || [])) {
            if (!h || !h.enabled || !h.pattern) continue
            try { out.push(compile(h.pattern)) }
            catch (e) { api.log('host "' + h.pattern + '" ignored, invalid regex: ' + e.message) }
        }
        return out
    }

    function hostMatches(hostHeader) {
        if (!hostHeader) return false
        const host = hostHeader.split(':')[0]  // strip port
        for (const re of compiledHosts)
            if (re.test(host)) return true
        return false
    }

    // Returns what made it look like WebDAV, or '' -- the reason is worth having
    // for the log, since this decides whether a mount works.
    function webdavReason(ctx) {
        if (WEBDAV_METHODS.has(ctx.method)) return 'method ' + ctx.method
        for (const h of WEBDAV_HEADERS)
            if (ctx.get(h)) return 'header ' + h
        // Anything HFS itself has already worked out. Never set as of 3.1.0,
        // where the webdav middleware runs after the plugins, but it costs
        // nothing to honour it if a later version starts filling it in.
        if (ctx.state.webdavDetected) return 'hfs'
        if (!ADVANCED_WEBDAV_DETECTION) return ''
        // OPTIONS is how a client asks what a resource supports before mounting
        // it; HFS answers it as WebDAV unless it is a CORS preflight, which is
        // the one case where a browser sends it. Answering it with a page would
        // make the mount fail before it started.
        if (ctx.method === 'OPTIONS' && !ctx.get('access-control-request-method')) return 'options probe'
        if (WEBDAV_UA.test(ctx.get('user-agent') || '')) return 'user-agent'
        return ''
    }

    // Splits on the first "=" only, so a cookie value containing one survives.
    function getCookie(cookieHeader, name) {
        if (!cookieHeader) return null
        for (const part of cookieHeader.split(';')) {
            const s = part.trim()
            const i = s.indexOf('=')
            if (i < 0) continue
            if (s.slice(0, i) === name) return s.slice(i + 1)
        }
        return null
    }

    // --------------------------------------------------------------- migration

    // Runs before anything subscribes to the config, so the rest of init() sees
    // the upgraded values. Everything it does lives in migrate.js.
    migration.migrate(api)

    // Compile once per config change rather than once per request.
    const unsubRules = api.subscribeConfig('rules', v => {
        const tidy = tidyRules(v)
        compiledRules = buildRules(tidy || v)
        // Written back after compiling, so the running rules are correct even if
        // the host defers the resulting config event. Re-entry is harmless: the
        // tidied list is already in order, so the second pass returns null.
        if (tidy) {
            api.log('rule list re-ordered to match evaluation order')
            api.setConfig('rules', tidy)
        }
    })
    const unsubHosts = api.subscribeConfig('hosts', v => { compiledHosts = buildHosts(v) })

    exports.unload = () => {
        if (unsubRules) unsubRules()
        if (unsubHosts) unsubHosts()
    }

    // -------------------------------------------------------------- middleware

    exports.middleware = ctx => {
        const mode = api.getConfig('mode')
        if (mode === 'off') return

        // The three subjects a rule can be tested against. "path" is the request
        // as the visitor wrote it: HFS's roots feature rewrites ctx.path to
        // prepend the per-domain root folder before plugins run, so on a domain
        // rooted at /site.tld a request for /res/x.css arrives here as
        // /site.tld/res/x.css -- ctx.state.originalPath is the copy roots takes
        // before doing that. ctx.url is never rewritten, which is both the
        // fallback and the reason "url" is still the untouched original.
        const originalPath = ctx.state.originalPath || ctx.url.split('?')[0]
        const subject = {
            path: normalizePath(originalPath),
            vfs: normalizePath(ctx.path),
            url: ctx.protocol + '://' + ctx.get('host') + ctx.url,
        }

        const debug = api.getConfig('debug')
        // Logs the path subject, since that is what rules are written against
        // by default; "why" names the subject when some other one decided.
        const trace = debug ? (verdict, why) => api.log(subject.path + ' -> ' + verdict + ' (' + why + ')') : () => {}

        // Always skip requests from the admin panel and API
        if (ctx.path.startsWith(ADMIN_BASE)) return

        // The domain list is read one way round or the other depending on the
        // mode: listed means exempt when the default is "all", and listed means
        // covered when it is "none". "hosts" is what v0.6's upgrade wrote for
        // the second of those before it had a name.
        const listed = hostMatches(ctx.get('host'))
        const whitelist = mode === 'none' || mode === 'hosts'
        if (whitelist ? !listed : listed) {
            trace('skip', whitelist ? 'domain not listed' : 'domain excluded')
            return
        }

        const dav = webdavReason(ctx)
        if (DEBUG_WEBDAV) api.log('webdav check ' + ctx.method + ' ' + ctx.path + ': ' + (dav || 'no'))
        if (dav && api.getConfig('ignoreWebdav')) {
            trace('skip', 'webdav (' + dav + ')')
            return
        }

        // First match by ascending priority decides. What a request that matches
        // nothing gets is the pathMode setting, which is the same question the
        // domain mode asks one level up: the rules are exceptions to it, and
        // inverting it turns an exception list into a whitelist.
        let decision = api.getConfig('pathMode') === 'none' ? 'allow' : 'deny'
        let why = 'no rule matched, default ' + decision
        for (const r of compiledRules) {
            const hit = r.target === 'query' ? queryMatches(ctx.query, r.literal)
                : r.re.test(subject[r.target])
            if (!hit) continue
            decision = r.action
            why = 'rule "' + r.name + '" @' + r.priority + ' [' + r.target + ']'
            break
        }
        if (decision === 'allow') {
            trace('skip', why)
            return
        }

        // Deliberately after the rules: someone who already accepted keeps their
        // pass even on a deny path, rather than being prompted again every visit.
        const cookieName = api.getConfig('cookieName')
        if (getCookie(ctx.get('cookie'), cookieName) === 'true') {
            trace('skip', 'cookie accepted')
            return
        }

        let html = defaultHTML

        if (api.getConfig('useCustomHTML') && api.getConfig('customHTMLPath')) {
            try {
                html = fs.readFileSync(api.getConfig('customHTMLPath'), 'utf8')
            } catch (e) {
                api.log('Error loading custom HTML:', e.message)
            }
        }

        html = html.replace(/\{\{COOKIE_NAME\}\}/g, cookieName)
        html = html.replace(/\{\{COOKIE_DAYS\}\}/g, api.getConfig('cookieDays'))

        trace('splash', why)
        ctx.status = 200
        ctx.type = 'text/html'
        ctx.body = html
        return true
    }
}
