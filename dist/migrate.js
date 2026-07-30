// Everything about bringing an older stored config up to date, and nothing
// else -- plugin.js requires this, calls migrate(api) once at init, and never
// looks at any of it again at request time.
//
// The file is ordered by config version: the dispatcher first, then one section
// per step in ascending order, each with the helpers only that step uses. A new
// step is a new section at the bottom plus one line in the dispatcher, and the
// history above it stays untouched.

// Bumped whenever the stored config changes shape or an existing value changes
// meaning. Plugin versions and config versions are not the same number: 0.6
// shipped v1, 0.7 ships v2 through v4.
exports.CONFIG_VERSION = 4

// Each step is gated on its own version rather than on one "not current yet"
// test, so an install several versions behind runs all of them in order and an
// install one behind does not re-run the one it already went through.
exports.migrate = api => {
    const version = Number(api.getConfig('configVersion')) || 0
    if (version >= exports.CONFIG_VERSION) return
    // v2 writes the current vocabulary directly, so a config coming all the way
    // from 0.6 does not then need the later renames applied on top of it. Its
    // return value says whether there was anything there to carry.
    const carried = version < 2 ? migrateToV2(api) : false
    // v3 changes no stored shape, so there is nothing to rewrite -- but it does
    // change what an existing row means, which is worth one line in the log.
    // Skipped on a fresh install, where there is no "before".
    if (version < 3 && (version >= 2 || carried)) noteV3(api)
    if (version >= 2 && version < 4) migrateToV4(api)
    api.setConfig('configVersion', exports.CONFIG_VERSION)
}

// The v1 keys, kept in the config schema only so the upgrade can read them.
// They are never consulted at request time and are emptied once carried over,
// which also makes them disappear from the form -- each one is shown only while
// it still holds something. plugin.js merges these into exports.config.
exports.legacyConfig = {
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

// ---------------------------------------------------------------------- v2
// 0.6 kept three separate lists -- selected hosts, path exceptions, URL
// exceptions -- plus a master on/off switch, and matched every pattern with a
// search. 0.7 has one prioritised rule list, a scope setting, and whole-subject
// matching. Everything here is about landing on the same decisions afterwards
// as before, and logging anything that could not be carried exactly.

function migrateToV2(api) {
    const oldHosts = api.getConfig('selectedHosts') || []
    const oldPaths = api.getConfig('exceptions') || []
    const oldUrls = api.getConfig('urlExceptions') || []

    const wasEnabled = api.getConfig('enabled')

    if (!oldHosts.length && !oldPaths.length && !oldUrls.length) {
        // No lists to carry over -- but the old on/off switch still has to be
        // honoured, or an install that was simply turned off would come back up
        // gating the whole site. With that handled, an empty legacy config is
        // indistinguishable from a fresh one and gets the new defaults.
        if (wasEnabled === false) {
            api.setConfig('mode', 'off')
            api.log('upgrading config -- plugin was switched off, mode = off')
        }
        return false
    }

    api.log('upgrading config -- matching is now whole-subject, not search')

    // mode: the old pair was "enabled" plus "empty selectedHosts means all".
    // A non-empty list becomes "none" -- the plugin runs, and the list is the
    // whitelist -- which is exactly what the old pair meant. The test is on the
    // list being empty, not on any row being enabled: a list whose rows are all
    // switched off selected *no* host, which kept the whole plugin idle.
    // Reading that as "all" would turn an upgrade into a site-wide splash page.
    const mode = wasEnabled === false ? 'off' : (oldHosts.length ? 'none' : 'all')
    api.setConfig('mode', mode)
    api.log('  mode = ' + mode)

    // enabled is carried as a plain truthy test, matching the old engine: it
    // skipped a row whose flag was missing rather than assuming it on.
    const hosts = oldHosts.map(h => ({
        name: seedName(h && h.pattern, 'host'),
        pattern: (h && h.pattern) || '',
        enabled: Boolean(h && h.enabled),
    }))
    for (const h of hosts)
        api.log('  host "' + h.pattern + '" now has to match the whole host name -- check it')
    if (hosts.length) api.setConfig('hosts', hosts)
    if (mode === 'none' && !hosts.some(h => h.enabled && h.pattern))
        api.log('  no host is enabled, so the splash page stays off everywhere -- as it was before')

    // Both legacy lists collapse into one, distinguished by the match column.
    // Priorities are spaced so rows can be inserted between them later.
    // Path exceptions become "vfs", not "path": they were tested against
    // ctx.path, which HFS has already prefixed with the per-domain root folder,
    // and that subject is what "vfs" now means. Carrying them to "path" would
    // quietly break every rule on a server using roots. New rules still default
    // to "path"; this is only about not changing the meaning of rules that
    // already exist.
    const rules = []
    let prio = 0
    const carry = (list, target) => {
        for (const e of list) {
            if (!e || !e.pattern) continue
            prio += 10
            const action = e.enabled ? 'allow' : 'disabled'
            const conv = migratePattern(e.pattern)
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
    carry(oldPaths, 'vfs')
    carry(oldUrls, 'url')
    // Written even when empty: this is a known upgrade, and leaving the key
    // unset would hand the install the new default rule list instead, which
    // punches a hole the old config never had.
    api.setConfig('rules', rules)
    if (!rules.length) api.log('  no exceptions to carry over -- rule list starts empty')

    api.setConfig('selectedHosts', [])
    api.setConfig('exceptions', [])
    api.setConfig('urlExceptions', [])
    api.log('upgrade done: ' + hosts.length + ' host(s), ' + rules.length + ' rule(s)')
    return true
}

function seedName(pattern, fallback) {
    // Just enough cleanup to be readable in the Name column; the operator is
    // expected to rename these. Only the outer anchors are dropped -- a "^"
    // inside a character class such as [^&] has to survive.
    let s = String(pattern || '').replace(/^\^/, '').replace(/(^|[^\\])\$$/, '$1').replace(/\\(.)/g, '$1')
    if (s.length > 40) s = s.slice(0, 39) + '…'
    return s || fallback
}

// The old engine searched anywhere in the subject; the new one matches the
// whole subject. A pattern only means the same thing under both if it was
// anchored at *both* ends -- "^/x$" searched for is the same as "^/x$" matched
// whole. Anchoring one end is not enough: "^/res/" used to mean "starts with
// /res/" and would now mean "is exactly /res/", and "/x$" used to mean "ends
// with /x" and would now mean "is exactly /x". So everything else gets an
// explicit wrap that reproduces the old search; the "^" and "$" inside it keep
// working, being zero-width assertions. That covers every URL rule too, which
// by nature matches a fragment such as a query parameter and is never anchored.
function migratePattern(pattern) {
    const anchoredStart = /^\^/.test(pattern)
    const anchoredEnd = /(^|[^\\])\$$/.test(pattern)
    if (anchoredStart && anchoredEnd)
        return { pattern, wrapped: false }
    return { pattern: '.*(?:' + pattern + ').*', wrapped: true }
}

// ---------------------------------------------------------------------- v3
// Nothing stored changes shape here, so there is nothing to rewrite -- only a
// subject that changed under the rules that were already written against it.

// "path" rules used to be tested against ctx.path, which HFS has already
// rewritten to include the per-domain root folder. That subject is now called
// "vfs" and "path" means the request as the visitor wrote it, so on a server
// using roots the two are no longer the same string.
function noteV3(api) {
    const n = (api.getConfig('rules') || []).filter(r => r && (!r.match || r.match === 'path')).length
    if (!n) return
    api.log('note: "Path" now matches the request as sent (no root folder, no query string) rather than'
        + ' the VFS path -- ' + n + ' rule(s) use it. Switch one to "VFS path" to get the old subject back.')
}

// ---------------------------------------------------------------------- v4
// The scope setting used to be "all / none (off) / hosts". "none" now means the
// plugin runs with the domain list as a whitelist, and not running at all is
// called "off", so both of the old names have to move -- silently leaving them
// would turn a switched-off install into a live one.

function migrateToV4(api) {
    const was = api.getConfig('mode')
    const now = was === 'none' ? 'off' : was === 'hosts' ? 'none' : null
    if (!now) return
    api.setConfig('mode', now)
    api.log('note: scope setting renamed -- ' + (now === 'off'
        ? '"On no domains" meant off, and is now "Plugin disabled"'
        : '"Only on selected domains" is now "On no domains", the domain list being the whitelist'))
}
