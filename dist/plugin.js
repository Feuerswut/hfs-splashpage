// Plugin metadata HFS v3
exports.version = 0.7;
exports.description = "Display a splash page before users can access the site";
exports.apiRequired = 13;

exports.author = "feuerswut";
exports.repo = "feuerswut/hfs-splashpage"

// The config form and the plugin log sit side by side in a wrapping flex row,
// the log claiming a minimum of 40em. "width" sizes the dialog body, "maxWidth"
// is picked up by the admin panel and applied to the form alone -- so the form
// gets room for the rule grid's columns while the log is pushed past the wrap
// point and lands below the options instead of hogging the right column.
exports.configDialog = { sx: { width: '85vw', maxWidth: '1250px' } }

// Bumped when the shape of the stored config changes; see migrate() in init.
const CONFIG_VERSION = 2

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
        fields: {
            name: {
                type: 'string',
                label: 'Name',
                $width: 3
            },
            pattern: {
                type: 'string',
                label: 'Pattern (regex)',
                $width: 5,
                getError: v => {
                    if (!v) return "pattern is required"
                    try { new RegExp(v); return false }
                    catch (e) { return "invalid regex: " + e.message }
                }
            },
            enabled: {
                type: 'boolean',
                label: 'Enabled',
                defaultValue: true,
                $width: 100
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
        helperText: "Evaluated low priority first; the first match decides. **The pattern must match the whole path**, so `/s/files` does not cover `/s/files/a.txt` -- write `/s/files(/.*)?` for that. Paths that match nothing get the splash page, so a broad allow rule with a high priority turns the list into a whitelist.",
        fields: {
            priority: {
                type: 'number',
                label: 'Prio',
                defaultValue: 100,
                min: 0,
                $width: 80
            },
            name: {
                type: 'string',
                label: 'Name',
                $width: 3
            },
            pattern: {
                type: 'string',
                label: 'Pattern (regex)',
                $width: 5,
                getError: v => {
                    if (!v) return "pattern is required"
                    try { new RegExp(v); return false }
                    catch (e) { return "invalid regex: " + e.message }
                }
            },
            match: {
                type: 'select',
                label: 'Match',
                defaultValue: 'path',
                options: { "Path": 'path', "Full URL": 'url' },
                $width: 110
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
                $width: 140
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

    let compiledRules = []
    let compiledHosts = []

    function buildRules(list) {
        const out = []
        for (const r of (list || [])) {
            if (!r || !r.pattern) continue
            const action = r.rule || 'allow'
            if (action === 'disabled') continue
            let re
            try { re = compile(r.pattern) }
            catch (e) {
                api.log('rule "' + (r.name || r.pattern) + '" ignored, invalid regex: ' + e.message)
                continue
            }
            const prio = Number(r.priority)
            out.push({
                re,
                action,
                target: r.match === 'url' ? 'url' : 'path',
                name: r.name || r.pattern,
                priority: Number.isFinite(prio) ? prio : 100,
            })
        }
        // Array.prototype.sort is stable, so equal priorities keep grid order.
        out.sort((a, b) => a.priority - b.priority)
        return out
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

        const oldHosts = api.getConfig('selectedHosts') || []
        const oldPaths = api.getConfig('exceptions') || []
        const oldUrls = api.getConfig('urlExceptions') || []

        if (!oldHosts.length && !oldPaths.length && !oldUrls.length) {
            api.setConfig('configVersion', CONFIG_VERSION)  // nothing to carry over
            return
        }

        api.log('upgrading config to v' + CONFIG_VERSION + ' -- matching is now whole-subject, not search')

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
        api.setConfig('configVersion', CONFIG_VERSION)
        api.log('upgrade done: ' + hosts.length + ' host(s), ' + rules.length + ' rule(s)')
    }

    migrate()

    // Compile once per config change rather than once per request.
    const unsubRules = api.subscribeConfig('rules', v => { compiledRules = buildRules(v) })
    const unsubHosts = api.subscribeConfig('hosts', v => { compiledHosts = buildHosts(v) })

    exports.unload = () => {
        if (unsubRules) unsubRules()
        if (unsubHosts) unsubHosts()
    }

    // -------------------------------------------------------------- middleware

    exports.middleware = ctx => {
        const mode = api.getConfig('mode')
        if (mode === 'none') return

        const debug = api.getConfig('debug')
        const trace = debug ? (verdict, why) => api.log(ctx.path + ' -> ' + verdict + ' (' + why + ')') : () => {}

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
        const fullURL = ctx.protocol + '://' + ctx.get('host') + ctx.url
        let decision = null
        let why = 'no rule matched'
        for (const r of compiledRules) {
            if (!r.re.test(r.target === 'url' ? fullURL : ctx.path)) continue
            decision = r.action
            why = 'rule "' + r.name + '" @' + r.priority
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
