// Plugin metadata HFS v3
exports.version = 0.8;
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

// Bumped when the shape of the stored config changes; see migrate() in init.
const CONFIG_VERSION = 3

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
    mode: {
        type: 'select',
        label: 'Show Splash Page',
        defaultValue: 'all',
        options: {
            "On all domains": 'all',
            "On no domains (off)": 'none',
            "Only on selected domains": 'hosts',
        },
        helperText: "Replaces the old enabled/selectedHosts pair. \"Only on selected domains\" uses the host list below.",
    },
    hosts: {
        type: 'array',
        label: 'Domains',
        defaultValue: [],
        showIf: values => values.mode === 'hosts',
        helperText: "Matched against the Host header with the port stripped. The pattern must match the whole host.",
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
    rules: {
        type: 'array',
        label: 'Rules',
        defaultValue: [
            { priority: 10, name: 'robots.txt', pattern: '.*/robots\\.txt', match: 'path', rule: 'allow' },
        ],
        showIf: values => values.mode !== 'none',
        helperText: "Evaluated low priority first; the first match decides. The list is re-sorted into that order when you save, and two rows sharing a number are separated by bumping the lower one, so what you see is what runs. **The pattern must match the whole subject**, so `/s/files` does not cover `/s/files/a.txt` -- write `/s/files(/.*)?` for that. Requests that match nothing get the splash page, so a broad allow rule with a high priority turns the list into a whitelist.\n\nWhat the pattern is tested against depends on **Match**:\n- **Path** -- what the visitor asked for, with the query string removed, `.`/`..`/`//` normalized away, and *without* the per-domain root folder HFS prepends. `https://site.tld/res/x.css` is `/res/x.css` even when that domain is rooted at `/site.tld`.\n- **VFS path** -- the same request as HFS resolved it, root folder included: `/site.tld/res/x.css`. This is what earlier versions called Path.\n- **Full URL** -- the whole original address, scheme and host and query string included: `https://site.tld/?sharelink=abc`.\n- **Query param** -- *not* a regex. A literal `name=value` that has to equal one of the query parameters, or a bare `name` to match that parameter whatever its value. Names are compared case-insensitively, values exactly.",
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
        showIf: values => values.mode !== 'none'
    },
    debug: {
        type: 'boolean',
        label: 'Log Every Decision',
        defaultValue: false,
        showIf: values => values.mode !== 'none',
        helperText: "Writes one line per request to the log below, naming the rule that decided it. Noisy; for troubleshooting only.",
    },
    cookieName: {
        type: 'string',
        label: 'Cookie Name',
        defaultValue: 'example-splashpage',
        showIf: values => values.mode !== 'none'
    },
    cookieDays: {
        type: 'number',
        label: 'Cookie Duration (days)',
        defaultValue: 365,
        min: 1,
        showIf: values => values.mode !== 'none'
    },
    useCustomHTML: {
        type: 'boolean',
        label: 'Use Custom HTML File',
        defaultValue: false,
        showIf: values => values.mode !== 'none'
    },
    customHTMLPath: {
        type: 'string',
        label: 'Custom HTML File Path',
        defaultValue: '',
        showIf: values => values.mode !== 'none' && values.useCustomHTML
    },

    // --- Legacy keys, kept only so the upgrade can read them. They are never
    // consulted at request time and are emptied once migrated, which also makes
    // them disappear from this form.
    configVersion: {
        type: 'number',
        defaultValue: 0,
        showIf: () => false
    },
    enabled: {
        type: 'boolean',
        defaultValue: true,
        showIf: () => false
    },
    selectedHosts: {
        type: 'array',
        label: 'Selected Hosts (legacy, migrated)',
        defaultValue: [],
        showIf: values => Boolean(values.selectedHosts && values.selectedHosts.length),
        fields: {
            pattern: { type: 'string', label: 'Host Pattern (regex)', $width: 4 },
            enabled: { type: 'boolean', label: 'Enabled', $width: 2 }
        }
    },
    exceptions: {
        type: 'array',
        label: 'Path Exceptions (legacy, migrated)',
        defaultValue: [],
        showIf: values => Boolean(values.exceptions && values.exceptions.length),
        fields: {
            pattern: { type: 'string', label: 'Pattern', $width: 4 },
            enabled: { type: 'boolean', label: 'Enabled', $width: 2 }
        }
    },
    urlExceptions: {
        type: 'array',
        label: 'Full URL Exceptions (legacy, migrated)',
        defaultValue: [],
        showIf: values => Boolean(values.urlExceptions && values.urlExceptions.length),
        fields: {
            pattern: { type: 'string', label: 'Pattern', $width: 4 },
            enabled: { type: 'boolean', label: 'Enabled', $width: 2 }
        }
    }
}

exports.init = api => {
    const fs = require('fs')
    const path = require('path')

    // --- Advanced options (not exposed in UI) ---
    const ADVANCED_WEBDAV_DETECTION = true  // also detect via UA patterns and PROPFIND method
    const DEBUG_WEBDAV = false              // log WebDAV detection details per request
    // --------------------------------------------

    const ADMIN_BASE = '/~'
    const WEBDAV_UA = /microsoft-webdav|davfs|cyberduck|bitkinex|webdrive|netdrive|webdav|cadaver|konqueror\/|gvfs\/|sabredav/i

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

    function seedName(pattern, fallback) {
        // Just enough cleanup to be readable in the Name column; the operator is
        // expected to rename these. Only the outer anchors are dropped -- a "^"
        // inside a character class such as [^&] has to survive.
        let s = String(pattern || '').replace(/^\^/, '').replace(/(^|[^\\])\$$/, '$1').replace(/\\(.)/g, '$1')
        if (s.length > 40) s = s.slice(0, 39) + '…'
        return s || fallback
    }

    // The old engine searched anywhere in the subject; the new one matches the
    // whole subject. That only carries over untouched for patterns already
    // anchored at the start, which for a path means a leading "^" or "/".
    // Everything else gets an explicit wrap that is exactly equivalent to the
    // old search -- including every URL rule, which by nature matches a fragment
    // such as a query parameter and is never anchored.
    function migratePattern(pattern, target) {
        if (target === 'path' && /^[\^/]/.test(pattern))
            return { pattern, wrapped: false }
        return { pattern: '.*(?:' + pattern + ').*', wrapped: true }
    }

    function migrate() {
        const version = Number(api.getConfig('configVersion')) || 0
        if (version >= CONFIG_VERSION) return
        const carried = version < 2 ? migrateToV2() : false
        // v3 changes no stored shape, so there is nothing to rewrite -- but it
        // does change what an existing row means, which is worth one line in
        // the log. Skipped on a fresh install, where there is no "before".
        if (version >= 2 || carried) noteV3()
        api.setConfig('configVersion', CONFIG_VERSION)
    }

    // "path" rules used to be tested against ctx.path, which HFS has already
    // rewritten to include the per-domain root folder. That subject is now
    // called "vfs" and "path" means the request as the visitor wrote it, so on
    // a server using roots the two are no longer the same string.
    function noteV3() {
        const n = (api.getConfig('rules') || []).filter(r => r && (!r.match || r.match === 'path')).length
        if (!n) return
        api.log('note: "Path" now matches the request as sent (no root folder, no query string) rather than'
            + ' the VFS path -- ' + n + ' rule(s) use it. Switch one to "VFS path" to get the old subject back.')
    }

    function migrateToV2() {
        const oldHosts = api.getConfig('selectedHosts') || []
        const oldPaths = api.getConfig('exceptions') || []
        const oldUrls = api.getConfig('urlExceptions') || []

        if (!oldHosts.length && !oldPaths.length && !oldUrls.length)
            return false  // nothing to carry over

        api.log('upgrading config -- matching is now whole-subject, not search')

        // mode: the old pair was "enabled" plus "empty selectedHosts means all"
        const wasEnabled = api.getConfig('enabled')
        const hadHosts = oldHosts.some(h => h && h.enabled && h.pattern)
        const mode = wasEnabled === false ? 'none' : (hadHosts ? 'hosts' : 'all')
        api.setConfig('mode', mode)
        api.log('  mode = ' + mode)

        const hosts = oldHosts.map(h => ({
            name: seedName(h && h.pattern, 'host'),
            pattern: (h && h.pattern) || '',
            enabled: !(h && h.enabled === false),
        }))
        for (const h of hosts)
            api.log('  host "' + h.pattern + '" now has to match the whole host name -- check it')
        if (hosts.length) api.setConfig('hosts', hosts)

        // Both legacy lists collapse into one, distinguished by the match column.
        // Priorities are spaced so rows can be inserted between them later.
        const rules = []
        let prio = 0
        const carry = (list, target) => {
            for (const e of list) {
                if (!e || !e.pattern) continue
                prio += 10
                const action = e.enabled === false ? 'disabled' : 'allow'
                const conv = migratePattern(e.pattern, target)
                rules.push({
                    priority: prio,
                    name: seedName(e.pattern, 'rule ' + (rules.length + 1)),
                    pattern: conv.pattern,
                    match: target,
                    rule: action,
                })
                api.log('  rule "' + e.pattern + '" (' + target + ', ' + action + ')'
                    + (conv.wrapped ? ' -> wrapped as "' + conv.pattern
                        + '" to keep matching anywhere; tighten it if you can' : ''))
            }
        }
        carry(oldPaths, 'path')
        carry(oldUrls, 'url')
        if (rules.length) api.setConfig('rules', rules)

        api.setConfig('selectedHosts', [])
        api.setConfig('exceptions', [])
        api.setConfig('urlExceptions', [])
        api.log('upgrade done: ' + hosts.length + ' host(s), ' + rules.length + ' rule(s)')
        return true
    }

    migrate()

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
        if (mode === 'none') return

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

        if (mode === 'hosts' && !hostMatches(ctx.get('host'))) {
            trace('skip', 'host not selected')
            return
        }

        // Skip WebDAV clients when the option is on.
        // Fall back to UA matching if HFS hasn't set webdavDetected (e.g. Microsoft-WebDAV-MiniRedir)
        const uaMatch = ADVANCED_WEBDAV_DETECTION && WEBDAV_UA.test(ctx.get('user-agent') || '')
        const propfindMatch = ADVANCED_WEBDAV_DETECTION && ctx.method === 'PROPFIND'
        const isWebdav = ctx.state.webdavDetected || uaMatch || propfindMatch
        if (DEBUG_WEBDAV)
            api.log('webdav check ' + ctx.path + ': state=' + Boolean(ctx.state.webdavDetected)
                + ' ua=' + Boolean(uaMatch) + ' propfind=' + Boolean(propfindMatch))
        if (api.getConfig('ignoreWebdav') && isWebdav) {
            trace('skip', 'webdav')
            return
        }

        // First match by ascending priority decides. No match means splash, so
        // a catch-all allow at a high priority turns the list into a whitelist.
        let decision = null
        let why = 'no rule matched'
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
