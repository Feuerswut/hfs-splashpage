// Plugin metadata HFS v3
exports.version = 0.2;
exports.description = "Display a splash page before users can access the site";
exports.apiRequired = 12.97;

exports.author = "Feuerswut";
exports.repo = "Feuerswut/hfs-splashpage"

exports.config = {
    enabled: {
        type: 'boolean',
        label: 'Enable Splash Page',
        defaultValue: true
    },
    cookieName: {
        type: 'string',
        label: 'Cookie Name',
        defaultValue: 'example-splashpage',
        showIf: values => values.enabled
    },
    cookieDays: {
        type: 'number',
        label: 'Cookie Duration (days)',
        defaultValue: 365,
        min: 1,
        showIf: values => values.enabled
    },
    useCustomHTML: {
        type: 'boolean',
        label: 'Use Custom HTML File',
        defaultValue: false,
        showIf: values => values.enabled
    },
    customHTMLPath: {
        type: 'string',
        label: 'Custom HTML File Path',
        defaultValue: '',
        showIf: values => values.enabled && values.useCustomHTML
    },
    exceptions: {
        type: 'array',
        label: 'Path Exceptions (Regex)',
        defaultValue: [
            { pattern: '~/a*', enabled: true },
            { pattern: 'robots.txt$', enabled: true },
            { pattern: '^/legal*', enabled: false }
        ],
        showIf: values => values.enabled,
        fields: {
            pattern: {
                type: 'string',
                label: 'Pattern',
                $width: 4
            },
            enabled: {
                type: 'boolean',
                label: 'Enabled',
                defaultValue: true,
                $width: 2
            }
        }
    },
    urlExceptions: {
        type: 'array',
        label: 'Full URL Exceptions (Regex)',
        defaultValue: [
            { pattern: '\\?.*sharelink=', enabled: true }
        ],
        showIf: values => values.enabled,
        fields: {
            pattern: {
                type: 'string',
                label: 'Pattern',
                $width: 4
            },
            enabled: {
                type: 'boolean',
                label: 'Enabled',
                defaultValue: true,
                $width: 2
            }
        }
    }
}

exports.init = api => {
    const fs = require('fs')
    const path = require('path')
    
    const defaultHTMLPath = path.join(__dirname, 'public/index.html')
    let defaultHTML = '<html><body><h1>Error loading splash page</h1></body></html>'
    
    try {
        defaultHTML = fs.readFileSync(defaultHTMLPath, 'utf8')
    } catch (e) {
        api.log('Error loading index.html:', e.message)
    }

    function isException(url, exceptions) {
        if (!exceptions) return false
        for (const ex of exceptions) {
            if (!ex.enabled || !ex.pattern) continue
            try {
                if (new RegExp(ex.pattern, 'i').test(url)) return true
            } catch (e) {}
        }
        return false
    }

    function getCookie(cookieHeader, name) {
        if (!cookieHeader) return null
        const cookies = cookieHeader.split(';')
        for (const cookie of cookies) {
            const [key, value] = cookie.trim().split('=')
            if (key === name) return value
        }
        return null
    }

    exports.middleware = ctx => {
        const config = {
            enabled: api.getConfig('enabled'),
            cookieName: api.getConfig('cookieName'),
            cookieDays: api.getConfig('cookieDays'),
            useCustomHTML: api.getConfig('useCustomHTML'),
            customHTMLPath: api.getConfig('customHTMLPath'),
            exceptions: api.getConfig('exceptions'),
            urlExceptions: api.getConfig('urlExceptions')
        }

        if (!config.enabled) return
        if (isException(ctx.path, config.exceptions)) return

        const fullURL = ctx.protocol + '://' + ctx.get('host') + ctx.url
        if (isException(fullURL, config.urlExceptions)) return

        const cookie = getCookie(ctx.get('cookie'), config.cookieName)
        if (cookie === 'true') return

        let html = defaultHTML
        
        if (config.useCustomHTML && config.customHTMLPath) {
            try {
                html = fs.readFileSync(config.customHTMLPath, 'utf8')
            } catch (e) {
                api.log('Error loading custom HTML:', e.message)
            }
        }

        html = html.replace(/\{\{COOKIE_NAME\}\}/g, config.cookieName)
        html = html.replace(/\{\{COOKIE_DAYS\}\}/g, config.cookieDays)

        ctx.status = 200
        ctx.type = 'text/html'
        ctx.body = html
        return true
    }
}
