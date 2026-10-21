

const EAT_NONE = 0;
const EAT_ALL = 2;

const _hookCommand = {};
const _hookPrint = {};
const _pluginEventHooks = {};
const _customRecordTypes = {};

const _jsPlugins = {};

const irc = Object.freeze({
    EAT_NONE: 0,
    EAT_ALL: 2,

    hookPrint(event, cb, userdata = null) {
        (_hookPrint[event] = _hookPrint[event] || []).push({ cb, ud: userdata });
    },

    hookCommand(cmd, cb, userdata = null) {
        const key = cmd.toLowerCase().replace(/^\//, '');
        (_hookCommand[key] = _hookCommand[key] || []).push({ cb, ud: userdata });
    },

    on(eventType, cb) {
        (_pluginEventHooks[eventType] = _pluginEventHooks[eventType] || []).push(cb);
    },

    addRecordType(type, renderFn) {
        _customRecordTypes[type] = renderFn;
    },

    prnt(text, bufKey) {
        const key = bufKey || state.active;
        if (!key) return;
        const [netId, ch] = key.split('/');
        sysMsg(netId, ch || 'Status', String(text), 'status');
    },

    pushRecord(bufKey, rec) {

        pushRec(bufKey, rec);
    },

    notify(title, body = '', bufKey = null) {
        notify(String(title), String(body), bufKey);
    },

    send(networkId, rawLine) {
        wsSend({ type: 'raw', network_id: networkId, line: rawLine });
    },

    msg(networkId, target, text) {
        wsSend({ type: 'privmsg', network: networkId, target, message: text });
    },

    notice(networkId, target, text) {
        wsSend({ type: 'raw', network_id: networkId, line: `NOTICE ${target} :${text}` });
    },

    join(networkId, channel, key = '') {
        wsSend({ type: 'raw', network_id: networkId, line: `JOIN ${channel}${key ? ' ' + key : ''}` });
    },

    part(networkId, channel, reason = '') {
        wsSend({ type: 'raw', network_id: networkId, line: reason ? `PART ${channel} :${reason}` : `PART ${channel}` });
    },

    kick(networkId, channel, nick, reason = '') {
        wsSend({ type: 'raw', network_id: networkId, line: reason ? `KICK ${channel} ${nick} :${reason}` : `KICK ${channel} ${nick}` });
    },

    mode(networkId, target, modes) {
        wsSend({ type: 'raw', network_id: networkId, line: `MODE ${target} ${modes}` });
    },

    setTopic(networkId, channel, topic) {
        wsSend({ type: 'raw', network_id: networkId, line: `TOPIC ${channel} :${topic}` });
    },

    whois(networkId, nick) {
        wsSend({ type: 'raw', network_id: networkId, line: `WHOIS ${nick} ${nick}` });
    },

    emitCommand(cmd, ...args) {
        wsSend({ type: 'plugin_command', command: cmd, args });
    },

    get active() { return state.active; },

    get networks() { return state.networks; },

    get settings() { return state.settings; },

    getNetworks() { return Object.keys(state.networks); },

    getChannels(netId) { return (state.networks[netId] || {}).channels || []; },

    getNick(netId) { return (state.networks[netId] || {}).nick || ''; },

    getNicks(bufKey) { return { ...(state.nicks[bufKey || state.active] || {}) }; },

    getSetting(path) {
        return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), state.settings);
    },
});

const $ = id => document.getElementById(id);
const mk = (tag, cls) => Object.assign(document.createElement(tag), cls ? { className: cls } : {});

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) + str.charCodeAt(i);
    return hash;
}
function fmtTime(ts) {
    if (typeof ts === 'string' && ts.includes(':')) return ts.slice(0, 5);
    const d = ts ? new Date(ts * 1000) : new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
// True when running in the mobile layout (matches the mobile.css breakpoint).
// Kept in sync with the media query so resizing across the breakpoint doesn't
// leave stale timestamp/grouping rendering; the active buffer is re-rendered.
const _mobileMq = window.matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)');
let IS_MOBILE = _mobileMq.matches;
_mobileMq.addEventListener('change', e => {
    IS_MOBILE = e.matches;
    if (typeof state !== 'undefined' && state.active) switchBuf(state.active);
});
// Compact relative timestamp for mobile ("now", "5m", "2h", "3d").
function relTime(epoch) {
    const diff = Math.floor(Date.now() / 1000 - epoch);
    if (diff < 45) return 'now';
    if (diff < 3600) return Math.round(diff / 60) + 'm';
    if (diff < 86400) return Math.round(diff / 3600) + 'h';
    if (diff < 604800) return Math.round(diff / 86400) + 'd';
    return new Date(epoch * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function highlight(text, term) {
    if (!term) return text;
    try {
        const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.split(/(<[^>]+>)/g).map(part => {
            if (part.startsWith('<')) return part;
            return part.replace(pattern, '<mark>$1</mark>');
        }).join('');
    }
    catch (_) { return text; }
}
// --- IRC dropdown menu ---
function toggleIrcMenu(e) {
    e.stopPropagation();
    const p = $('irc-popup');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) {
        const close = ev => {
            if (!$('irc-menu').contains(ev.target)) { closeIrcMenu(); document.removeEventListener('click', close); }
        };
        document.addEventListener('click', close);
    }
}
function closeIrcMenu() { $('irc-popup').classList.add('hidden'); }

// --- Mobile sidebars ---
function toggleTree() {
    $('server-tree').classList.toggle('visible');
    $('userlist-panel').classList.remove('visible');
    $('mobile-backdrop').classList.toggle('visible', $('server-tree').classList.contains('visible'));
}
function toggleUserList() {
    $('userlist-panel').classList.toggle('visible');
    $('server-tree').classList.remove('visible');
    $('mobile-backdrop').classList.toggle('visible', $('userlist-panel').classList.contains('visible'));
}
function closeMobilePanels() {
    $('server-tree').classList.remove('visible');
    $('userlist-panel').classList.remove('visible');
    $('mobile-backdrop').classList.remove('visible');
}
// Modern nick → deterministic colour
function nickColour(nick, network) {
    const adv = state.settings.advanced || {};
    const ownColour = adv.ownNickColour || '#e06c75';
    const otherColour = adv.otherNickColour || '#61afef';

    const ownNick = (network && state.networks[network]?.nick)
        || Object.values(state.networks).find(n => n.nick)?.nick
        || '';

    if (ownNick && ownNick.toLowerCase() === nick.toLowerCase()) return ownColour;

    // Use theme override if set, otherwise the single "other nick" colour.
    const themeNickColor = getComputedStyle(document.documentElement).getPropertyValue('--nick-color').trim();
    if (themeNickColor && themeNickColor !== 'initial' && themeNickColor !== '') return themeNickColor;

    return otherColour;
}
function fetchPreviewsInElement(parent) {
    if (!parent) return;
    const containers = parent.querySelectorAll('.link-preview-container:not(.loaded)');
    containers.forEach(container => {
        container.classList.add('loaded');
        const url = container.getAttribute('data-url');
        if (!url) return;

        fetch(`/api/preview?url=${encodeURIComponent(url)}`)
            .then(res => res.json())
            .then(data => {
                if (data.error || (!data.title && !data.description && !data.image)) {
                    container.style.display = 'none';
                    return;
                }

                const card = mk('div', 'preview-card');

                if (data.image) {
                    const img = mk('img', 'preview-img');
                    img.src = data.image;
                    img.loading = 'lazy';
                    const buf = $('chat-buffer');
                    img.onload = () => {
                        if (buf.scrollHeight - buf.scrollTop <= buf.clientHeight + img.offsetHeight + 100) {
                            scrollBot();
                        }
                    };
                    card.appendChild(img);
                }

                const content = mk('div', 'preview-content');
                const title = mk('div', 'preview-title');
                title.textContent = data.title || new URL(url).hostname;
                content.appendChild(title);

                if (data.description) {
                    const desc = mk('div', 'preview-desc');
                    desc.textContent = data.description;
                    content.appendChild(desc);
                }

                const siteName = mk('div', 'preview-site');
                try {
                    siteName.textContent = new URL(url).hostname;
                } catch(e) {
                    siteName.textContent = 'Link';
                }
                content.appendChild(siteName);

                card.appendChild(content);
                card.onclick = () => window.open(url, '_blank', 'noreferrer noopener');
                container.appendChild(card);

                const buf = $('chat-buffer');
                if (buf.scrollHeight - buf.scrollTop <= buf.clientHeight + card.offsetHeight + 100) {
                    scrollBot();
                }
            })
            .catch(err => {
                console.error('Failed to load preview:', err);
                container.style.display = 'none';
            });
    });
}

// Format message text: URLs → clickable links AND IRC Formatting
function formatText(html) {
    if (!html) return '';
    // 1. Process URLS first (on the raw text to avoid messing with tags later)
    let processed = html.replace(/(https?:\/\/[^\s<">]+)/g, (match) => {
        let link = match;
        let suffix = '';
        const m = link.match(/[.,!?;:)\]'"]+$/);
        if (m) { suffix = m[0]; link = link.slice(0, -suffix.length); }

        let out = `<a href="${link}" target="_blank" rel="noreferrer noopener" style="color:inherit;opacity:.75">${link}</a>`;

        // Enhance with media embedding if enabled
        if (state.settings.advanced?.embedMedia) {
            const low = link.toLowerCase();
            const isImg = low.match(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/);
            const isVid = low.match(/\.(mp4|webm)(\?|#|$)/);
            const src = state.settings.advanced?.mediaProxy
                ? `/api/mediaproxy?url=${encodeURIComponent(link)}`
                : link;
            if (isImg) {
                // data-expandable is handled via delegated listeners in initEvents()
                out += `<br><img src="${src}" class="embedded-media" data-expandable loading="lazy">`;
            } else if (isVid) {
                out += `<br><video src="${src}" class="embedded-media" data-expandable controls muted preload="metadata"></video>`;
            } else {
                const previewId = 'preview-' + Math.random().toString(36).substr(2, 9);
                out += `<div class="link-preview-container" id="${previewId}" data-url="${esc(link)}"></div>`;
            }
        }

        return out + suffix;
    });

    // 2. Process IRC Formatting
    return parseIRCFormatting(processed);
}

function parseIRCFormatting(text) {
    let out = "";
    let bold = false, italic = false, underline = false, strike = false, mono = false, reverse = false;
    let fg = null, bg = null;
    let openCount = 0;

    // Because HTML spans must nest properly, toggling any attribute off
    // closes ALL open spans and reopens the ones still active. This keeps
    // e.g. bold-off inside a colour run from closing the colour span.
    const closeAll = () => {
        const s = "</span>".repeat(openCount);
        openCount = 0;
        return s;
    };
    const reopen = () => {
        let s = "";
        if (fg !== null || bg !== null) {
            let cls = `c${fg % 16}`;
            if (bg !== null) cls += ` bg${bg % 16}`;
            s += `<span class="${cls}">`; openCount++;
        }
        if (bold) { s += '<span class="irc-bold">'; openCount++; }
        if (italic) { s += '<span class="irc-italic">'; openCount++; }
        if (underline) { s += '<span class="irc-underline">'; openCount++; }
        if (strike) { s += '<span class="irc-strikethrough">'; openCount++; }
        if (mono) { s += '<span class="irc-monospace">'; openCount++; }
        if (reverse) { s += '<span class="irc-reverse">'; openCount++; }
        return s;
    };

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const code = c.charCodeAt(0);

        if (code === 0x02) { // Bold
            out += closeAll(); bold = !bold; out += reopen();
        } else if (code === 0x1D) { // Italic
            out += closeAll(); italic = !italic; out += reopen();
        } else if (code === 0x1F) { // Underline
            out += closeAll(); underline = !underline; out += reopen();
        } else if (code === 0x1E) { // Strikethrough
            out += closeAll(); strike = !strike; out += reopen();
        } else if (code === 0x11) { // Monospace
            out += closeAll(); mono = !mono; out += reopen();
        } else if (code === 0x16) { // Reverse
            out += closeAll(); reverse = !reverse; out += reopen();
        } else if (code === 0x0F) { // Reset
            out += closeAll();
            bold = italic = underline = strike = mono = reverse = false;
            fg = null; bg = null;
        } else if (code === 0x03) { // Color
            const match = text.substring(i + 1).match(/^(\d{1,2})(?:,(\d{1,2}))?/);
            out += closeAll();
            if (match) {
                // 99 = "default" colour; extended colours 16–98 aren't in our

                const _fg = parseInt(match[1]);
                const _bg = match[2] ? parseInt(match[2]) : null;
                fg = _fg <= 15 ? _fg : null;
                bg = (_bg !== null && _bg <= 15) ? _bg : null;
                i += match[0].length;
            } else {
                fg = null; bg = null;
            }
            out += reopen();
        } else {
            out += c;
        }
    }
    out += closeAll();
    return out;
}

let _dragSrc = null;

const _evGroupDom = {};

function _evNickFromRec(rec) {
    return (rec.text || '').split(' ')[0];
}
function _getCondensedText(g) {
    const parts = [];
    if (g.joins.length) parts.push(g.joins.join(', ') + ' joined');
    if (g.parts.length) parts.push(g.parts.join(', ') + ' left');
    if (g.quits.length) parts.push(g.quits.join(', ') + ' quit');
    return parts.join(' · ');
}
function _buildCondensedEl(g) {
    const d = mk('div', 'ml mt-condensed');
    const ts = mk('span', 'ml-ts'); ts.textContent = fmtTime(g.ts);
    const txt = mk('span', 'ml-text condensed-text'); txt.textContent = _getCondensedText(g);
    d.append(ts, txt);
    return d;
}

const state = {
    networks: {},
    buffers: {},
    topics: {},
    unread: {},
    highlights: {},
    collapsed: {},
    active: null,
    settings: { networks: [], identity: {} },
    editingNet: null,
    nicks: {},
    tab: { active: false, key: '', matches: [], index: 0, original: '' },
    history: [],
    historyPos: -1,
    historyDraft: '',
    notifications: false,
    lockScroll: false,
    sslAlertShown: false,
    routeWhoisToActive: false,
    routeNoticesToActive: false,
    logDates: {},
    pingLatency: {},
    dms: {},
    away: {},
    bots: {},
    chanModes: {},
    readMarkers: {},
    seenRecords: {},
    renderStart: {},
    highlightList: [],
    highlightsUnread: 0
};

const MAX_BUF = 2000;

const RENDER_WINDOW = 400;
const RENDER_CHUNK = 200;
const MAX_DOM = 800;

const HIGHLIGHTS_KEY = '$highlights';
const MAX_HIGHLIGHTS = 500;

const _bufLastDate = {};

function _tsToDateStr(ts) {
    if (!ts || typeof ts === 'string') return null;
    const d = new Date(Number(ts) * 1000);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _mkDateSep(ts) {
    const d = new Date(Number(ts) * 1000);
    const now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    let label;
    if (d.toDateString() === now.toDateString()) label = 'Today';
    else if (d.toDateString() === yest.toDateString()) label = 'Yesterday';
    else label = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const div = mk('div', 'date-sep');
    const lbl = mk('span', 'date-sep-label'); lbl.textContent = label;
    div.appendChild(lbl);
    return div;
}

let _lastActivity = Date.now();
let _isAutoAway = false;
function _trackActivity() {
    _lastActivity = Date.now();
    if (_isAutoAway) {
        _isAutoAway = false;
        for (const [nid, net] of Object.entries(state.networks)) {
            if (net.status === 'connected') wsSend({ type: 'raw', network_id: nid, line: 'AWAY' });
        }
    }
}
document.addEventListener('keydown', _trackActivity, true);
document.addEventListener('mousemove', _trackActivity, { passive: true });
setInterval(() => {
    const s = state.settings.advanced || {};
    if (!s.autoAway) return;
    const mins = Math.max(1, parseInt(s.autoAwayMinutes) || 10);
    if (!_isAutoAway && Date.now() - _lastActivity > mins * 60_000) {
        _isAutoAway = true;
        const msg = s.autoAwayMsg || 'Auto-away';
        for (const [nid, net] of Object.entries(state.networks)) {
            if (net.status === 'connected') wsSend({ type: 'raw', network_id: nid, line: `AWAY :${msg}` });
        }
    }
}, 30_000);

let ws = null;
function wsConnect() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl;

    if (window.location.port === "" || window.location.port === "80" || window.location.port === "443") {
        wsUrl = `${proto}//${window.location.host}/ws`;
    } else {
        wsUrl = `${proto}//${window.location.hostname}:8765`;
    }

    ws = new WebSocket(wsUrl);
    ws.onopen = () => { setWsDot('connected', 'Connected'); };
    ws.onclose = () => { setWsDot('disconnected', 'Disconnected'); setTimeout(wsConnect, 3_000); };
    ws.onerror = e => {
        setWsDot('error', 'Error');
        if (window.location.protocol === 'https:' && proto === 'wss:') {
            console.error("WebSocket connection failure. If you are using HTTPS, ensure the bouncer has SSL certificates configured or use a reverse proxy.");
            if (!state.sslAlertShown) {
                alert("WebSocket connection failed. Since you are using HTTPS, you likely need to configure SSL for the bouncer as well (WSS) or use a reverse proxy. Check the browser console for more details.");
                state.sslAlertShown = true;
            }
        }
    };
    ws.onmessage = e => { try { dispatch(JSON.parse(e.data)); } catch (_) { } };
}
function setWsDot(cls, label) {
    $('ws-dot').className = `dot ${cls}`;
    $('ws-label').textContent = label;

    const md = $('ws-dot-m');
    if (md) md.className = `dot ${cls}`;
}
function wsSend(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function dispatch(m) {
    switch (m.type) {
        case 'init': return onInit(m);
        case 'network_status': return onNetStatus(m);
        case 'reconnect_countdown': return onReconnectCountdown(m);
        case 'message': onMessage(m); return;
        case 'action': onAction(m); return;
        case 'notice': onNotice(m); return;
        case 'highlight': onHighlight(m); return;
        case 'backlog': onBacklog(m); return;
        case 'history': return onHistory(m);
        case 'join': onJoin(m); return;
        case 'part': onPart(m); return;
        case 'quit': onQuit(m); return;
        case 'nick_change': onNickChange(m); return;
        case 'kick': onKick(m); return;
        case 'mode': onMode(m); return;
        case 'topic': onTopic(m); return;
        case 'names': return onNames(m);
        case 'away_update': return onAwayUpdate(m);
        case 'whois_info': return onWhoisInfo(m);
        case 'chan_modes': return onChanModes(m);
        case 'invite': return onInvite(m);
        case 'self_away': return onSelfAway(m);
        case 'plugin_event': return onPluginEvent(m);
        case 'plugin_notify': return onPluginNotify(m);
        case 'js_plugin_run': return runJsPlugin(m.name, m.code);
        case 'js_plugin_reload': return runJsPlugin(m.name, m.code);
        case 'js_plugin_unload': return unloadJsPlugin(m.name);
        case 'log_dates': return onLogDates(m);
        case 'log_content': return onLogContent(m);
        case 'search_results': return onSearchResults(m);
        case 'list_channels': return onListChannels(m);
        case 'server_log': onServerLog(m); return;
        case 'raw_traffic': onRawTraffic(m); return;
        case 'auth_required': $('login-modal').classList.remove('hidden'); break;
        case 'auth_success': $('login-modal').classList.add('hidden'); break;
        case 'auth_error': $('li-error').textContent = m.message; $('li-error').classList.remove('hidden'); break;
        case 'settings_saved': return;
        case 'settings':
            state.settings = m.settings;
            loadIdentityForm();
            renderNetList();
            if (state.settings.notifications) {
                state.notifications = true;
                if ($('pref-notifications')) $('pref-notifications').checked = true;
            }
            if ($('pref-push-notifications')) {
                $('pref-push-notifications').checked = !!state.settings.pushNotifications;
            }
            if (state.active) switchBuf(state.active);
            break;
        case 'plugin_list': return onPluginList(m);
        case 'plugin_code': return onPluginCode(m);
        case 'plugin_saved': return onPluginSaved(m);
        case 'plugin_deleted': return onPluginDeleted(m);
    }
}

function handleDeepLink() {
    if (!window.location.hash) return false;
    const hashVal = decodeURIComponent(window.location.hash.substring(1));
    if (!hashVal) return false;
    if (hashVal === HIGHLIGHTS_KEY) {
        switchBuf(HIGHLIGHTS_KEY);
        return true;
    }
    const parts = hashVal.split('/');
    if (parts.length === 2) {
        const netId = parts[0];
        const target = parts[1];
        if (state.networks[netId]) {
            const isDM = !target.startsWith('#') && !target.startsWith('&') && target !== 'Status' && target !== 'Console';
            if (isDM) {
                ensureDmBuf(netId, target);
            } else {
                mkBuf(hashVal);
            }
            switchBuf(hashVal);
            return true;
        }
    }
    return false;
}

function onInit(m) {
    state.settings = m.settings || { networks: [], identity: {} };

    try {
        state.readMarkers = JSON.parse(localStorage.getItem('ircircuit.readMarkers')) || {};
    } catch (_) {
        state.readMarkers = {};
    }

    state.highlightList = Array.isArray(m.highlights) ? m.highlights : [];
    state.highlightsUnread = 0;

    if (state.settings.theme) applyTheme(state.settings.theme);
    for (const n of (m.networks || [])) {
        state.networks[n.id] = { ...n, channels: n.channels || [] };

        mkBuf(`${n.id}/Status`);
        for (const ch of (n.channels || [])) mkBuf(`${n.id}/${ch}`);
    }
    renderTree();
    renderNetList();
    loadIdentityForm();
    if (!handleDeepLink()) {
        showWelcome();
    }
    if (state.settings.advanced?.rawConsole) toggleRawConsole(true);

    for (const { name, code } of (m.js_plugins || [])) {
        runJsPlugin(name, code);
    }
    if (state.settings.pushNotifications) {
        subscribeToPush();
    }
}

function toggleRawConsole(enabled) {
    wsSend({ type: 'toggle_debug', enabled: !!enabled });
    if (enabled) {

        for (const nid of Object.keys(state.networks)) {
            const key = `${nid}/Console`;
            mkBuf(key);
        }
        renderTree();
    }
}

function onRawTraffic(m) {
    if (!state.settings.advanced?.rawConsole) return;
    const key = `${m.network}/Console`;
    mkBuf(key);
    pushRec(key, { type: 'raw-traffic', text: m.line, ts: m.ts || (Date.now() / 1000) });
}

function onNetStatus(m) {
    const prev = state.networks[m.network] || {};
    state.networks[m.network] = {
        id: m.network, name: m.name || m.network,
        nick: m.nick || prev.nick || '?',
        status: m.status,
        channels: m.channels || prev.channels || [],
        ssl: m.ssl ?? prev.ssl ?? false,
        away: prev.away ?? false
    };
    if (m.latency != null) state.pingLatency[m.network] = m.latency;

    mkBuf(`${m.network}/Status`);
    for (const ch of state.networks[m.network].channels) mkBuf(`${m.network}/${ch}`);

    const keep = new Set();
    keep.add(`${m.network}/Status`);
    keep.add(`${m.network}/Console`);
    for (const ch of (state.networks[m.network].channels || [])) {
        keep.add(`${m.network}/${ch}`);
    }
    for (const dmNick of (state.dms[m.network] || [])) {
        keep.add(`${m.network}/${dmNick}`);
    }
    for (const key of Object.keys(state.unread)) {
        if (key.startsWith(m.network + '/') && !keep.has(key)) {
            delete state.unread[key];
        }
    }
    for (const key of Object.keys(state.highlights)) {
        if (key.startsWith(m.network + '/') && !keep.has(key)) {
            delete state.highlights[key];
        }
    }

    updateTitle();
    renderTree();
    renderNetList();
    if (state.active?.startsWith(m.network + '/')) updateTopBar();

    if (m.status === 'connected' && prev.status && prev.status !== 'connected') {
        const msg = prev.status === 'reconnecting' ? '\u2014 Reconnected \u2014' : '\u2014 Connected \u2014';
        const ts = Date.now() / 1e3;
        pushRec(`${m.network}/Status`, { type: 'reconnect', nick: '', text: msg, ts });
        if (state.active?.startsWith(m.network + '/') && state.active !== `${m.network}/Status`) {
            pushRec(state.active, { type: 'reconnect', nick: '', text: msg, ts });
        }
    }
}

function onReconnectCountdown(m) {
    const net = state.networks[m.network];
    if (!net) return;
    net.status = 'reconnecting';
    net.reconnectIn = m.seconds;
    renderTree();
    if (state.active?.startsWith(m.network + '/')) updateTopBar();
}

function dmNickCanonical(netId, nick) {
    const lower = nick.toLowerCase();
    const dms = state.dms[netId];
    if (dms) {
        for (const existing of dms) {
            if (existing.toLowerCase() === lower) return existing;
        }
    }
    return nick;
}

function ensureDmBuf(netId, nick) {
    if (!netId || !nick) return;
    if (!state.dms[netId]) state.dms[netId] = new Set();
    state.dms[netId].add(nick);
    mkBuf(`${netId}/${nick}`);
    renderTree();
}
function onBacklog(m) {

    for (const rec of (m.messages || [])) dispatch(rec);
}

const _historyLoading = {};

function requestOlderHistory(netId, chan, key) {
    if (_historyLoading[key]) return;
    const buf = state.buffers[key] || [];
    const oldest = buf.find(r => Number.isFinite(Number(r.ts)));
    if (!oldest) { openLogViewer(); return; }
    _historyLoading[key] = true;
    wsSend({ type: 'request_history', network: netId, channel: chan, before_ts: oldest.ts });
}

function _historyRecordToInternal(rec) {
    switch (rec.type) {
        case 'message': return { type: 'privmsg', nick: rec.nick, text: rec.message, ts: rec.ts, self: !!rec.self };
        case 'action': return { type: 'action', nick: rec.nick, text: rec.message, ts: rec.ts, self: !!rec.self };
        case 'notice': return { type: 'notice', nick: rec.nick, text: rec.message, ts: rec.ts };
        case 'join': return { type: 'join', nick: '', icon: '>', text: `${rec.nick} joined ${rec.channel}`, ts: rec.ts || 0 };
        case 'part': return { type: 'part', nick: '', icon: '<', text: `${rec.nick} left ${rec.channel}${rec.message ? ` (${rec.message})` : ''}`, ts: rec.ts || 0 };
        case 'quit': return { type: 'quit', nick: '', icon: 'x', text: `${rec.nick} quit${rec.message ? ` (${rec.message})` : ''}`, ts: rec.ts || 0 };
        case 'topic': return { type: 'topic', nick: rec.setter || '', text: `set the topic: ${rec.topic}`, ts: rec.ts || 0 };
        case 'mode': return { type: 'mode', nick: rec.nick, text: `sets mode ${rec.mode}`, ts: rec.ts || 0 };
        default: return null;
    }
}

function onHistory(m) {
    const key = `${m.network}/${m.channel}`;
    _historyLoading[key] = false;
    const msgs = m.messages || [];
    if (!msgs.length) { openLogViewer(); return; }
    mkBuf(key);
    const converted = msgs.map(_historyRecordToInternal).filter(Boolean);
    if (!converted.length) return;

    for (const rec of converted) {
        const fp = _recordFingerprint(key, rec);
        if (!fp) continue;
        if (!state.seenRecords[key]) state.seenRecords[key] = { set: new Set(), order: [] };
        const bucket = state.seenRecords[key];
        if (!bucket.set.has(fp)) { bucket.set.add(fp); bucket.order.push(fp); }
    }

    if (state.readMarkers[key] > 0) state.readMarkers[key] += converted.length;
    state.buffers[key] = converted.concat(state.buffers[key]);

    if (state.buffers[key].length > MAX_BUF) {
        state.buffers[key].length = MAX_BUF;
    }

    if (state.active === key) {
        const buf = $('chat-buffer');
        const prevH = buf.scrollHeight, prevT = buf.scrollTop;

        _renderBuffer(key, 0);
        buf.scrollTop = buf.scrollHeight - prevH + prevT;
    }
}
function onMessage(m) {
    if (isIgnored(m.nick, m.mask)) return;
    const key = `${m.network}/${m.channel}`;
    if (m.message && m.message.charCodeAt(0) === 1 && m.message.startsWith('\x01ACTION ')) {
        m.message = m.message.slice(8).replace(/\x01$/, '');
        return onAction(m);
    }
    const isDM = !m.channel?.startsWith('#') && !m.channel?.startsWith('&');
    if (isDM) ensureDmBuf(m.network, m.channel);

    const event = m.self ? (isDM ? 'Your Private Message' : 'Your Message')
        : (isDM ? 'Private Message' : 'Channel Message');
    if (_firePrint(event, [m.nick, m.message, m.channel, m.network])) return;
    const hl = !m.self && isHighlight(m.nick, m.message, m.network);
    pushRec(key, { type: 'privmsg', nick: m.nick, text: m.message, ts: m.ts, self: !!m.self, hl, network: m.network });
    if (!m.self && (hl || isDM)) notify(m.nick || m.network, m.message, key);

    for (const cb of (_pluginEventHooks['message'] || [])) { try { cb(m); } catch (e) { } }
}
function onAction(m) {
    if (isIgnored(m.nick, m.mask)) return;
    const key = `${m.network}/${m.channel}`;
    const isDM = !m.channel?.startsWith('#') && !m.channel?.startsWith('&');
    if (isDM) ensureDmBuf(m.network, m.channel);
    const event = m.self ? 'Your Action' : 'Channel Action';
    if (_firePrint(event, [m.nick, m.message, m.channel, m.network])) return;
    const hl = !m.self && isHighlight(m.nick, m.message, m.network);
    pushRec(key, { type: 'action', nick: m.nick, text: m.message, ts: m.ts, self: !!m.self, hl, network: m.network });
    if (!m.self && (hl || isDM)) notify(m.nick || m.network, `* ${m.nick} ${m.message}`, key);
}
function onNotice(m) {
    let ch = m.channel;
    if (state.settings.bouncer?.routeNotices && ch === 'Status') {
        const [activeNet] = (state.active || '').split('/');
        if (activeNet === m.network) ch = state.active.split('/')[1] || 'Status';
    }
    pushRec(`${m.network}/${ch}`, { type: 'notice', nick: m.nick, text: m.message, ts: m.ts });
}
function onJoin(m) {
    const key = `${m.network}/${m.channel || 'Status'}`;
    const netChan = `${m.network}/${m.channel}`;
    if (m.channel) {
        if (!state.nicks[netChan]) state.nicks[netChan] = {};

        if (!state.nicks[netChan][m.nick]) state.nicks[netChan][m.nick] = '';
    }
    _firePrint('Join', [m.nick, m.channel, m.network]);
    for (const cb of (_pluginEventHooks['join'] || [])) { try { cb(m); } catch (e) { } }
    pushRec(key, { type: 'join', nick: '', icon: '>', text: `${m.nick} joined ${m.channel}`, ts: Date.now() / 1e3 });
    if (state.active === key) renderUserList();
    watchedNickAlert(m.nick, `joined ${m.channel}`, key);
}
function onPart(m) {
    const key = `${m.network}/${m.channel || 'Status'}`;
    const netChan = `${m.network}/${m.channel}`;
    if (m.channel && state.nicks[netChan]) {
        delete state.nicks[netChan][m.nick];
    }
    _firePrint('Part', [m.nick, m.channel, m.message || '', m.network]);
    for (const cb of (_pluginEventHooks['part'] || [])) { try { cb(m); } catch (e) { } }
    pushRec(key, { type: 'part', nick: '', icon: '<', text: `${m.nick} left ${m.channel}${m.message ? ` (${m.message})` : ''}`, ts: Date.now() / 1e3 });
    if (state.active === key) renderUserList();
}
function onQuit(m) {
    const chans = m.channels || [];
    let needsRender = false;
    _firePrint('Quit', [m.nick, m.message || '', m.network]);
    for (const cb of (_pluginEventHooks['quit'] || [])) { try { cb(m); } catch (e) { } }
    for (const ch of chans) {
        const key = `${m.network}/${ch}`;
        if (state.nicks[key]) delete state.nicks[key][m.nick];
        if (state.active === key) needsRender = true;
        pushRec(key, { type: 'quit', nick: '', icon: 'x', text: `${m.nick} quit${m.message ? ` (${m.message})` : ''}`, ts: Date.now() / 1e3 });
    }
    if (state.buffers[`${m.network}/${m.nick}`]) {
        pushRec(`${m.network}/${m.nick}`, { type: 'quit', nick: '', icon: 'x', text: `${m.nick} quit${m.message ? ` (${m.message})` : ''}`, ts: Date.now() / 1e3 });
    }
    if (needsRender) renderUserList();
    watchedNickAlert(m.nick, `quit${m.message ? ` (${m.message})` : ''}`, null);
}
function onNickChange(m) {
    const chans = m.channels || [];
    const net = state.networks[m.network] || {};
    const myOldNick = net.nick;
    const isMe = m.old_nick === myOldNick || m.new_nick === myOldNick || m.old_nick === '?';
    for (const ch of chans) {
        const key = `${m.network}/${ch}`;
        if (state.nicks[key]) {
            const cleanOld = m.old_nick.replace(/^[~&@%+]/, '');
            const cleanNew = m.new_nick.replace(/^[~&@%+]/, '');
            const oldPfx = state.nicks[key][cleanOld] || '';
            delete state.nicks[key][cleanOld];
            state.nicks[key][cleanNew] = oldPfx;
        }
        pushRec(key, { type: 'nick-change', nick: '', text: `${m.old_nick} -> ${m.new_nick}`, ts: Date.now() / 1e3 });
    }

    if (isMe) {
        const msg = (m.old_nick === m.new_nick) ? `Your nick is ${m.new_nick}` : `You are now known as ${m.new_nick}`;
        sysMsg(m.network, 'Status', msg, 'status');

        if (state.active?.startsWith(m.network + '/') && state.active !== `${m.network}/Status`) {
            pushRec(state.active, { type: 'nick-change', nick: '', text: msg, ts: Date.now() / 1e3 });
        }
    }

    if (state.active?.startsWith(m.network + '/') &&
        chans.includes(state.active.split('/')[1])) {
        renderUserList();
    }

    const awaySet = state.away[m.network];
    if (awaySet?.has(m.old_nick)) {
        awaySet.delete(m.old_nick);
        awaySet.add(m.new_nick);
    }
    watchedNickAlert(m.old_nick, `is now known as ${m.new_nick}`, null);

    const dmCanonOld = dmNickCanonical(m.network, m.old_nick);
    const dmOldKey = `${m.network}/${dmCanonOld}`;
    const dmNewKey = `${m.network}/${m.new_nick}`;
    if (state.buffers[dmOldKey]) {
        state.buffers[dmNewKey] = state.buffers[dmOldKey];
        delete state.buffers[dmOldKey];
        if (state.seenRecords[dmOldKey]) { state.seenRecords[dmNewKey] = state.seenRecords[dmOldKey]; delete state.seenRecords[dmOldKey]; }
        if (state.renderStart[dmOldKey] !== undefined) { state.renderStart[dmNewKey] = state.renderStart[dmOldKey]; delete state.renderStart[dmOldKey]; }
        if (state.topics[dmOldKey] !== undefined) { state.topics[dmNewKey] = state.topics[dmOldKey]; delete state.topics[dmOldKey]; }
        if (state.unread[dmOldKey] !== undefined) { state.unread[dmNewKey] = state.unread[dmOldKey]; delete state.unread[dmOldKey]; }
        if (state.highlights[dmOldKey] !== undefined) { state.highlights[dmNewKey] = state.highlights[dmOldKey]; delete state.highlights[dmOldKey]; }
        const dms = state.dms[m.network];
        if (dms) { dms.delete(dmCanonOld); dms.add(m.new_nick); }
        if (state.active === dmOldKey) state.active = dmNewKey;
        pushRec(dmNewKey, { type: 'nick-change', nick: '', text: `${m.old_nick} -> ${m.new_nick}`, ts: Date.now() / 1e3 });
        renderTree();
    }
}
function onKick(m) {
    const key = `${m.network}/${m.channel || 'Status'}`;
    const netChan = `${m.network}/${m.channel}`;
    if (m.channel && state.nicks[netChan]) {
        delete state.nicks[netChan][m.kicked];
    }
    pushRec(key, { type: 'kick', nick: '', icon: 'x', text: `${m.nick} kicked ${m.kicked}${m.message ? ` (${m.message})` : ''}`, ts: Date.now() / 1e3 });
    if (state.active === key) renderUserList();
}
function onMode(m) {
    const key = `${m.network}/${m.channel || 'Status'}`;
    const chan = m.channel;

    if (chan && m.mode && state.nicks[key]) {
        const parts = m.mode.split(' ');
        const modeStr = parts[0];
        const modeArgs = parts.slice(1);
        const pfxMap = { 'o': '@', 'v': '+', 'h': '%', 'a': '&', 'q': '~' };

        const nonPfxArg = new Set('beIk');
        let add = true;
        let argIdx = 0;
        for (const ch of modeStr) {
            if (ch === '+') { add = true; continue; }
            if (ch === '-') { add = false; continue; }
            const pfx = pfxMap[ch];
            if (pfx !== undefined) {
                if (argIdx < modeArgs.length) {
                    const tn = modeArgs[argIdx++];
                    if (tn in state.nicks[key]) {
                        let cur = state.nicks[key][tn];
                        if (add) {
                            if (!cur.includes(pfx)) {

                                cur = '~&@%+'.split('').filter(c => cur.includes(c) || c === pfx).join('');
                            }
                        } else {
                            cur = cur.replace(pfx, '');
                        }
                        state.nicks[key][tn] = cur;
                    }
                }
            } else if (nonPfxArg.has(ch)) {
                argIdx++;
            } else if (ch === 'l' && add) {
                argIdx++;
            }
        }
        if (state.active === key) renderUserList();
    }

    pushRec(key, { type: 'mode', nick: '', icon: '*', text: `${m.nick} sets mode ${m.mode}`, ts: Date.now() / 1e3 });
}
function onTopic(m) {
    const key = `${m.network}/${m.channel}`;
    state.topics[key] = m.topic;
    if (state.active === key) {

        if (!$('topic-text').classList.contains('editing')) {
            $('topic-text').innerHTML = formatText(esc(m.topic || ''));
        }
    }

    if (m.setter) {
        pushRec(key, { type: 'status', nick: '', text: `${m.setter} changed topic to: ${m.topic}`, ts: Date.now() / 1e3 });
    }
}
function editTopic() {
    if (!state.active) return;
    const [netId, chan] = state.active.split('/');
    if (!chan || chan === 'Status') return;
    const span = $('topic-text');
    if (span.classList.contains('editing')) return;
    span.classList.add('editing');

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = 'topic-edit-inp';
    inp.value = state.topics[state.active] || '';
    inp.placeholder = 'Set topic…';

    let done = false;
    const finish = (send) => {
        if (done) return;
        done = true;
        inp.onblur = null;
        const val = inp.value.trim();
        inp.replaceWith(span);
        span.classList.remove('editing');
        if (send && val !== (state.topics[state.active] || '')) {
            wsSend({ type: 'raw', network: netId, line: `TOPIC ${chan} :${val}` });
        }
    };
    inp.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    inp.onblur = () => finish(false);

    span.replaceWith(inp);
    inp.focus();
    inp.select();
}
function onAwayUpdate(m) {
    if (!state.away[m.network]) state.away[m.network] = new Set();
    if (!state.bots[m.network]) state.bots[m.network] = new Set();
    const awaySet = state.away[m.network];
    const botSet = state.bots[m.network];
    const key = `${m.network}/${m.channel}`;

    for (const n of Object.keys(state.nicks[key] || {})) {
        awaySet.delete(n);
        botSet.delete(n);
    }
    for (const n of (m.away || [])) awaySet.add(n);
    for (const n of (m.bots || [])) botSet.add(n);
    if (state.active === key) renderUserList();
}
function onNames(m) {
    const key = `${m.network}/${m.channel}`;
    const map = {};
    m.users.forEach(u => {
        const pfx = u.match(/^[~&@%+]+/)?.[0] || '';
        map[u.slice(pfx.length)] = pfx;
    });
    state.nicks[key] = map;
    if (state.active === key) renderUserList();
}
function onServerLog(m) {

    if (m.verbose && !state.settings.verboseLogs) return;

    if (m.is_whois && m.whois_nick) {
        const nid = m.network;
        const canonNick = dmNickCanonical(nid, m.whois_nick);

        if (m.is_whowas) {

            ensureDmBuf(nid, canonNick);
            pushRec(`${nid}/${canonNick}`, { type: 'whois-log', text: m.message, whois_data: { nick: canonNick }, ts: m.ts });
            return;
        }

        if (state.settings.bouncer?.modernWhois !== false) return;

        ensureDmBuf(nid, canonNick);
        pushRec(`${nid}/${canonNick}`, { type: 'whois-log', text: m.message, whois_data: { nick: canonNick }, ts: m.ts });
        return;
    }

    const key = m.channel ? `${m.network}/${m.channel}` : `${m.network}/Status`;
    mkBuf(key);
    pushRec(key, { type: 'server-log', nick: '', text: m.message, ts: m.ts });
}

function mkBuf(key) { if (!state.buffers[key]) state.buffers[key] = []; }

const _DEDUP_TYPES = new Set([
    'privmsg', 'action', 'notice', 'join', 'part', 'quit',
    'nick-change', 'kick', 'mode', 'topic', 'server-log',
    'whois-log', 'invite-notice'
]);

function _recordFingerprint(key, rec) {
    if (!key || !rec || !_DEDUP_TYPES.has(rec.type)) return '';
    const tsNum = Number(rec.ts);
    if (!Number.isFinite(tsNum)) return '';
    const nick = rec.nick || '';
    const icon = rec.icon || '';
    const text = rec.text || rec.message || '';
    return `${rec.type}|${nick}|${icon}|${text}|${tsNum.toFixed(3)}`;
}

function _isReplayDuplicate(key, rec) {
    const fp = _recordFingerprint(key, rec);
    if (!fp) return false;
    if (!state.seenRecords[key]) {
        state.seenRecords[key] = { set: new Set(), order: [] };
    }
    const bucket = state.seenRecords[key];
    if (bucket.set.has(fp)) return true;
    bucket.set.add(fp);
    bucket.order.push(fp);
    if (bucket.order.length > 2000) {
        const old = bucket.order.shift();
        bucket.set.delete(old);
    }
    return false;
}

function _trimBufDom(buf) {
    buf.removeChild(buf.firstElementChild);
    const first = buf.firstElementChild;
    if (first && first.classList.contains('ml-grouped')) first.classList.remove('ml-grouped');
}

function _trimActiveWindow(key, buf) {
    while (buf.childElementCount > MAX_DOM) {
        const removed = buf.firstElementChild;
        if (!removed) break;
        const wasRecord = !!removed._rec;
        buf.removeChild(removed);
        if (wasRecord) state.renderStart[key] = (state.renderStart[key] || 0) + 1;
        const first = buf.firstElementChild;
        if (first && first.classList.contains('ml-grouped')) first.classList.remove('ml-grouped');
    }
}
function pushRec(key, rec) {
    mkBuf(key);
    if (_isReplayDuplicate(key, rec)) return;
    const b = state.buffers[key];
    b.push(rec);
    if (b.length > MAX_BUF) {
        b.shift();

        if (state.readMarkers[key] > 0) state.readMarkers[key]--;
        if (state.renderStart[key] > 0) state.renderStart[key]--;
    }

    if (state.active === key) {
        const buf = $('chat-buffer');
        const wasAtBottom = buf.scrollHeight - buf.scrollTop <= buf.clientHeight + 40;
        const isEvType = ['join', 'part', 'quit'].includes(rec.type);
        const condense = !!(state.settings.advanced?.condenseEvents);

        const _ds = _tsToDateStr(rec.ts);
        if (_ds && _ds !== _bufLastDate[key]) {
            _bufLastDate[key] = _ds;
            const sep = _mkDateSep(rec.ts);
            buf.appendChild(sep);
            if (wasAtBottom) _trimActiveWindow(key, buf);
        }

        let line;
        if (condense && isEvType) {
            const nick = _evNickFromRec(rec);
            const grp = _evGroupDom[key];
            if (grp && (rec.ts - grp.ts) < 30) {

                if (rec.type === 'join') grp.joins.push(nick);
                else if (rec.type === 'part') grp.parts.push(nick);
                else grp.quits.push(nick);
                grp.ts = rec.ts;
                grp.el.querySelector('.condensed-text').textContent = _getCondensedText(grp);
                if (wasAtBottom && !state.lockScroll) scrollBot();
            } else {

                const joins = rec.type === 'join' ? [nick] : [];
                const parts = rec.type === 'part' ? [nick] : [];
                const quits = rec.type === 'quit' ? [nick] : [];
                const g = { ts: rec.ts, joins, parts, quits };
                line = _buildCondensedEl(g);
                buf.appendChild(line);
                if (wasAtBottom) _trimActiveWindow(key, buf);
                _evGroupDom[key] = { el: line, ...g };
                if (wasAtBottom && !state.lockScroll) scrollBot();
            }
        } else {
            if (!isEvType) delete _evGroupDom[key];
            line = buildLine(rec);
            buf.appendChild(line);
            _applyGrouping(line);
            fetchPreviewsInElement(line);
            if (wasAtBottom) _trimActiveWindow(key, buf);

            if (wasAtBottom && !state.lockScroll) {
                scrollBot();

                line.querySelectorAll('img, video').forEach(el => {
                    const onMediaLoad = () => {

                        if (buf.scrollHeight - buf.scrollTop <= buf.clientHeight + el.offsetHeight + 100)
                            scrollBot();
                    };
                    if (el.tagName === 'IMG') el.onload = onMediaLoad;
                    else el.onloadedmetadata = onMediaLoad;
                });
            } else if (!wasAtBottom && ['privmsg', 'action', 'notice'].includes(rec.type)) {

                bumpScrollPill();
            }
        }
    } else {
        state.unread[key] = (state.unread[key] || 0) + 1;
        if (rec.hl) state.highlights[key] = true;
        renderTree();
        updateTitle();
    }

    if (!$('log-modal').classList.contains('hidden') &&
        `${state_log.network}/${state_log.channel}` === key &&
        !state_log.searchActive) {

        if (state_log.activeDate === _todayLogStr()) {
            const ll = $('log-lines');
            if (ll) {
                ll.appendChild(buildLine(rec));
                state_log.total = (state_log.total || 0) + 1;
                updateLogStatus();
                ll.scrollTop = ll.scrollHeight;
            }
        }
    }
}
function forAllBuffers(netId, fn) {
    for (const key of Object.keys(state.buffers))
        if (key.startsWith(netId + '/')) fn(key);
}
function sysMsg(netId, chan, text, type = 'status') {
    const key = netId && chan ? `${netId}/${chan}` : state.active;
    if (key) pushRec(key, { type, nick: '', text, ts: Date.now() / 1e3 });
}

function onHighlight(m) {
    const rec = { network: m.network, channel: m.channel, nick: m.nick, text: m.text, ts: m.ts, type: m.type || 'privmsg' };

    const dup = state.highlightList.some(h =>
        h.network === rec.network && h.channel === rec.channel &&
        h.nick === rec.nick && h.text === rec.text && Number(h.ts) === Number(rec.ts));
    if (dup) return;
    state.highlightList.push(rec);
    if (state.highlightList.length > MAX_HIGHLIGHTS) state.highlightList.shift();
    if (state.active === HIGHLIGHTS_KEY) {
        const buf = $('chat-buffer');
        const empty = buf.querySelector('.buf-placeholder');
        if (empty) buf.innerHTML = '';
        buf.appendChild(buildHighlightLine(rec));
        scrollBot();
    } else {
        state.highlightsUnread++;
    }
    renderTree();
    updateTitle();
}

function switchToHighlights() {

    if (state.active && state.active !== HIGHLIGHTS_KEY) {
        const prevBuf = state.buffers[state.active];
        if (prevBuf && prevBuf.length > 0) {
            state.readMarkers[state.active] = prevBuf.length;
            try { localStorage.setItem('ircircuit.readMarkers', JSON.stringify(state.readMarkers)); } catch (_) {}
        }
    }
    delete _evGroupDom[state.active];
    clearBufSearch();
    state.active = HIGHLIGHTS_KEY;
    state.highlightsUnread = 0;
    if (window.location.hash !== '#' + HIGHLIGHTS_KEY) {
        history.replaceState(null, '', '#' + encodeURIComponent(HIGHLIGHTS_KEY));
    }
    updateTitle();
    renderTree();
    renderUserList([]);
    closeMobilePanels();
    const mt = $('m-title');
    if (mt) mt.textContent = 'Highlights';
    $('topic-chan').textContent = 'Highlights';
    $('topic-text').innerHTML = '';
    $('topic-sep').style.display = 'none';
    const modesEl = $('topic-modes'); if (modesEl) modesEl.textContent = '';
    renderHighlights();
}

function renderHighlights() {
    const buf = $('chat-buffer');
    buf.innerHTML = '';
    if (!state.highlightList.length) {
        buf.innerHTML = '<div class="buf-placeholder">No highlights yet. When someone pings your nick or a highlight word, it will show up here.</div>';
        return;
    }
    for (const rec of state.highlightList) buf.appendChild(buildHighlightLine(rec));
    scrollBot();
}

function buildHighlightLine(rec) {
    const net = state.networks[rec.network];
    const netName = net?.name || rec.network;
    const d = mk('div', 'ml mt-highlight');
    d._rec = rec;

    const ts = mk('span', 'ml-ts');
    ts.textContent = fmtTime(rec.ts);
    ts.title = rec.ts ? new Date(rec.ts * 1000).toLocaleString() : '';

    const src = mk('span', 'hl-src');
    src.textContent = `${netName}/${rec.channel}`;
    src.title = 'Go to ' + rec.channel;

    const nick = mk('span', 'ml-nick');
    nick.style.color = nickColour(rec.nick, rec.network);
    nick.textContent = rec.type === 'action' ? '*' : rec.nick;

    const txt = mk('span', 'ml-text');
    if (rec.type === 'action') {
        txt.innerHTML = `<em style="color:${nickColour(rec.nick, rec.network)}">${esc(rec.nick)} ${formatText(esc(rec.text))}</em>`;
    } else {
        txt.innerHTML = formatText(esc(rec.text));
    }

    d.append(ts, src, nick, txt);
    d.style.cursor = 'pointer';
    d.title = 'Click to jump to this message in ' + rec.channel;
    d.onclick = () => jumpToHighlight(rec);
    return d;
}

function jumpToHighlight(rec) {
    const key = `${rec.network}/${rec.channel}`;
    const isDM = !rec.channel.startsWith('#') && !rec.channel.startsWith('&');
    if (isDM) ensureDmBuf(rec.network, rec.channel);
    else mkBuf(key);
    switchBuf(key);

    const buf = $('chat-buffer');
    const findTarget = () => {
        for (const el of buf.children) {
            const r = el._rec;
            if (r && r.nick === rec.nick && r.text === rec.text && Number(r.ts) === Number(rec.ts)) return el;
        }
        return null;
    };
    let target = findTarget();
    if (!target) {

        const b = state.buffers[key] || [];
        const idx = b.findIndex(r => r.nick === rec.nick && r.text === rec.text && Number(r.ts) === Number(rec.ts));
        if (idx >= 0) {
            _renderBuffer(key, Math.max(0, idx - Math.floor(RENDER_WINDOW / 2)));
            target = findTarget();
        }
    }
    if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        target.classList.add('hl-jump-flash');
        setTimeout(() => target.classList.remove('hl-jump-flash'), 1600);
    }
}

function _renderBuffer(key, startIdx, rmPos) {
    const buf = $('chat-buffer');
    buf.innerHTML = '';
    const b = state.buffers[key] || [];
    startIdx = Math.max(0, Math.min(startIdx | 0, b.length));
    state.renderStart[key] = startIdx;
    const _condense = !!(state.settings.advanced?.condenseEvents);
    let _cgrp = null;
    for (let i = startIdx; i < b.length; i++) {
        const rec = b[i];
        if (rmPos !== undefined && i === rmPos) {
            const rmEl = mk('div', 'read-marker');
            const rmLbl = mk('span', 'read-marker-lbl'); rmLbl.textContent = 'New Messages';
            rmEl.appendChild(rmLbl);
            buf.appendChild(rmEl);
            _cgrp = null;
        }
        const isEvType = ['join', 'part', 'quit'].includes(rec.type);
        if (_condense && isEvType) {
            const nick = _evNickFromRec(rec);
            if (_cgrp && (rec.ts - _cgrp.ts) < 30) {
                if (rec.type === 'join') _cgrp.joins.push(nick);
                else if (rec.type === 'part') _cgrp.parts.push(nick);
                else _cgrp.quits.push(nick);
                _cgrp.ts = rec.ts;
                _cgrp.el.querySelector('.condensed-text').textContent = _getCondensedText(_cgrp);
            } else {
                const joins = rec.type === 'join' ? [nick] : [];
                const parts = rec.type === 'part' ? [nick] : [];
                const quits = rec.type === 'quit' ? [nick] : [];
                const g = { ts: rec.ts, joins, parts, quits };
                const el = _buildCondensedEl(g);
                buf.appendChild(el);
                _cgrp = { el, ...g };
            }
        } else {
            if (!isEvType) _cgrp = null;
            const _el = buildLine(rec);
            buf.appendChild(_el);
            _applyGrouping(_el);
        }
    }
    fetchPreviewsInElement(buf);
    if (_cgrp) _evGroupDom[key] = _cgrp;

    const chan = key.split('/')[1];
    if (startIdx === 0 && b.length > 0 && chan && chan.startsWith('#')) {
        const netId = key.split('/')[0];
        const hint = mk('div', 'load-earlier-hint');
        hint.textContent = 'Load earlier messages...';
        hint.onclick = () => requestOlderHistory(netId, chan, key);
        buf.insertBefore(hint, buf.firstChild);
    }
}

function switchBuf(key) {
    if (!key) return;
    if (key === HIGHLIGHTS_KEY) return switchToHighlights();

    if (state.active && state.active !== key) {
        const prevBuf = state.buffers[state.active];
        if (prevBuf && prevBuf.length > 0) {
            state.readMarkers[state.active] = prevBuf.length;
            try { localStorage.setItem('ircircuit.readMarkers', JSON.stringify(state.readMarkers)); } catch (_) {}
        }
    }
    const hadUnread = (state.unread[key] || 0) > 0;

    delete _evGroupDom[state.active];
    clearBufSearch();
    delete _bufLastDate[key];
    state.active = key;
    if (window.location.hash !== '#' + key) {
        history.replaceState(null, '', '#' + encodeURIComponent(key));
    }
    delete state.unread[key];
    delete state.highlights[key];
    updateTitle();
    renderTree();
    renderUserList([]);

    closeMobilePanels();

    const [netId, chan] = key.split('/');

    const mt = $('m-title');
    if (mt) mt.textContent = (chan === 'Status' ? (state.networks[netId]?.name || netId) : chan) || 'WebIRC';

    const b = state.buffers[key] || [];
    const _rmPos = hadUnread ? state.readMarkers[key] : undefined;

    let _start = Math.max(0, b.length - RENDER_WINDOW);
    if (_rmPos !== undefined && _rmPos < _start) _start = Math.max(0, _rmPos - 3);
    _renderBuffer(key, _start, _rmPos);

    if (_rmPos !== undefined) {
        delete state.readMarkers[key];
        try { localStorage.setItem('ircircuit.readMarkers', JSON.stringify(state.readMarkers)); } catch (_) {}
    }
    if (state.active === key) {
        updateTopBar();
        const isStatus = chan === 'Status';
        $('topic-text').innerHTML = isStatus ? '' : formatText(esc(state.topics[key] || ''));
        $('topic-chan').textContent = isStatus ? (state.networks[netId]?.name || netId) : chan;
        $('topic-sep').style.display = isStatus ? 'none' : '';
        renderUserList();

        if (chan && (chan.startsWith('#') || chan.startsWith('&'))) {
            wsSend({ type: 'raw', network: netId, line: `NAMES ${chan}` });
        }
    }

    const rmEl = $('chat-buffer').querySelector('.read-marker');
    if (rmEl) {
        rmEl.scrollIntoView({ block: 'start', behavior: 'instant' });
    } else {
        scrollBot();
    }
    resetScrollPill();
    requestAnimationFrame(updateScrollPill);
}

let _windowScrollBusy = false;
function _onBufScroll() {
    updateScrollPill();
    if (_windowScrollBusy) return;
    const key = state.active;
    if (!key || key === HIGHLIGHTS_KEY) return;
    const buf = $('chat-buffer');
    if (buf.scrollTop > 140) return;
    const start = state.renderStart[key] || 0;
    if (start > 0) {
        _windowScrollBusy = true;
        const prevH = buf.scrollHeight, prevT = buf.scrollTop;
        _renderBuffer(key, Math.max(0, start - RENDER_CHUNK));
        buf.scrollTop = buf.scrollHeight - prevH + prevT;
        _windowScrollBusy = false;
    } else {
        const [netId, chan] = key.split('/');
        if (chan && chan.startsWith('#')) requestOlderHistory(netId, chan, key);
    }
}
function showWelcome() {
    $('chat-buffer').innerHTML = '<div class="buf-placeholder">Select a channel, or open <strong>Settings → Networks</strong> to connect.</div>';
    $('own-nick').textContent = '-';
    $('topic-chan').textContent = 'WebIRC';
    $('topic-text').innerHTML = formatText(esc('Welcome — Modern web IRC client'));
    $('topic-sep').style.display = '';
    const mt = $('m-title');
    if (mt) mt.textContent = 'WebIRC';
}
function updateTopBar() {
    if (!state.active) return;
    const [netId, ch] = state.active.split('/');
    const net = state.networks[netId];
    const ownNickEl = $('own-nick');
    if (ownNickEl) {
        ownNickEl.textContent = net?.nick || '-';
        ownNickEl.classList.toggle('nick-away', !!net?.away);
    }
    const isStatus = ch === 'Status';
    const chanLabel = isStatus ? (net?.name || netId) : (ch || netId);
    const topicChanEl = $('topic-chan');
    topicChanEl.textContent = chanLabel;
    topicChanEl.title = isStatus ? '' : 'Click to copy';
    topicChanEl.style.cursor = isStatus ? '' : 'pointer';
    topicChanEl.onclick = isStatus ? null : () => {
        (navigator.clipboard?.writeText(chanLabel) || Promise.reject()).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = chanLabel; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            ta.remove();
        });
    };

    const inp = $('input');
    if (inp) inp.placeholder = isStatus ? '/join #channel or type a command\u2026' : `Message ${ch}`;
    if (!$('topic-text').classList.contains('editing')) {
        $('topic-text').innerHTML = isStatus ? '' : formatText(esc(state.topics[state.active] || ''));
    }
    $('topic-sep').style.display = isStatus ? 'none' : '';

    const modesEl = $('topic-modes');
    if (modesEl) {
        const modes = (!isStatus && state.chanModes[state.active]) || '';
        modesEl.textContent = modes ? `[${modes}]` : '';
    }

    const sslEl = $('topic-ssl');
    if (sslEl) sslEl.textContent = net?.ssl ? '[SSL]' : '';

    const topicEl = $('topic-text');
    const myNick = net?.nick;
    const myPrefix = (state.nicks[state.active] || {})[myNick] || '';
    const canEdit = !isStatus && ch && myPrefix && ['~', '&', '@', '%'].some(p => myPrefix.includes(p));
    topicEl.classList.toggle('topic-editable', canEdit);

    const latEl = $('topic-latency');
    if (latEl) {
        const lat = state.pingLatency[netId];
        if (lat != null) {
            latEl.textContent = `${lat}ms`;
            latEl.className = 'topic-latency ' + (lat < 100 ? 'ping-good' : lat < 300 ? 'ping-ok' : 'ping-bad');
        } else {
            latEl.textContent = '';
            latEl.className = 'topic-latency';
        }
    }

    const ucEl = $('topic-ucount');
    if (ucEl) {
        const count = Object.keys(state.nicks[state.active] || {}).length;
        ucEl.textContent = count ? `${count} users` : '';
    }

    const mt = $('m-title');
    if (mt) mt.textContent = ch || netId || 'WebIRC';
}
function scrollBot() {
    const buf = $('chat-buffer');
    buf.scrollTop = buf.scrollHeight;
}

let _pillCount = 0;
function _bufAtBottom() {
    const buf = $('chat-buffer');
    return buf.scrollHeight - buf.scrollTop <= buf.clientHeight + 40;
}
function resetScrollPill() {
    _pillCount = 0;
    const pill = $('scroll-bottom-pill');
    if (pill) pill.classList.remove('visible');
    const c = $('scroll-bottom-count');
    if (c) c.textContent = '';
}
function updateScrollPill() {
    const pill = $('scroll-bottom-pill');
    if (!pill) return;
    if (_bufAtBottom()) resetScrollPill();
    else pill.classList.add('visible');
}
function bumpScrollPill() {
    _pillCount++;
    const c = $('scroll-bottom-count');
    if (c) c.textContent = _pillCount > 99 ? '99+' : String(_pillCount);
    const pill = $('scroll-bottom-pill');
    if (pill) pill.classList.add('visible');
}

function _applyGrouping(el) {
    if (!el || !el._rec) return;
    const t = el._rec.type;
    if (t !== 'privmsg' && t !== 'action') return;

    const prev = el.previousElementSibling;
    if (!prev || prev.classList.contains('date-sep')) return;
    if (!prev._rec || (prev._rec.type !== 'privmsg' && prev._rec.type !== 'action')) return;
    if (prev._rec.nick !== el._rec.nick) return;
    const a = typeof el._rec.ts === 'number' ? el._rec.ts : null;
    const b = typeof prev._rec.ts === 'number' ? prev._rec.ts : null;
    if (a !== null && b !== null && (a - b) > 300) return;
    el.classList.add('ml-grouped');
}
function buildLine(rec) {

    if (_customRecordTypes[rec.type]) {
        try {
            const el = _customRecordTypes[rec.type](rec);
            if (el instanceof HTMLElement) return el;
        } catch (e) { console.error('[customRecordType]', rec.type, e); }
    }

    const d = mk('div', `ml mt-${rec.type || 'status'}${rec.hl ? ' ml-hl' : ''}${rec.self ? ' ml-self' : ''}`);
    d._rec = rec;
    const ts = mk('span', 'ml-ts');

    const _tsEpoch = (rec.ts && typeof rec.ts !== 'string') ? rec.ts : null;
    if (IS_MOBILE && _tsEpoch && !rec.time) {
        ts.dataset.ts = _tsEpoch;
        ts.textContent = relTime(_tsEpoch);
    } else {
        ts.textContent = rec.time ? rec.time.slice(11, 16) : fmtTime(rec.ts);
    }
    ts.title = rec.time || (_tsEpoch ? new Date(_tsEpoch * 1000).toLocaleString() : '');
    const nick = mk('span', 'ml-nick');
    const txt = mk('span', 'ml-text');

    if (rec.icon && (rec.type === 'privmsg' || rec.type === 'notice')) {
        const icon = mk('span', 'ml-icon');
        icon.textContent = rec.icon;
        txt.prepend(icon);
    }

    if (rec.type === 'whois_card') {
        const d_card = mk('div', 'whois-card');
        const m = rec.data;

        const hdr = mk('div', 'whois-hdr');
        const nickSpan = mk('span', 'whois-nick'); nickSpan.textContent = m.nick;
        const realSpan = mk('span', 'whois-real'); realSpan.textContent = `(${m.realname || 'No real name'})`;
        hdr.append(nickSpan, realSpan);

        const grid = mk('div', 'whois-grid');
        const addRow = (lbl, val) => {
            if (!val) return;
            const l = mk('div', 'whois-lbl'); l.textContent = lbl;
            const v = mk('div', 'whois-val'); v.textContent = val;
            grid.append(l, v);
        };

        addRow('User', m.user);
        addRow('Account', m.account && m.account !== 'Unknown' ? m.account : null);
        addRow('Server', m.server);
        if (m.idle) addRow('Idle', m.idle);
        if (m.last_msg) addRow('Last Msg', new Date(m.last_msg * 1000).toLocaleString());

        const badges = mk('div', 'whois-badges');
        if (m.oper) { const b = mk('span', 'whois-badge'); b.textContent = 'IRC Operator'; badges.appendChild(b); }
        if (m.account && m.account !== 'Unknown') { const b = mk('span', 'whois-badge'); b.textContent = 'Identified'; badges.appendChild(b); }

        d_card.append(hdr, grid);
        if (badges.childElementCount > 0) d_card.appendChild(badges);

        if (m.away) {
            const away = mk('div', 'whois-away-msg');
            away.textContent = `Away: ${m.away}`;
            d_card.appendChild(away);
        }

        if (m.channels && m.channels.length) {
            const chans = mk('div', 'whois-chans');
            chans.textContent = 'Channels: ' + m.channels.join(' ');
            d_card.appendChild(chans);
        }

        if (m.extra && m.extra.length) {
            m.extra.forEach(text => {
                const ex = mk('div', 'whois-extra-row');
                ex.style.color = 'var(--whois-info-color)';
                ex.textContent = text;
                d_card.appendChild(ex);
            });
        }

        d.className = 'ml mt-whois-card';
        d.append(ts, d_card);
        return d;
    }

    if (rec.type === 'whois-log') {

        const star = mk('span', 'ml-whois-star'); star.textContent = '*';
        star.style.color = 'var(--whois-nick-color)';
        const body = mk('span', 'ml-whois-body');
        const raw = rec.text || `[${rec.whois_data.nick}] ${rec.whois_data.msg || ''}`;
        body.textContent = ' ' + raw.replace(/^\* /, '');
        d.append(ts, star, body);
        d.className = 'ml mt-whois-log';
        return d;
    }

    if (rec.type === 'invite-notice') {
        const msg = mk('span', 'ml-invite-text');
        msg.textContent = `${rec.from} invited you to ${rec.channel}  `;
        const btn = mk('button', 'btn-join-invite');
        btn.textContent = 'Join';
        btn.addEventListener('click', () => {
            wsSend({ type: 'raw', network_id: rec.network, line: `JOIN ${rec.channel}` });
        });
        d.append(ts, msg, btn);
        d.className = 'ml mt-invite-notice';
        return d;
    }

    if (rec.type === 'privmsg') {
        nick.textContent = rec.nick;
        const _net = rec.network || (state.active || '').split('/')[0];
        nick.style.color = nickColour(rec.nick, _net);
        nick.style.cursor = 'pointer';
        nick.onclick = () => {
            const inp = $('input');
            const nickClean = rec.nick.replace(/^[~&@%+]/, '');
            if (inp.value) inp.value += ' ' + nickClean + ' ';
            else inp.value = nickClean + ': ';
            inp.focus();
        };
        txt.innerHTML += formatText(esc(rec.text));
    } else if (rec.type === 'action') {
        nick.textContent = '*';
        const _net2 = rec.network || (state.active || '').split('/')[0];
        const actionColour = nickColour(rec.nick, _net2);
        nick.style.color = actionColour;
        nick.style.cursor = 'pointer';
        nick.onclick = () => {
            const inp = $('input');
            const nickClean = rec.nick.replace(/^[~&@%+]/, '');
            if (inp.value) inp.value += ' ' + nickClean + ' ';
            else inp.value = nickClean + ': ';
            inp.focus();
        };
        txt.innerHTML += `<em style="color:${actionColour}">${esc(rec.nick)} ${formatText(esc(rec.text))}</em>`;
    } else if (rec.type === 'notice') {
        nick.textContent = `*${rec.nick}*`;
        nick.style.color = 'var(--purple)';
        txt.innerHTML += formatText(esc(rec.text));
    } else {
        txt.innerHTML += formatText(esc(rec.text));
    }
    d.append(ts, nick, txt);

    return d;
}

let _renderTreeTimer = null;
function renderTree() {
    if (_renderTreeTimer) return;
    _renderTreeTimer = requestAnimationFrame(() => {
        _renderTreeTimer = null;
        _renderTreeNow();
    });
}
function _renderTreeNow() {
    const tree = $('tree-content');
    if (!tree) return;
    const scroll = tree.scrollTop;

    tree.innerHTML = '';

    const hlRow = mk('div', 'tree-highlights');
    if (state.active === HIGHLIGHTS_KEY) hlRow.classList.add('active');
    else if (state.highlightsUnread > 0) hlRow.classList.add('hl');
    const hlIcon = mk('span', 'tree-hl-icon'); hlIcon.textContent = '\u26A1';
    const hlLbl = mk('span'); hlLbl.textContent = 'Highlights';
    hlRow.append(hlIcon, hlLbl);
    if (state.highlightsUnread > 0) {
        const pill = mk('span', 'unread-pill'); pill.textContent = state.highlightsUnread;
        hlRow.appendChild(pill);
    }
    hlRow.onclick = () => switchBuf(HIGHLIGHTS_KEY);
    tree.appendChild(hlRow);

    for (const [netId, net] of Object.entries(state.networks)) {
        const wrap = mk('div', 'tree-network');
        wrap.id = `tree-net-${netId}`;

        const hdr = mk('div', 'tree-net-hdr');
        const dot = mk('span', 'dot ndot ' + (net.status || 'disconnected'));
        const nm = mk('span', 'nname'); nm.textContent = net.name || netId;
        if (net.ssl) { const lock = mk('span', 'net-ssl-lock'); lock.textContent = '[S]'; lock.title = 'TLS/SSL'; nm.appendChild(lock); }
        if (net.status === 'reconnecting' && net.reconnectIn != null) {
            const cd = mk('span', 'net-reconn-cd'); cd.textContent = `${net.reconnectIn}s`; nm.appendChild(cd);
        }
        const arr = mk('span', 'tree-arrow'); arr.textContent = 'v';

        arr.onclick = e => {
            e.stopPropagation();
            state.collapsed[netId] = !state.collapsed[netId];
            arr.classList.toggle('collapsed', state.collapsed[netId]);
            chans.classList.toggle('hidden', state.collapsed[netId]);
        };
        const statusKey = `${netId}/Status`;
        mkBuf(statusKey);
        if (state.active === statusKey) hdr.classList.add('active');
        else if (state.highlights[statusKey]) hdr.classList.add('hl');
        else if (state.unread[statusKey]) hdr.classList.add('unread');
        if (state.unread[statusKey]) {
            const pill = mk('span', 'unread-pill'); pill.textContent = state.unread[statusKey];
            hdr.append(dot, nm, pill, arr);
        } else {
            hdr.append(dot, nm, arr);
        }
        const _nc = !!state.collapsed[netId];
        arr.classList.toggle('collapsed', _nc);
        hdr.onclick = () => switchBuf(statusKey);
        hdr.addEventListener('contextmenu', e => {
            e.preventDefault();
            showNetCtxMenu(e, netId);
        });

        const chans = mk('div', 'tree-channels');
        chans.classList.toggle('hidden', _nc);

        const consoleKey = `${netId}/Console`;
        if (state.buffers[consoleKey]) {
            const crow = mk('div', 'tree-ch tree-ch-console');
            if (state.active === consoleKey) crow.classList.add('active');
            const clbl = mk('span'); clbl.textContent = 'Console';
            crow.appendChild(clbl);
            if (state.unread[consoleKey]) {
                const pill = mk('span', 'unread-pill'); pill.textContent = state.unread[consoleKey]; crow.appendChild(pill);
            }
            crow.onclick = () => switchBuf(consoleKey);
            chans.appendChild(crow);
        }
        const pinnedList = state.settings.pinned || [];
        const pinnedSet = new Set(pinnedList);

        const customOrder = (state.settings.channelOrder || {})[netId] || [];
        const chanSet = new Set(net.channels || []);
        const ordered = customOrder.filter(c => chanSet.has(c));
        for (const c of (net.channels || [])) { if (!ordered.includes(c)) ordered.push(c); }
        const sortedChans = [...ordered].sort((a, b) =>
            (pinnedSet.has(`${netId}/${b}`) ? 1 : 0) - (pinnedSet.has(`${netId}/${a}`) ? 1 : 0)
        );
        for (const ch of sortedChans) {
            const key = `${netId}/${ch}`;
            const isPinned = pinnedSet.has(key);
            const row = mk('div', 'tree-ch');
            row.draggable = true;
            row.dataset.ch = ch;
            row.dataset.netId = netId;
            if (isPinned) row.classList.add('tree-ch-pinned');
            if (state.active === key) row.classList.add('active');
            else if (state.highlights[key]) row.classList.add('hl');
            else if (state.unread[key]) row.classList.add('unread');
            if (isPinned) { const pm = mk('span', 'pin-mark'); pm.textContent = '*'; row.appendChild(pm); }
            const lbl = mk('span'); lbl.textContent = ch;
            row.appendChild(lbl);
            const ucount = Object.keys(state.nicks[key] || {}).length;
            if (ucount > 0) {
                const cnt = mk('span', 'tree-ucount');
                cnt.textContent = ucount;
                row.appendChild(cnt);
            }
            if (state.unread[key]) {
                const pill = mk('span', 'unread-pill');
                pill.textContent = state.unread[key];
                row.appendChild(pill);
            }
            row.onclick = () => switchBuf(key);
            row.addEventListener('contextmenu', e => {
                e.preventDefault();
                showTreeCtxMenu(e, key, isPinned);
            });
            chans.appendChild(row);
        }

        chans.addEventListener('dragstart', e => {
            const row = e.target.closest('[data-ch]');
            if (!row) return;
            _dragSrc = { netId: row.dataset.netId, ch: row.dataset.ch };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', row.dataset.ch);
            requestAnimationFrame(() => row.classList.add('dragging'));
        });
        chans.addEventListener('dragend', () => {
            chans.querySelectorAll('.dragging, .drag-over-top, .drag-over-bot').forEach(el =>
                el.classList.remove('dragging', 'drag-over-top', 'drag-over-bot'));
            _dragSrc = null;
        });
        chans.addEventListener('dragover', e => {
            if (!_dragSrc) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const row = e.target.closest('[data-ch]');
            chans.querySelectorAll('.drag-over-top, .drag-over-bot').forEach(el =>
                el.classList.remove('drag-over-top', 'drag-over-bot'));
            if (!row || row.dataset.ch === _dragSrc.ch) return;
            const rect = row.getBoundingClientRect();
            row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bot');
        });
        chans.addEventListener('dragleave', e => {
            if (!e.relatedTarget || !chans.contains(e.relatedTarget))
                chans.querySelectorAll('.drag-over-top, .drag-over-bot').forEach(el =>
                    el.classList.remove('drag-over-top', 'drag-over-bot'));
        });
        chans.addEventListener('drop', e => {
            e.preventDefault();
            if (!_dragSrc) return;
            const nid = _dragSrc.netId;
            const rows = [...chans.querySelectorAll('[data-ch]')];
            let order = rows.map(r => r.dataset.ch);
            const srcIdx = order.indexOf(_dragSrc.ch);
            if (srcIdx === -1) return;
            const tgtRow = e.target.closest('[data-ch]');
            if (!tgtRow || tgtRow.dataset.ch === _dragSrc.ch || tgtRow.dataset.netId !== nid) {

                order.splice(srcIdx, 1);
                order.push(_dragSrc.ch);
            } else {
                const rect = tgtRow.getBoundingClientRect();
                const insertAfter = e.clientY >= rect.top + rect.height / 2;
                order.splice(srcIdx, 1);
                const newIdx = order.indexOf(tgtRow.dataset.ch) + (insertAfter ? 1 : 0);
                order.splice(newIdx, 0, _dragSrc.ch);
            }
            if (!state.settings.channelOrder) state.settings.channelOrder = {};
            state.settings.channelOrder[nid] = order;
            wsSend({ type: 'save_settings', settings: state.settings });
            renderTree();
        });

        const dmNicks = [...(state.dms[netId] || new Set())].sort();
        for (const nick of dmNicks) {
            const key = `${netId}/${nick}`;
            const row = mk('div', 'tree-ch tree-ch-dm');
            if (state.active === key) row.classList.add('active');
            else if (state.highlights[key]) row.classList.add('hl');
            else if (state.unread[key]) row.classList.add('unread');
            const lbl = mk('span'); lbl.textContent = nick;
            row.appendChild(lbl);
            if (state.unread[key]) {
                const pill = mk('span', 'unread-pill');
                pill.textContent = state.unread[key];
                row.appendChild(pill);
            }
            row.onclick = () => switchBuf(key);
            row.addEventListener('contextmenu', e => {
                e.preventDefault();
                showTreeCtxMenu(e, key, false);
            });
            chans.appendChild(row);
        }
        wrap.append(hdr, chans);
        tree.appendChild(wrap);
    }
    tree.scrollTop = scroll;
}

function renderUserList() {
    const ul = $('userlist');
    if (!ul) return;
    const PFX_RANK = { '~': 0, '&': 1, '@': 2, '%': 3, '+': 4 };
    const entries = Object.entries(state.nicks[state.active] || {});
    entries.sort((a, b) => {
        const ra = PFX_RANK[a[1][0]] ?? 5, rb = PFX_RANK[b[1][0]] ?? 5;
        return ra - rb || a[0].localeCompare(b[0]);
    });
    $('user-count').textContent = `(${entries.length})`;
    const [netId] = (state.active || '').split('/');
    const awaySet = state.away[netId] || new Set();
    const botSet = state.bots[netId] || new Set();
    const frag = document.createDocumentFragment();
    for (const [name, pfx] of entries) {
        const row = mk('div', 'uentry');
        row.oncontextmenu = e => showCtxMenu(e, name);
        const sp = mk('span', 'upfx'); sp.textContent = pfx;
        const isAway = awaySet.has(name);
        const isBot = botSet.has(name);
        let classes = 'unick';
        if (isAway) classes += ' unick-away';
        if (isBot) classes += ' unick-bot';
        const nm = mk('span', classes);
        nm.textContent = name;

        if (!isAway) nm.style.color = nickColour(name, netId);
        row.append(sp, nm);
        frag.appendChild(row);
    }
    ul.innerHTML = '';
    ul.appendChild(frag);
}

const COMMAND_SUGGESTIONS = [
    { name: '/join', args: '<channel> [password]', desc: 'Join a channel' },
    { name: '/part', args: '[channel] [message]', desc: 'Leave a channel' },
    { name: '/query', args: '<nickname> [message]', desc: 'Open a private query tab with a user' },
    { name: '/msg', args: '<target> <message>', desc: 'Send a message to a channel or user' },
    { name: '/nick', args: '<newnick>', desc: 'Change your nickname' },
    { name: '/me', args: '<action>', desc: 'Perform an action message (e.g. /me is coding)' },
    { name: '/topic', args: '[newtopic]', desc: 'View or set the topic of the current channel' },
    { name: '/whois', args: '<nickname>', desc: 'Request user information' },
    { name: '/raw', args: '<command> [params...]', desc: 'Send raw command line directly to IRC server' },
    { name: '/connect', args: '<hostname> [port] [password]', desc: 'Connect to an IRC server' },
    { name: '/server', args: '<hostname> [port] [password]', desc: 'Alias for /connect' },
    { name: '/clear', args: '', desc: 'Clear the current chat buffer screen' },
    { name: '/notice', args: '<target> <message>', desc: 'Send a notice message to a user or channel' },
    { name: '/ignore', args: '<mask|nickname>', desc: 'Add a user pattern to the ignore list' },
    { name: '/list', args: '[pattern]', desc: 'List active channels on the current network' },
    { name: '/help', args: '', desc: 'Display a summary of all commands' },
    { name: '/away', args: '[message]', desc: 'Set or clear away message' },
    { name: '/mode', args: '<target> <modes> [params...]', desc: 'Change target channel or user modes' },
    { name: '/kick', args: '<nickname> [reason]', desc: 'Kick a user out of the current channel' },
    { name: '/invite', args: '<nickname> <channel>', desc: 'Invite a user to join a channel' }
];

let _suggestMatches = [];
let _suggestIndex = 0;

function _renderSuggestions() {
    const popup = $('cmd-suggest-popup');
    if (!popup) return;
    popup.innerHTML = '';
    popup.classList.remove('hidden');

    _suggestMatches.forEach((cmd, idx) => {
        const item = mk('div', 'cmd-suggest-item');
        if (idx === _suggestIndex) item.classList.add('active');

        const hdr = mk('div', 'cmd-suggest-header');
        const name = mk('span', 'cmd-suggest-name');
        name.textContent = cmd.name;
        const args = mk('span', 'cmd-suggest-args');
        args.textContent = cmd.args || '';
        hdr.append(name, args);

        const desc = mk('div', 'cmd-suggest-desc');
        desc.textContent = cmd.desc;

        item.append(hdr, desc);
        item.onclick = () => {
            _applySuggestion(cmd);
        };

        popup.appendChild(item);
    });
}

function _hideSuggestions() {
    const popup = $('cmd-suggest-popup');
    if (popup) popup.classList.add('hidden');
    _suggestMatches = [];
    _suggestIndex = 0;
}

const EMOJI = [
    { n: 'smile', c: '😄' }, { n: 'smiley', c: '😃' }, { n: 'grin', c: '😁' },
    { n: 'laughing', c: '😆' }, { n: 'joy', c: '😂' }, { n: 'rofl', c: '🤣' },
    { n: 'sweat_smile', c: '😅' }, { n: 'slightly_smiling_face', c: '🙂' },
    { n: 'upside_down_face', c: '🙃' }, { n: 'wink', c: '😉' }, { n: 'blush', c: '😊' },
    { n: 'innocent', c: '😇' }, { n: 'heart_eyes', c: '😍' }, { n: 'kissing_heart', c: '😘' },
    { n: 'kissing', c: '😗' }, { n: 'yum', c: '😋' }, { n: 'stuck_out_tongue', c: '😛' },
    { n: 'stuck_out_tongue_winking_eye', c: '😜' }, { n: 'zany_face', c: '🤪' },
    { n: 'money_mouth_face', c: '🤑' }, { n: 'hugs', c: '🤗' }, { n: 'thinking', c: '🤔' },
    { n: 'zipper_mouth_face', c: '🤐' }, { n: 'raised_eyebrow', c: '🤨' },
    { n: 'neutral_face', c: '😐' }, { n: 'expressionless', c: '😑' }, { n: 'no_mouth', c: '😶' },
    { n: 'smirk', c: '😏' }, { n: 'unamused', c: '😒' }, { n: 'roll_eyes', c: '🙄' },
    { n: 'grimacing', c: '😬' }, { n: 'relieved', c: '😌' }, { n: 'pensive', c: '😔' },
    { n: 'sleepy', c: '😪' }, { n: 'drooling_face', c: '🤤' }, { n: 'sleeping', c: '😴' },
    { n: 'mask', c: '😷' }, { n: 'face_with_thermometer', c: '🤒' }, { n: 'nauseated_face', c: '🤢' },
    { n: 'sneezing_face', c: '🤧' }, { n: 'hot_face', c: '🥵' }, { n: 'cold_face', c: '🥶' },
    { n: 'woozy_face', c: '🥴' }, { n: 'dizzy_face', c: '😵' }, { n: 'exploding_head', c: '🤯' },
    { n: 'cowboy_hat_face', c: '🤠' }, { n: 'partying_face', c: '🥳' }, { n: 'sunglasses', c: '😎' },
    { n: 'nerd_face', c: '🤓' }, { n: 'confused', c: '😕' }, { n: 'worried', c: '😟' },
    { n: 'slightly_frowning_face', c: '🙁' }, { n: 'frowning_face', c: '☹️' },
    { n: 'open_mouth', c: '😮' }, { n: 'hushed', c: '😯' }, { n: 'astonished', c: '😲' },
    { n: 'flushed', c: '😳' }, { n: 'pleading_face', c: '🥺' }, { n: 'frowning', c: '😦' },
    { n: 'anguished', c: '😧' }, { n: 'fearful', c: '😨' }, { n: 'cold_sweat', c: '😰' },
    { n: 'disappointed_relieved', c: '😥' }, { n: 'cry', c: '😢' }, { n: 'sob', c: '😭' },
    { n: 'scream', c: '😱' }, { n: 'confounded', c: '😖' }, { n: 'persevere', c: '😣' },
    { n: 'disappointed', c: '😞' }, { n: 'sweat', c: '😓' }, { n: 'weary', c: '😩' },
    { n: 'tired_face', c: '😫' }, { n: 'yawning_face', c: '🥱' }, { n: 'triumph', c: '😤' },
    { n: 'rage', c: '😡' }, { n: 'angry', c: '😠' }, { n: 'cursing_face', c: '🤬' },
    { n: 'smiling_imp', c: '😈' }, { n: 'imp', c: '👿' }, { n: 'skull', c: '💀' },
    { n: 'poop', c: '💩' }, { n: 'clown_face', c: '🤡' }, { n: 'ghost', c: '👻' },
    { n: 'alien', c: '👽' }, { n: 'robot', c: '🤖' }, { n: 'jack_o_lantern', c: '🎃' },
    { n: 'wave', c: '👋' }, { n: 'raised_hand', c: '✋' }, { n: 'ok_hand', c: '👌' },
    { n: 'pinching_hand', c: '🤏' }, { n: 'v', c: '✌️' }, { n: 'crossed_fingers', c: '🤞' },
    { n: 'love_you_gesture', c: '🤟' }, { n: 'metal', c: '🤘' }, { n: 'call_me_hand', c: '🤙' },
    { n: 'point_left', c: '👈' }, { n: 'point_right', c: '👉' }, { n: 'point_up_2', c: '👆' },
    { n: 'point_down', c: '👇' }, { n: 'point_up', c: '☝️' }, { n: 'thumbsup', c: '👍' },
    { n: 'thumbsdown', c: '👎' }, { n: 'fist', c: '✊' }, { n: 'punch', c: '👊' },
    { n: 'clap', c: '👏' }, { n: 'raised_hands', c: '🙌' }, { n: 'open_hands', c: '👐' },
    { n: 'pray', c: '🙏' }, { n: 'handshake', c: '🤝' }, { n: 'writing_hand', c: '✍️' },
    { n: 'muscle', c: '💪' }, { n: 'eyes', c: '👀' }, { n: 'brain', c: '🧠' },
    { n: 'heart', c: '❤️' }, { n: 'orange_heart', c: '🧡' }, { n: 'yellow_heart', c: '💛' },
    { n: 'green_heart', c: '💚' }, { n: 'blue_heart', c: '💙' }, { n: 'purple_heart', c: '💜' },
    { n: 'black_heart', c: '🖤' }, { n: 'white_heart', c: '🤍' }, { n: 'broken_heart', c: '💔' },
    { n: 'two_hearts', c: '💕' }, { n: 'sparkling_heart', c: '💖' }, { n: 'heartpulse', c: '💗' },
    { n: 'cupid', c: '💘' }, { n: 'gift_heart', c: '💝' }, { n: 'fire', c: '🔥' },
    { n: 'star', c: '⭐' }, { n: 'star2', c: '🌟' }, { n: 'sparkles', c: '✨' },
    { n: 'zap', c: '⚡' }, { n: 'boom', c: '💥' }, { n: 'dizzy', c: '💫' },
    { n: 'sweat_drops', c: '💦' }, { n: 'droplet', c: '💧' }, { n: 'tada', c: '🎉' },
    { n: 'confetti_ball', c: '🎊' }, { n: 'balloon', c: '🎈' }, { n: 'gift', c: '🎁' },
    { n: 'trophy', c: '🏆' }, { n: 'medal', c: '🏅' }, { n: '100', c: '💯' },
    { n: 'checkered_flag', c: '🏁' }, { n: 'crown', c: '👑' }, { n: 'gem', c: '💎' },
    { n: 'rocket', c: '🚀' }, { n: 'airplane', c: '✈️' }, { n: 'car', c: '🚗' },
    { n: 'bike', c: '🚲' }, { n: 'sun', c: '☀️' }, { n: 'cloud', c: '☁️' },
    { n: 'rainbow', c: '🌈' }, { n: 'snowflake', c: '❄️' }, { n: 'snowman', c: '⛄' },
    { n: 'umbrella', c: '☔' }, { n: 'moon', c: '🌙' }, { n: 'earth_americas', c: '🌎' },
    { n: 'coffee', c: '☕' }, { n: 'tea', c: '🍵' }, { n: 'beer', c: '🍺' },
    { n: 'beers', c: '🍻' }, { n: 'wine_glass', c: '🍷' }, { n: 'cocktail', c: '🍸' },
    { n: 'pizza', c: '🍕' }, { n: 'hamburger', c: '🍔' }, { n: 'fries', c: '🍟' },
    { n: 'hotdog', c: '🌭' }, { n: 'taco', c: '🌮' }, { n: 'popcorn', c: '🍿' },
    { n: 'doughnut', c: '🍩' }, { n: 'cookie', c: '🍪' }, { n: 'cake', c: '🍰' },
    { n: 'birthday', c: '🎂' }, { n: 'chocolate_bar', c: '🍫' }, { n: 'candy', c: '🍬' },
    { n: 'apple', c: '🍎' }, { n: 'banana', c: '🍌' }, { n: 'watermelon', c: '🍉' },
    { n: 'strawberry', c: '🍓' }, { n: 'cherries', c: '🍒' }, { n: 'peach', c: '🍑' },
    { n: 'dog', c: '🐶' }, { n: 'cat', c: '🐱' }, { n: 'mouse', c: '🐭' },
    { n: 'rabbit', c: '🐰' }, { n: 'fox_face', c: '🦊' }, { n: 'bear', c: '🐻' },
    { n: 'panda_face', c: '🐼' }, { n: 'koala', c: '🐨' }, { n: 'tiger', c: '🐯' },
    { n: 'lion', c: '🦁' }, { n: 'cow', c: '🐮' }, { n: 'pig', c: '🐷' },
    { n: 'monkey_face', c: '🐵' }, { n: 'chicken', c: '🐔' }, { n: 'penguin', c: '🐧' },
    { n: 'bird', c: '🐦' }, { n: 'unicorn', c: '🦄' }, { n: 'bee', c: '🐝' },
    { n: 'bug', c: '🐛' }, { n: 'snail', c: '🐌' }, { n: 'fish', c: '🐟' },
    { n: 'whale', c: '🐳' }, { n: 'dolphin', c: '🐬' }, { n: 'snake', c: '🐍' },
    { n: 'turtle', c: '🐢' }, { n: 'dragon', c: '🐉' }, { n: 'cactus', c: '🌵' },
    { n: 'palm_tree', c: '🌴' }, { n: 'tree', c: '🌳' }, { n: 'four_leaf_clover', c: '🍀' },
    { n: 'maple_leaf', c: '🍁' }, { n: 'rose', c: '🌹' }, { n: 'sunflower', c: '🌻' },
    { n: 'tulip', c: '🌷' }, { n: 'bouquet', c: '💐' }, { n: 'thumbsup_all', c: '👍' },
    { n: 'ok', c: '🆗' }, { n: 'new', c: '🆕' }, { n: 'cool', c: '🆒' },
    { n: 'warning', c: '⚠️' }, { n: 'question', c: '❓' }, { n: 'exclamation', c: '❗' },
    { n: 'x', c: '❌' }, { n: 'white_check_mark', c: '✅' }, { n: 'heavy_check_mark', c: '✔️' },
    { n: 'no_entry', c: '⛔' }, { n: 'bulb', c: '💡' }, { n: 'lock', c: '🔒' },
    { n: 'key', c: '🔑' }, { n: 'bell', c: '🔔' }, { n: 'hammer', c: '🔨' },
    { n: 'wrench', c: '🔧' }, { n: 'gear', c: '⚙️' }, { n: 'computer', c: '💻' },
    { n: 'keyboard', c: '⌨️' }, { n: 'phone', c: '📱' }, { n: 'email', c: '📧' },
    { n: 'bookmark', c: '🔖' }, { n: 'book', c: '📖' }, { n: 'pencil', c: '✏️' },
    { n: 'money_with_wings', c: '💸' }, { n: 'moneybag', c: '💰' }, { n: 'clock', c: '🕐' },
    { n: 'hourglass', c: '⌛' }, { n: 'alarm_clock', c: '⏰' }, { n: 'musical_note', c: '🎵' },
    { n: 'notes', c: '🎶' }, { n: 'headphones', c: '🎧' }, { n: 'guitar', c: '🎸' },
    { n: 'game_die', c: '🎲' }, { n: 'dart', c: '🎯' }, { n: 'soccer', c: '⚽' },
    { n: 'basketball', c: '🏀' }, { n: 'football', c: '🏈' }, { n: 'tennis', c: '🎾' }
];

let _emojiMatches = [];
let _emojiIndex = 0;
let _emojiCtx = null;

function _updateEmojiSuggest(inp) {
    const before = inp.value.slice(0, inp.selectionStart);
    const m = before.match(/(?:^|\s):([a-z0-9_+-]{2,})$/i);
    if (!m) { _hideEmojiSuggest(); return; }
    const query = m[1].toLowerCase();
    const colonPos = inp.selectionStart - m[1].length - 1;
    const starts = [], contains = [];
    for (const e of EMOJI) {
        if (e.n === query || e.n.startsWith(query)) starts.push(e);
        else if (e.n.includes(query)) contains.push(e);
    }
    _emojiMatches = [...starts, ...contains].slice(0, 8);
    if (!_emojiMatches.length) { _hideEmojiSuggest(); return; }
    _emojiIndex = 0;
    _emojiCtx = { colonPos, cursor: inp.selectionStart };
    _renderEmojiSuggest();
}

function _renderEmojiSuggest() {
    const popup = $('emoji-suggest-popup');
    if (!popup) return;
    popup.innerHTML = '';
    popup.classList.remove('hidden');
    _emojiMatches.forEach((e, idx) => {
        const item = mk('div', 'emoji-suggest-item');
        if (idx === _emojiIndex) item.classList.add('active');
        const ch = mk('span', 'emoji-suggest-char'); ch.textContent = e.c;
        const nm = mk('span', 'emoji-suggest-name'); nm.textContent = `:${e.n}:`;
        item.append(ch, nm);
        item.onclick = () => _applyEmoji(idx);
        popup.appendChild(item);
    });
}

function _hideEmojiSuggest() {
    const popup = $('emoji-suggest-popup');
    if (popup) popup.classList.add('hidden');
    _emojiMatches = [];
    _emojiIndex = 0;
    _emojiCtx = null;
}

function _applyEmoji(idx) {
    if (!_emojiCtx || !_emojiMatches[idx]) return;
    const inp = $('input');
    const emoji = _emojiMatches[idx].c;
    const val = inp.value;
    const newVal = val.slice(0, _emojiCtx.colonPos) + emoji + ' ' + val.slice(_emojiCtx.cursor);
    inp.value = newVal;
    const newPos = _emojiCtx.colonPos + emoji.length + 1;
    inp.setSelectionRange(newPos, newPos);
    inp.focus();
    _hideEmojiSuggest();
}

function _applySuggestion(cmd) {
    const inp = $('input');
    inp.value = cmd.name + ' ';
    inp.focus();
    _hideSuggestions();
}

function submitInput() {
    const raw = $('input').value.trim();
    if (!raw) return;

    if (state.history[0] !== raw) {
        state.history.unshift(raw);
        if (state.history.length > 50) state.history.pop();
    }
    state.historyPos = -1;
    state.historyDraft = '';

    $('input').value = '';
    state.tab.active = false;
    _hideSuggestions();
    _hideEmojiSuggest();
    if (raw.startsWith('/')) {
        handleCommand(raw);
    } else {
        sendMsg(raw);
    }
}

$('input').addEventListener('input', e => {
    const val = e.target.value;
    if (val.startsWith('/') && !val.includes(' ')) {
        const stub = val.toLowerCase();
        _suggestMatches = COMMAND_SUGGESTIONS.filter(cmd => cmd.name.startsWith(stub));
        if (_suggestMatches.length > 0) {

            _suggestIndex = Math.min(_suggestIndex, _suggestMatches.length - 1);
            if (_suggestIndex < 0) _suggestIndex = 0;
            _renderSuggestions();
        } else {
            _hideSuggestions();
        }
        _hideEmojiSuggest();
    } else {
        _hideSuggestions();
        _updateEmojiSuggest(e.target);
    }
});

$('input').addEventListener('keydown', e => {
    const emojiPopup = $('emoji-suggest-popup');
    const emojiVisible = emojiPopup && !emojiPopup.classList.contains('hidden');
    if (emojiVisible) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            _emojiIndex = (_emojiIndex - 1 + _emojiMatches.length) % _emojiMatches.length;
            _renderEmojiSuggest();
            return;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            _emojiIndex = (_emojiIndex + 1) % _emojiMatches.length;
            _renderEmojiSuggest();
            return;
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            _applyEmoji(_emojiIndex);
            return;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            _hideEmojiSuggest();
            return;
        }
    }

    const popup = $('cmd-suggest-popup');
    const isVisible = popup && !popup.classList.contains('hidden');

    if (isVisible) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            _suggestIndex = (_suggestIndex - 1 + _suggestMatches.length) % _suggestMatches.length;
            _renderSuggestions();
            return;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            _suggestIndex = (_suggestIndex + 1) % _suggestMatches.length;
            _renderSuggestions();
            return;
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            _applySuggestion(_suggestMatches[_suggestIndex]);
            return;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            _hideSuggestions();
            return;
        }
    }

    if (e.key === 'Tab') {
        e.preventDefault();
        handleTab();
    } else if (e.key === 'Enter') {
        submitInput();
    } else if (e.key === 'ArrowUp') {
        state.tab.active = false;
        if (state.historyPos < state.history.length - 1) {
            if (state.historyPos === -1) state.historyDraft = e.target.value;
            state.historyPos++;
            e.target.value = state.history[state.historyPos];
            setTimeout(() => e.target.setSelectionRange(999, 999), 0);
            e.preventDefault();
        }
    } else if (e.key === 'ArrowDown') {
        state.tab.active = false;
        if (state.historyPos > -1) {
            state.historyPos--;
            e.target.value = state.historyPos === -1 ? state.historyDraft : state.history[state.historyPos];
            setTimeout(() => e.target.setSelectionRange(999, 999), 0);
            e.preventDefault();
        }
    } else {
        state.tab.active = false;
    }
});

function handleTab() {
    const inp = $('input');
    const pos = inp.selectionStart;
    const val = inp.value;

    if (!state.tab.active) {

        const lastSpace = val.lastIndexOf(' ', pos - 1);
        const start = lastSpace + 1;
        const stub = val.substring(start, pos).toLowerCase();
        if (!stub) return;

        let matches = [];
        const [netId] = (state.active || '').split('/');

        const nicks = Object.keys(state.nicks[state.active] || {});
        matches.push(...nicks.filter(n => n.toLowerCase().startsWith(stub)));

        const net = state.networks[netId];
        if (net && net.channels) {
            matches.push(...net.channels.filter(c => c.toLowerCase().startsWith(stub)));
        }

        if (stub.startsWith('/')) {
            const cmds = ['/join', '/part', '/nick', '/msg', '/query', '/quote', '/raw', '/connect', '/server', '/me', '/clear', '/ns', '/cs', '/os', '/ms', '/topic', '/notice', '/leave', '/whois', '/list'];
            matches.push(...cmds.filter(c => c.startsWith(stub)));
        }

        if (!matches.length) return;

        state.tab = {
            active: true,
            start: start,
            cursorEnd: pos,
            original: val.substring(start, pos),
            stub: stub,
            matches: Array.from(new Set(matches)),
            index: 0
        };
    } else {
        state.tab.index = (state.tab.index + 1) % state.tab.matches.length;
    }

    const cutEnd = state.tab.cursorEnd;
    const match = state.tab.matches[state.tab.index];

    const suffix = (state.tab.start === 0 && !match.startsWith('#') && !val.startsWith('/')) ? ': ' : ' ';
    const newVal = val.substring(0, state.tab.start) + match + suffix + val.substring(cutEnd);
    inp.value = newVal;
    const newPos = state.tab.start + match.length + suffix.length;
    state.tab.cursorEnd = newPos;
    inp.setSelectionRange(newPos, newPos);
}

const sendBtn = $('m-send-btn');
if (sendBtn) {

    sendBtn.addEventListener('touchend', e => {
        e.preventDefault();
        submitInput();
    });
    sendBtn.addEventListener('click', submitInput);
}

function sendMsg(text) {
    if (!state.active) return;
    const [netId, ch] = state.active.split('/');
    if (!ch || ch === 'Status') {
        sysMsg(null, null, "Choose a channel or user to message.", "error");
        return;
    }
    wsSend({ type: 'privmsg', network: netId, target: ch, message: text });
}

function getActiveNetId() {
    if (state.active) {
        const [nid] = state.active.split('/');
        if (nid && state.networks[nid]) return nid;
    }

    for (const [nid, net] of Object.entries(state.networks)) {
        if (net.status === 'connected') return nid;
    }

    for (const nid of Object.keys(state.networks)) {
        return nid;
    }
    return null;
}

function handleCommand(raw) {
    const parts = raw.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const netId = getActiveNetId();

    const aliases = state.settings.aliases || {};
    if (aliases[cmd]) {
        let out = aliases[cmd];
        out = out.replace(/\$(\d+)(\+)?/g, (match, n, plus) => {
            const idx = parseInt(n, 10) - 1;
            if (idx >= args.length) return '';
            return plus ? args.slice(idx).join(' ') : args[idx];
        });
        const [_aNet, _aChan] = (state.active || '').split('/');
        out = out
            .replace(/\$nick/g, (state.networks[_aNet] || {}).nick || '')
            .replace(/\$chan/g, _aChan || '')
            .replace(/\$net(?:work)?/g, (state.networks[_aNet] || {}).name || _aNet || '');
        const lines = out.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('/')) handleCommand(trimmed);
            else sendMsg(trimmed);
        }
        return;
    }

    if ((state.settings.bouncer || {}).confirmCommands && cmd !== 'me' && cmd !== 'clear') {
        if (!confirm(`Execute: ${raw}`)) return;
    }

    switch (cmd) {
        case 'join':
            if (!args[0]) return;
            wsSend({ type: 'join', network: netId, channel: args[0] });
            break;
        case 'part':
        case 'leave': {
            const [, ch] = (state.active || '/').split('/');
            wsSend({ type: 'part', network: netId, channel: args[0] || ch, reason: args.slice(1).join(' ') || 'Leaving' });
            break;
        }
        case 'nick':
            if (args[0]) wsSend({ type: 'nick', network: netId, nick: args[0] });
            break;
        case 'msg':
            if (args.length < 2 || args[0] === 'Status') return;
            wsSend({ type: 'privmsg', network: netId, target: args[0], message: args.slice(1).join(' ') });
            break;
        case 'query':
            if (!args[0] || args[0] === 'Status') return;

            ensureDmBuf(netId, args[0]);
            mkBuf(`${netId}/${args[0]}`);
            switchBuf(`${netId}/${args[0]}`);
            if (args.length >= 2)
                wsSend({ type: 'privmsg', network: netId, target: args[0], message: args.slice(1).join(' ') });
            break;
        case 'list':
            wsSend({ type: 'raw', network: netId, line: 'LIST' });
            openListModal();
            break;
        case 'console': {
            const consoleKey = `${netId}/Console`;
            if (state.settings.advanced?.rawConsole) {
                switchBuf(consoleKey);
            } else {
                sysMsg(null, null, "Raw console is disabled in Settings -> Advanced.", 'error');
            }
            break;
        }
        case 'quote':
        case 'raw':
            if (!args.length) return sysMsg(null, null, 'Usage: /raw <line>', 'status');
            wsSend({ type: 'raw', network: netId, line: args.join(' ') });
            break;
        case 'connect':
            if (args[0]) {

                const host = args[0];
                const port = parseInt(args[1]) || 6667;
                const ssl = (args[2] || '').startsWith('+') || port === 6697;

                state.settings.networks = (state.settings.networks || []).filter(n => {
                    if (!String(n.id).startsWith('_tmp_')) return true;
                    const live = state.networks[n.id];
                    if (live && live.status === 'connected') return true;
                    delete state.networks[n.id];
                    return false;
                });
                const tmpId = `_tmp_${Date.now()}`;
                const cfg = {
                    id: tmpId, name: host, nick: state.settings.identity?.nick || 'WebUser',
                    username: state.settings.identity?.username || 'webuser',
                    realname: state.settings.identity?.realname || 'Web IRC Client',
                    servers: [{ host, port, ssl }], channels: [], sasl: { enabled: false },
                    bouncer: { enabled: false }, autoconnect: false
                };
                state.settings.networks.push(cfg);
                state.networks[tmpId] = { id: tmpId, name: host, nick: cfg.nick, status: 'disconnected', channels: [] };
                wsSend({ type: 'save_settings', settings: state.settings });
                wsSend({ type: 'connect', network_id: tmpId });
                renderTree();
            } else {
                openSettings();
            }
            break;
        case 'server':
            openSettings();
            break;
        case 'me': {
            const [nid, ch] = state.active ? state.active.split('/') : [];
            if (!ch || ch === 'Status') { sysMsg(null, null, 'Choose a channel or user first.', 'error'); break; }
            wsSend({ type: 'privmsg', network: nid, target: ch, message: `\x01ACTION ${args.join(' ')}\x01` });
            break;
        }
        case 'clear':
            if (state.active) {
                state.buffers[state.active] = [];
                state.renderStart[state.active] = 0;
                $('chat-buffer').innerHTML = '';
            }
            break;
        case 'topic':
            if (state.active) {
                const [nid, ch] = state.active.split('/');
                if (args.length) wsSend({ type: 'raw', network: nid, line: `TOPIC ${ch} :${args.join(' ')}` });
                else sysMsg(nid, ch, `Topic: ${state.topics[state.active] || '(none)'}`);
            }
            break;
        case 'away':
            wsSend({ type: 'raw', network: netId, line: `AWAY :${args.join(' ') || 'Away'}` });
            break;
        case 'back':
            wsSend({ type: 'raw', network: netId, line: `AWAY` });
            break;
        case 'help': {
            const help = [
                "Available Commands:",
                "/join <channel> - Join a channel",
                "/part [channel] [reason] - Leave a channel",
                "/nick <newnick> - Change your nickname",
                "/msg <target> <message> - Private message",
                "/query <nick> [message] - Open PM window (optionally send a message)",
                "/me <action> - Perform an action",
                "/away [message] - Set away status",
                "/back - Remove away status",
                "/whois <nick> - User information",
                "/ctcp <nick> <command> [args] - Send a CTCP request",
                "/ping <nick> - CTCP PING a user",
                "/ignore [nick|mask] - Ignore a user (no args = list all)",
                "/unignore <nick|mask> - Stop ignoring a user",
                "/list - Browse server channel list (Ctrl+F to search buffer)",
                "/mode <target> <flags> - Change mode",
                "/topic [new topic] - View or set topic",
                "/clear - Clear current buffer",
                "/raw <line> - Send raw IRC command",
                "/plugins - Open plugin manager",
                "/help - Show this help"
            ];
            help.forEach(h => sysMsg(null, null, h, 'status'));
            break;
        }
        case 'notice':
            if (args.length < 2) return;
            wsSend({ type: 'raw', network: netId, line: `NOTICE ${args[0]} :${args.slice(1).join(' ')}` });
            break;
        case 'ctcp': {

            if (!args[0] || !args[1]) return sysMsg(null, null, 'Usage: /ctcp <nick> <command> [args]', 'status');
            const ctcpNick = args[0];
            const ctcpCmd = args[1].toUpperCase();
            const ctcpBody = args.slice(2).join(' ');
            const ctcpMsg = ctcpBody ? `\x01${ctcpCmd} ${ctcpBody}\x01` : `\x01${ctcpCmd}\x01`;
            wsSend({ type: 'privmsg', network: netId, target: ctcpNick, message: ctcpMsg });
            sysMsg(null, null, `Sent CTCP ${ctcpCmd} request to ${ctcpNick}`, 'status');
            break;
        }
        case 'ping': {

            const pingNick = args[0];
            if (!pingNick) return sysMsg(null, null, 'Usage: /ping <nick>', 'status');
            wsSend({ type: 'privmsg', network: netId, target: pingNick, message: `\x01PING ${Date.now()}\x01` });
            sysMsg(null, null, `Sent CTCP PING to ${pingNick}`, 'status');
            break;
        }
        case 'ns': wsSend({ type: 'privmsg', network: netId, target: 'NickServ', message: args.join(' ') }); break;
        case 'cs': wsSend({ type: 'privmsg', network: netId, target: 'ChanServ', message: args.join(' ') }); break;
        case 'os': wsSend({ type: 'privmsg', network: netId, target: 'OperServ', message: args.join(' ') }); break;
        case 'ms': wsSend({ type: 'privmsg', network: netId, target: 'MemoServ', message: args.join(' ') }); break;
        case 'whois': {
            const wnick = args[0];
            if (wnick) {
                _whoisPending[wnick.toLowerCase()] = netId;
                const wkey = `${netId}/${wnick}`;
                if (!state.dms[netId]) state.dms[netId] = new Set();
                state.dms[netId].add(wnick);
                mkBuf(wkey);
                switchBuf(wkey);
                renderTree();
                wsSend({ type: 'raw', network: netId, line: `WHOIS ${wnick} ${wnick}` });
            }
            break;
        }
        case 'ignore':
            if (!args[0]) {
                const ignored = state.settings.ignored || [];
                sysMsg(null, null, ignored.length ? `Ignored: ${ignored.join(', ')}` : 'No ignored entries.', 'status');
            } else {
                toggleIgnore(args[0]);
            }
            break;
        case 'unignore':
            if (args[0]) {
                if (!state.settings.ignored) state.settings.ignored = [];
                const entry = state.settings.ignored.find(e => e.toLowerCase() === args[0].toLowerCase());
                if (entry) {
                    state.settings.ignored = state.settings.ignored.filter(e => e !== entry);
                    wsSend({ type: 'save_settings', settings: state.settings });
                    sysMsg(null, null, `Stopped ignoring ${args[0]}.`, 'status');
                } else {
                    sysMsg(null, null, `${args[0]} is not ignored.`, 'status');
                }
            }
            break;
        case 'kick': {
            const [nid, ch] = (state.active || '').split('/');
            const argIsChan = !!(args[0] && /^[#&!+]/.test(args[0]));
            const target = argIsChan ? args[1] : args[0];
            const channel = argIsChan ? args[0] : ch;
            const reason = args.slice(argIsChan ? 2 : 1).join(' ') || 'Kicked';
            if (target && channel) wsSend({ type: 'raw', network: netId, line: `KICK ${channel} ${target} :${reason}` });
            break;
        }
        case 'mode': {
            const [nid, ch] = (state.active || '').split('/');
            if (args[0] && /^[#&!+]/.test(args[0])) {
                wsSend({ type: 'raw', network: netId, line: `MODE ${args.join(' ')}` });
            } else if (ch) {
                wsSend({ type: 'raw', network: netId, line: `MODE ${ch} ${args.join(' ')}` });
            }
            break;
        }
        case 'ban': {
            const [nid, ch] = (state.active || '').split('/');
            if (args[0] && ch) wsSend({ type: 'raw', network: netId, line: `MODE ${ch} +b ${args[0]}!*@*` });
            break;
        }
        case 'plugins':
            openPluginManager();
            break;
        default: {

            const hooks = _hookCommand[cmd];
            if (hooks && hooks.length) {
                const word = [cmd, ...args];
                const word_eol = word.map((_, i) => word.slice(i).join(' '));
                let eaten = false;
                for (const { cb, ud } of hooks) {
                    try {
                        const r = cb(word, word_eol, ud);
                        if (r === EAT_ALL) { eaten = true; break; }
                    } catch (e) { sysMsg(null, null, `Plugin command error: ${e.message}`, 'error'); }
                }
                if (eaten) break;
            }

            wsSend({ type: 'raw', network: netId, line: raw.slice(1) });
        }
    }
}

function onNickColourChange() {
    if (!state.settings.advanced) state.settings.advanced = {};
    state.settings.advanced.ownNickColour = $('pref-own-nick-color').value;
    state.settings.advanced.otherNickColour = $('pref-other-nick-color').value;
    if (state.active) switchBuf(state.active);
    wsSend({ type: 'save_settings', settings: state.settings });
}

function openSettings() {
    $('settings-modal').classList.remove('hidden');
    loadIdentityForm();
    loadBouncerForm();
    loadThemeIntoUI();
    loadAliasesForm();
    loadHighlightsForm();
    renderIgnoreList();
}
function closeSettings() { $('settings-modal').classList.add('hidden'); }

const NETWORK_PRESETS = {
    libera: { name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, ssl: true, verify_ssl: true },
    oftc: { name: 'OFTC', host: 'irc.oftc.net', port: 6697, ssl: true, verify_ssl: true },
    freenode: { name: 'Freenode', host: 'irc.freenode.net', port: 6697, ssl: true, verify_ssl: true },
    efnet: { name: 'EFnet', host: 'irc.efnet.org', port: 6667, ssl: false, verify_ssl: false },
    undernet: { name: 'Undernet', host: 'us.undernet.org', port: 6667, ssl: false, verify_ssl: false },
    dalnet: { name: 'DALnet', host: 'irc.dal.net', port: 6667, ssl: false, verify_ssl: false },
    rizon: { name: 'Rizon', host: 'irc.rizon.io', port: 6697, ssl: true, verify_ssl: true },
    espernet: { name: 'EsperNet', host: 'irc.esper.net', port: 6697, ssl: true, verify_ssl: true },
};

function openNetList() {
    $('netlist-modal').classList.remove('hidden');
    renderNetList();
}
function closeNetList() { $('netlist-modal').classList.add('hidden'); }

function renderNetList() {
    const nl = $('net-list');
    nl.innerHTML = '';
    for (const n of (state.settings.networks || [])) {
        const conn = state.networks[n.id];
        const status = conn?.status || 'disconnected';
        const row = mk('div', 'nrow');
        const info = mk('div', 'nrow-info');
        const srv = n.servers?.[0];

        const nameEl = document.createElement('strong'); nameEl.textContent = n.name;
        const hostEl = document.createElement('small');
        hostEl.textContent = srv ? `${srv.host}:${srv.port}${srv.ssl ? ' SSL' : ''}` : '';
        info.append(nameEl, hostEl);
        const st = mk('span', `nst ${status}`); st.textContent = status;
        const editBtn = mk('button', 'btn-edit'); editBtn.textContent = 'Edit';
        editBtn.onclick = () => openNetModal(n.id);
        const connBtn = mk('button', status === 'connected' ? 'btn-disc' : 'btn-conn');
        connBtn.textContent = status === 'connected' ? 'Disconnect' : 'Connect';
        connBtn.onclick = () => {
            if (status === 'connected') wsSend({ type: 'disconnect', network_id: n.id });
            else wsSend({ type: 'connect', network_id: n.id });
        };
        row.append(info, st, editBtn, connBtn);
        nl.appendChild(row);
    }
}
function loadIdentityForm() {
    const s = state.settings;
    if (s.identity) {
        $('id-nick').value = s.identity.nick || '';
        $('id-user').value = s.identity.username || '';
        $('id-real').value = s.identity.realname || '';
        $('id-verbose').checked = !!s.verboseLogs;
    }
    if (s.advanced) {
        $('pref-raw-console').checked = !!s.advanced.rawConsole;
        $('pref-embed-media').checked = !!s.advanced.embedMedia;
        $('pref-media-proxy').checked = !!s.advanced.mediaProxy;
        $('pref-own-nick-color').value = s.advanced.ownNickColour || '#e06c75';
        $('pref-other-nick-color').value = s.advanced.otherNickColour || '#61afef';
        $('pref-condense-events').checked = !!s.advanced.condenseEvents;
        $('pref-auto-away').checked = !!s.advanced.autoAway;
        $('pref-auto-away-mins').value = s.advanced.autoAwayMinutes || 10;
        $('pref-auto-away-msg').value = s.advanced.autoAwayMsg || 'Auto-away';
        $('pref-auto-away-fields').classList.toggle('disabled', !s.advanced.autoAway);
        $('pref-upload-mode').value = s.advanced.uploadMode || 'local';
        $('pref-upload-endpoint').value = s.advanced.uploadEndpoint || '/api/upload';
        toggleUploadFields();
        const scEl = $('pref-spellcheck');
        if (scEl) {
            scEl.checked = !!s.advanced.spellCheck;
            $('input').spellcheck = !!s.advanced.spellCheck;
        }
    }
    const auth = s.auth || { enabled: false, username: '', password: '' };
    $('auth-enabled').checked = !!auth.enabled;
    $('auth-user').value = auth.username || '';
    $('auth-pass').value = auth.password || '';
    $('auth-fields').classList.toggle('disabled', !auth.enabled);
}
function saveIdentity() {
    const s = state.settings;
    s.identity = {
        nick: $('id-nick').value.trim(),
        username: $('id-user').value.trim(),
        realname: $('id-real').value.trim()
    };
    s.verboseLogs = $('id-verbose').checked;
    s.auth = {
        enabled: $('auth-enabled').checked,
        username: $('auth-user').value.trim(),
        password: $('auth-pass').value
    };
    s.advanced = {
        rawConsole: $('pref-raw-console').checked,
        embedMedia: $('pref-embed-media').checked,
        mediaProxy: $('pref-media-proxy').checked,
        ownNickColour: $('pref-own-nick-color').value,
        otherNickColour: $('pref-other-nick-color').value,
        condenseEvents: $('pref-condense-events').checked,
        autoAway: $('pref-auto-away').checked,
        autoAwayMinutes: parseInt($('pref-auto-away-mins').value) || 10,
        autoAwayMsg: $('pref-auto-away-msg').value || 'Auto-away',
        uploadMode: $('pref-upload-mode')?.value || 'local',
        uploadEndpoint: $('pref-upload-endpoint')?.value.trim() || '/api/upload',
        spellCheck: !!$('pref-spellcheck')?.checked
    };

    $('input').spellcheck = !!$('pref-spellcheck')?.checked;
    wsSend({ type: 'save_settings', settings: s });

    if (state.active) switchBuf(state.active);
}

function doLogin() {
    const username = $('li-user').value.trim();
    const password = $('li-pass').value;
    if (!username || !password) return;
    if (!ws || ws.readyState !== 1) {

        $('li-error').textContent = 'Not connected — reconnecting… try again in a moment.';
        $('li-error').classList.remove('hidden');
        return;
    }
    wsSend({ type: 'auth', username, password });
}

function toggleUploadFields() {
    const modeEl = $('pref-upload-mode');
    const endpointEl = $('pref-upload-endpoint');
    if (!modeEl || !endpointEl) return;
    endpointEl.disabled = modeEl.value !== 'custom';
}

function getUploadRequestInfo() {
    const adv = state.settings.advanced || {};
    if ((adv.uploadMode || 'local') === 'custom') {
        const endpoint = (adv.uploadEndpoint || '').trim();
        if (!endpoint) return null;
        const absoluteEndpoint = new URL(endpoint, window.location.href).href;
        return {
            endpoint: `/api/upload-relay?endpoint=${encodeURIComponent(absoluteEndpoint)}`,
            responseBase: absoluteEndpoint
        };
    }
    return {
        endpoint: '/api/upload',
        responseBase: new URL('/api/upload', window.location.href).href
    };
}

function resolveUploadUrl(payload, responseUrl) {
    if (!payload || typeof payload !== 'object') return '';
    const raw = payload.url || payload.link || payload.uploadUrl ||
        (Array.isArray(payload.urls) ? payload.urls[0] : '') || '';
    if (!raw) return '';
    try {
        return new URL(raw, responseUrl).href;
    } catch (_) {
        return raw;
    }
}

const BOUNCER_DEFAULTS = {
    reconnect: true, reconnectBase: 5, reconnectMax: 300,
    flood: true, floodRate: 4, floodBurst: 5,
    ping: true, pingInterval: 60, pongTimeout: 120,
    connectTimeout: 15, routeWhois: false, routeNotices: false,
    modernWhois: true
};

function loadBouncerForm() {
    const b = state.settings.bouncer || {};
    $('bnc-reconn').checked = b.reconnect !== false;
    $('bnc-reconn-base').value = b.reconnectBase ?? BOUNCER_DEFAULTS.reconnectBase;
    $('bnc-reconn-max').value = b.reconnectMax ?? BOUNCER_DEFAULTS.reconnectMax;
    $('bnc-flood').checked = b.flood !== false;
    $('bnc-flood-rate').value = b.floodRate ?? BOUNCER_DEFAULTS.floodRate;
    $('bnc-flood-burst').value = b.floodBurst ?? BOUNCER_DEFAULTS.floodBurst;
    $('bnc-ping').checked = b.ping !== false;
    $('bnc-ping-int').value = b.pingInterval ?? BOUNCER_DEFAULTS.pingInterval;
    $('bnc-pong-to').value = b.pongTimeout ?? BOUNCER_DEFAULTS.pongTimeout;
    $('bnc-conn-to').value = b.connectTimeout ?? BOUNCER_DEFAULTS.connectTimeout;
    $('pref-route-whois').checked = !!b.routeWhois;
    $('pref-route-notices').checked = !!b.routeNotices;
    $('pref-modern-whois').checked = b.modernWhois !== false;
    $('bnc-confirm-cmds').checked = !!b.confirmCommands;
    const bsEl = $('bnc-backlog-size');
    if (bsEl) bsEl.value = b.backlogSize ?? 200;
    if ($('pref-push-notifications')) {
        $('pref-push-notifications').checked = !!state.settings.pushNotifications;
    }
}

function saveBouncerSettings() {

    state.settings.bouncer = {
        ...(state.settings.bouncer || {}),
        reconnect: $('bnc-reconn').checked,
        reconnectBase: parseInt($('bnc-reconn-base').value) || BOUNCER_DEFAULTS.reconnectBase,
        reconnectMax: parseInt($('bnc-reconn-max').value) || BOUNCER_DEFAULTS.reconnectMax,
        flood: $('bnc-flood').checked,
        floodRate: parseInt($('bnc-flood-rate').value) || BOUNCER_DEFAULTS.floodRate,
        floodBurst: parseInt($('bnc-flood-burst').value) || BOUNCER_DEFAULTS.floodBurst,
        ping: $('bnc-ping').checked,
        pingInterval: parseInt($('bnc-ping-int').value) || BOUNCER_DEFAULTS.pingInterval,
        pongTimeout: parseInt($('bnc-pong-to').value) || BOUNCER_DEFAULTS.pongTimeout,
        connectTimeout: parseInt($('bnc-conn-to').value) || BOUNCER_DEFAULTS.connectTimeout,
        routeWhois: $('pref-route-whois').checked,
        routeNotices: $('pref-route-notices').checked,
        modernWhois: $('pref-modern-whois').checked,
        confirmCommands: $('bnc-confirm-cmds').checked,
        backlogSize: parseInt($('bnc-backlog-size')?.value) || 200
    };
    wsSend({ type: 'save_settings', settings: state.settings });
}

function loadAliasesForm() {
    const aliases = state.settings.aliases || {};
    const list = $('alias-list');
    list.innerHTML = '';
    for (const [cmd, action] of Object.entries(aliases)) {
        addAliasRow(cmd, action);
    }
}

function addAliasRow(cmd, action) {
    const list = $('alias-list');
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '5px';
    const inpCmd = document.createElement('input');
    inpCmd.type = 'text';
    inpCmd.placeholder = 'Command (e.g. gh)';
    inpCmd.value = cmd;
    inpCmd.style.width = '120px';

    const inpAct = document.createElement('input');
    inpAct.type = 'text';
    inpAct.placeholder = 'Action (e.g. /msg #github $1+)';
    inpAct.value = action;
    inpAct.style.flex = '1';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger btn-sm';
    delBtn.textContent = 'X';
    delBtn.style.padding = '0 8px';
    delBtn.onclick = () => row.remove();

    row.append(inpCmd, inpAct, delBtn);
    list.appendChild(row);
}

function saveAliases() {
    const aliases = {};
    const list = $('alias-list');
    for (const row of list.children) {
        const cmd = row.children[0].value.trim().toLowerCase();
        const action = row.children[1].value.trim();
        if (cmd && action) {
            aliases[cmd.replace(/^\//, '')] = action;
        }
    }
    state.settings.aliases = aliases;
    wsSend({ type: 'save_settings', settings: state.settings });
}

function switchPrefTab(btn, tabId) {
    document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.p-tab').forEach(p => p.classList.add('hidden'));
    $(tabId).classList.remove('hidden');
}

function openNetModal(netId) {
    state.editingNet = netId;
    const nm = $('net-modal');
    nm.classList.remove('hidden');
    $('net-modal-title').textContent = netId ? 'Edit Network' : 'Add Network';
    $('nw-del').classList.toggle('hidden', !netId);

    const presetDiv = $('nw-presets');
    if (presetDiv) {
        presetDiv.classList.toggle('hidden', !!netId);
        if (!netId) {
            presetDiv.innerHTML = '';
            for (const [key, preset] of Object.entries(NETWORK_PRESETS)) {
                const btn = mk('button', 'btn-preset');
                btn.textContent = preset.name;
                btn.onclick = () => applyNetworkPreset(preset);
                presetDiv.appendChild(btn);
            }
        }
    }

    if (netId) {
        const n = state.settings.networks.find(x => x.id === netId);
        if (!n) return;
        const srv = n.servers?.[0] || {};
        $('nw-name').value = n.name || '';
        $('nw-host').value = srv.host || '';
        $('nw-port').value = srv.port || 6697;
        $('nw-ssl').checked = !!srv.ssl;
        $('nw-vssl').checked = srv.verify_ssl !== false;
        $('nw-nick').value = n.nick || '';
        $('nw-uname').value = n.username || '';
        $('nw-real').value = n.realname || '';
        $('nw-sasl').checked = !!(n.sasl?.enabled);
        $('nw-sasl-u').value = n.sasl?.username || '';
        $('nw-sasl-p').value = n.sasl?.password || '';
        const mechEl = $('nw-sasl-mech');
        if (mechEl) mechEl.value = n.sasl?.mechanism || 'PLAIN';
        const certEl = $('nw-sasl-cert'); if (certEl) certEl.value = n.sasl?.cert || '';
        const keyEl = $('nw-sasl-key'); if (keyEl) keyEl.value = n.sasl?.key || '';
        const mode = n.mode || 'direct';
        const modeRadio = document.querySelector(`input[name="nw-mode"][value="${mode}"]`);
        if (modeRadio) modeRadio.checked = true;
        $('nw-ajoin').value = (n.channels || []).join(' ');
        $('nw-auto').checked = !!n.autoconnect;
        $('nw-logging').checked = !!n.logging;
        $('nw-autorejoin').checked = !!n.autoRejoin;
        $('nw-rejoin-delay').value = n.autoRejoinDelay ?? 3;
        $('nw-perform').value = (n.perform || []).join('\n');
        toggleSaslFields($('nw-sasl'));
    } else {
        ['nw-name', 'nw-host', 'nw-nick', 'nw-uname', 'nw-real', 'nw-sasl-u', 'nw-sasl-p', 'nw-sasl-cert', 'nw-sasl-key', 'nw-ajoin', 'nw-perform'].forEach(id => { const el = $(id); if (el) el.value = ''; });
        $('nw-port').value = 6697; $('nw-ssl').checked = true; $('nw-vssl').checked = true;
        $('nw-sasl').checked = false; $('nw-auto').checked = false;
        const mechEl = $('nw-sasl-mech'); if (mechEl) mechEl.value = 'PLAIN';
        $('nw-logging').checked = true; $('nw-autorejoin').checked = false; $('nw-rejoin-delay').value = 3;
        const directRadio = document.querySelector('input[name="nw-mode"][value="direct"]');
        if (directRadio) directRadio.checked = true;
        toggleSaslFields($('nw-sasl'));
    }
}
function applyNetworkPreset(preset) {
    $('nw-name').value = preset.name || '';
    $('nw-host').value = preset.host || '';
    $('nw-port').value = preset.port || 6697;
    $('nw-ssl').checked = !!preset.ssl;
    $('nw-vssl').checked = !!preset.verify_ssl;
}
function closeNetModal() {
    $('net-modal').classList.add('hidden');
    state.editingNet = null;

    openNetList();
}
function toggleSaslFields(cb) {
    const enabled = cb.checked;
    const mechEl = $('nw-sasl-mech');
    [$('nw-sasl-u'), $('nw-sasl-p'), $('nw-sasl-cert'), $('nw-sasl-key'), mechEl, $('nw-sasl-cert-upload-btn'), $('nw-sasl-key-upload-btn')]
        .forEach(el => { if (el) el.disabled = !enabled; });
    if (mechEl) _toggleSaslMechFields(mechEl.value);
}
function _toggleSaslMechFields(mech) {
    const isExt = mech === 'EXTERNAL';
    ['nw-sasl-u-lbl', 'nw-sasl-u', 'nw-sasl-p-lbl', 'nw-sasl-p'].forEach(id => {
        const el = $(id); if (el) el.classList.toggle('hidden', isExt);
    });
    ['nw-sasl-cert-lbl', 'nw-sasl-cert-container', 'nw-sasl-key-lbl', 'nw-sasl-key-container'].forEach(id => {
        const el = $(id); if (el) el.classList.toggle('hidden', !isExt);
    });
}
function handleCertUpload(file, textInput) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);

    const originalText = textInput.placeholder;
    textInput.placeholder = 'Uploading...';

    fetch('/api/upload-cert', {
        method: 'POST',
        body: fd
    })
    .then(r => {
        if (!r.ok) throw new Error('Upload failed');
        return r.json();
    })
    .then(data => {
        textInput.value = data.filepath;
        textInput.placeholder = originalText;
    })
    .catch(err => {
        sysMsg(null, null, 'Certificate upload failed: ' + err.message, 'error');
        textInput.placeholder = originalText;
    });
}
function saveNetwork() {
    const host = $('nw-host').value.trim();
    if (!host) { sysMsg(null, null, 'Server hostname is required.', 'error'); return; }
    const name = $('nw-name').value.trim() || host || 'Network';
    const newNet = {
        id: state.editingNet || `net_${Date.now()}`,
        name,
        servers: [{
            host,
            port: parseInt($('nw-port').value) || 6697,
            ssl: $('nw-ssl').checked,
            verify_ssl: $('nw-vssl').checked
        }],
        nick: $('nw-nick').value.trim() || (state.settings.identity?.nick) || 'WebUser',
        username: $('nw-uname').value.trim() || (state.settings.identity?.username) || 'webuser',
        realname: $('nw-real').value.trim() || (state.settings.identity?.realname) || 'Web IRC Client',
        channels: $('nw-ajoin').value.trim().split(/\s+/).filter(Boolean),
        mode: document.querySelector('input[name="nw-mode"]:checked')?.value || 'direct',
        sasl: {
            enabled: $('nw-sasl').checked,
            mechanism: $('nw-sasl-mech')?.value || 'PLAIN',
            username: $('nw-sasl-u').value.trim(),
            password: $('nw-sasl-p').value,
            cert: $('nw-sasl-cert')?.value.trim() || '',
            key: $('nw-sasl-key')?.value.trim() || ''
        },
        autoconnect: $('nw-auto').checked,
        logging: $('nw-logging').checked,
        autoRejoin: $('nw-autorejoin').checked,
        autoRejoinDelay: parseInt($('nw-rejoin-delay').value) || 3,
        perform: $('nw-perform').value.split('\n').map(l => l.trim()).filter(Boolean)
    };
    if (state.editingNet) {
        const idx = state.settings.networks.findIndex(x => x.id === state.editingNet);
        if (idx >= 0) state.settings.networks[idx] = newNet;
    } else {
        state.settings.networks.push(newNet);
        state.networks[newNet.id] = { id: newNet.id, name, nick: newNet.nick, status: 'disconnected', channels: [] };
    }
    wsSend({ type: 'save_settings', settings: state.settings });
    renderTree();
    renderNetList();
    closeNetModal();
}
function deleteNetwork() {
    if (!state.editingNet) return;
    const nid = state.editingNet;

    state.editingNet = null;
    wsSend({ type: 'disconnect', network_id: nid });
    state.settings.networks = state.settings.networks.filter(x => x.id !== nid);
    delete state.networks[nid];
    Object.keys(state.buffers).forEach(k => { if (k.startsWith(nid + '/')) delete state.buffers[k]; });
    Object.keys(state.nicks).forEach(k => { if (k.startsWith(nid + '/')) delete state.nicks[k]; });
    for (const f of ['unread', 'highlights', 'seenRecords', 'renderStart', 'topics']) {
        Object.keys(state[f]).forEach(k => { if (k.startsWith(nid + '/')) delete state[f][k]; });
    }
    delete state.dms[nid];
    updateTitle();
    wsSend({ type: 'save_settings', settings: state.settings });
    renderTree();
    $('net-modal').classList.add('hidden');
    renderNetList();
    if (state.active?.startsWith(nid + '/')) { state.active = null; showWelcome(); }
}

const DEFAULT_THEME = {
    '--bg': '#1a1a1a', '--panel': '#222', '--panel2': '#1d1d1d',
    '--hover': '#2a2a2a', '--active': '#1e3250', '--border': '#2e2e2e',
    '--bar': '#141414', '--popup': '#1e1e1e',
    '--text': '#c8c8c8', '--dim': '#666', '--accent': '#5fb4f4',
    '--green': '#48d09b', '--red': '#ff6b6b', '--yellow': '#ffd93d',
    '--purple': '#c678dd', '--scroll-thumb': '#333', '--scroll-hover': '#444',
    '--sz': '13.5px',
    '--nav-text': '#9595a8', '--tree-text': '#9999aa',
    '--whois-nick-color': '#00a0a0', '--whois-host-color': '#48d09b', '--whois-info-color': '#6eb5ff',
    '--join-text': '#df8000', '--quit-text': '#cfcf00',
    '--nick-color': ''
};
const PRESETS = {
    classic: { ...DEFAULT_THEME },
    monokai: {
        ...DEFAULT_THEME,
        '--bg': '#272822', '--panel': '#2d2e27', '--panel2': '#31322b', '--hover': '#3e3f38',
        '--active': '#49483e', '--border': '#3e3f38', '--bar': '#1e1f1c', '--popup': '#2d2e27',
        '--text': '#f8f8f2', '--dim': '#75715e', '--accent': '#66d9ef',
        '--green': '#a6e22e', '--red': '#f92672', '--yellow': '#e6db74', '--purple': '#ae81ff',
        '--scroll-thumb': '#49483e', '--scroll-hover': '#5a594d',
        '--nav-text': '#a59f85', '--tree-text': '#a59f85',
        '--join-text': '#fd971f', '--quit-text': '#e6db74'
    },
    light: {
        '--bg': '#f5f5f7', '--panel': '#ffffff', '--panel2': '#fafafa', '--hover': '#f0f0f2', '--active': '#e8e8ed',
        '--border': 'rgba(0,0,0,0.12)', '--bar': '#ffffff', '--popup': '#ffffff', '--text': '#1d1d1f',
        '--dim': '#5a5a60', '--muted': '#4b4b50', '--accent': '#0071e3', '--green': '#2c8a2c', '--red': '#d13438',
        '--yellow': '#856404', '--purple': '#af52de', '--active-text': '#0071e3', '--placeholder': '#757575',
        '--nav-text': '#4b4b50', '--tree-text': '#5a5a60',
        '--scroll-thumb': '#c1c1c6', '--scroll-hover': '#a1a1a6', '--status-ch-color': '#005a5a',
        '--input-bg': 'rgba(0,0,0,0.03)', '--input-border': 'rgba(0,0,0,0.1)',
        '--btn-sec-bg': '#e8e8ed', '--btn-sec-border': 'rgba(0,0,0,0.08)',
        '--btn-sm-bg': '#e8e8ed', '--btn-sm-border': 'rgba(0,0,0,0.08)',
        '--btn-primary-bg': '#0071e3', '--btn-primary-border': '#005bb7',
        '--btn-conn-bg': 'rgba(44, 138, 44, 0.12)', '--btn-disc-bg': 'rgba(209, 52, 56, 0.12)',
        '--btn-danger-bg': '#d13438', '--btn-danger-border': '#a12a2e',
        '--btn-edit-bg': '#f0f0f2', '--btn-edit-border': 'rgba(0,0,0,0.08)',
        '--stabs-bg': '#f5f5f7', '--nrow-bg': '#ffffff', '--nrow-border': 'rgba(0,0,0,0.08)',
        '--mactions-bg': '#fafafa', '--tog-off-bg': '#d1d1d6', '--tog-off-dot': '#ffffff',
        '--accent-text': '#ffffff', '--hl-bg': 'rgba(133, 100, 4, 0.08)',
        '--mark-bg': 'rgba(0, 113, 227, 0.2)', '--mark-text': '#0071e3',
        '--tog-on-dot': '#ffffff', '--media-bg': '#f5f5f7',
        '--backdrop': 'rgba(0,0,0,0.45)', '--shadow': 'rgba(0,0,0,0.2)', '--sz': '13.5px'
    }
};

function applyTheme(vars) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) {
        if (k.startsWith('--')) root.style.setProperty(k, v);
    }

    if (!vars['--nick-color']) root.style.removeProperty('--nick-color');
    state.settings.theme = vars;
}

function clearNickColor() {
    const current = state.settings.theme || { ...DEFAULT_THEME };
    current['--nick-color'] = '';
    document.documentElement.style.removeProperty('--nick-color');
    state.settings.theme = current;
    wsSend({ type: 'save_settings', settings: state.settings });
    loadThemeIntoUI();
}

function loadThemeIntoUI() {
    const theme = state.settings.theme || DEFAULT_THEME;
    document.querySelectorAll('.cpick').forEach(inp => {
        const val = theme[inp.dataset.var] || getComputedStyle(document.documentElement).getPropertyValue(inp.dataset.var).trim();

        if (val && val.startsWith('#')) {
            let hex = val;
            if (hex.length === 4) hex = '#' + hex.slice(1).split('').map(c => c + c).join('');
            inp.value = hex.slice(0, 7);
        }
    });

    const nickPickEl = document.querySelector('.cpick[data-var="--nick-color"]');
    if (nickPickEl && !(theme['--nick-color'] || '').startsWith('#')) {
        nickPickEl.value = state.settings.advanced?.otherNickColour || '#61afef';
    }
    const sz = parseInt(theme['--sz']) || 13;
    const szEl = $('theme-sz');
    if (szEl) { szEl.value = sz; $('theme-sz-lbl').textContent = sz + 'px'; }

    const fontEl = $('theme-font');
    if (fontEl && theme['--font']) {
        const opts = Array.from(fontEl.options);
        const match = opts.find(o => o.value === theme['--font']);
        if (match) fontEl.value = theme['--font'];
    }

    document.querySelectorAll('.cpick').forEach(inp => {
        inp.oninput = () => onColourPick(inp);
    });
}

function onColourPick(inp) {
    const current = state.settings.theme || { ...DEFAULT_THEME };
    current[inp.dataset.var] = inp.value;
    applyTheme(current);
    wsSend({ type: 'save_settings', settings: state.settings });
}

function onSzChange(el) {
    $('theme-sz-lbl').textContent = el.value + 'px';
    const current = state.settings.theme || { ...DEFAULT_THEME };
    current['--sz'] = el.value + 'px';
    applyTheme(current);
    wsSend({ type: 'save_settings', settings: state.settings });
}

function onFontChange(el) {
    const current = state.settings.theme || { ...DEFAULT_THEME };
    current['--font'] = el.value;
    applyTheme(current);
    wsSend({ type: 'save_settings', settings: state.settings });
}

function applyPreset(name) {
    if (!PRESETS[name]) return;
    applyTheme({ ...PRESETS[name] });
    loadThemeIntoUI();
    wsSend({ type: 'save_settings', settings: state.settings });
}

function resetTheme() { applyPreset('classic'); }

let _pushSubscription = null;

function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[Push] Not supported in this browser');
        return null;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        const existingSub = await registration.pushManager.getSubscription();

        if (existingSub) {
            _pushSubscription = existingSub;
            return existingSub;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        const vapidPublicKey = state.settings.vapid?.public_key_raw;
        if (!vapidPublicKey) {
            console.error('[Push] VAPID public key missing from settings');
            return null;
        }

        const applicationServerKey = urlB64ToUint8Array(vapidPublicKey);

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });

        _pushSubscription = subscription;

        wsSend({
            type: 'push_subscribe',
            subscription: subscription.toJSON()
        });

        return subscription;
    } catch (err) {
        console.error('[Push] Subscription failed:', err);
        return null;
    }
}

async function unsubscribeFromPush() {
    if (_pushSubscription) {
        try {
            const endpoint = _pushSubscription.endpoint;
            await _pushSubscription.unsubscribe();
            wsSend({ type: 'push_unsubscribe', endpoint: endpoint });
            _pushSubscription = null;
        } catch (err) {
            console.error('[Push] Unsubscribe failed:', err);
        }
    }
}

function notify(title, msg, key) {
    playBeep();
    if (!state.notifications) return;
    if (document.hasFocus()) return;

    if (state.settings.pushNotifications && _pushSubscription) {
        return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body: msg, icon: '/static/icon-192.png' });
    n.onclick = () => { window.focus(); if (key) switchBuf(key); n.close(); };
}

function toggleNotifications() {
    const cb = $('pref-notifications');
    if (cb.checked) {
        if (!('Notification' in window)) {
            cb.checked = false;
            alert('Notifications are not supported in this browser/context (HTTPS required).');
            return;
        }
        Notification.requestPermission().then(p => {
            if (p === 'granted') {
                state.notifications = true;
                state.settings.notifications = true;
                cb.nextElementSibling.nextElementSibling.textContent = 'Enabled';

                if (state.settings.pushNotifications) {
                    subscribeToPush();
                }
            } else {
                cb.checked = false;
                alert('Notification permission denied.');
            }
        });
    } else {
        state.notifications = false;
        state.settings.notifications = false;
        cb.nextElementSibling.nextElementSibling.textContent = 'Disabled';

        unsubscribeFromPush();
    }
}

function togglePushNotifications() {
    const cb = $('pref-push-notifications');
    if (!cb) return;

    if (cb.checked) {
        subscribeToPush().then(sub => {
            if (sub) {
                state.settings.pushNotifications = true;
                wsSend({ type: 'save_settings', settings: state.settings });
                cb.nextElementSibling.nextElementSibling.textContent = 'Enabled';
            } else {
                cb.checked = false;
                alert('Push notifications not supported or permission denied.');
            }
        });
    } else {
        state.settings.pushNotifications = false;
        wsSend({ type: 'save_settings', settings: state.settings });
        cb.nextElementSibling.nextElementSibling.textContent = 'Disabled';
        unsubscribeFromPush();
    }
}

function onChanModes(m) {
    const key = `${m.network}/${m.channel}`;
    state.chanModes[key] = m.modes || '';
    if (state.active === key) updateTopBar();
}

function onInvite(m) {
    const statusKey = `${m.network}/Status`;
    mkBuf(statusKey);

    pushRec(statusKey, { type: 'invite-notice', from: m.from, channel: m.channel, network: m.network, ts: m.ts || Date.now() / 1e3 });
    notify(`Invited to ${m.channel}`, `${m.from} has invited you`, `${m.network}/Status`);
}

function onSelfAway(m) {
    if (!state.networks[m.network]) return;
    state.networks[m.network].away = m.away;
    if (state.active?.startsWith(m.network + '/')) updateTopBar();
}

function onPluginEvent(m) {
    const et = m.event_type || '';
    const cbs = [
        ...(_pluginEventHooks[`plugin_event:${et}`] || []),
        ...(_pluginEventHooks['plugin_event'] || []),
    ];
    for (const cb of cbs) { try { cb(m); } catch (e) { console.error('[Plugin]', e); } }
}

function onPluginNotify(m) {
    notify(m.title || 'Plugin', m.body || '', m.channel ? `${m.network}/${m.channel}` : null);
}

function runJsPlugin(name, code) {

    unloadJsPlugin(name);
    try {

        const factory = new Function('irc', 'state', 'EAT_NONE', 'EAT_ALL', code + '\n//# sourceURL=plugin:' + name);
        const cleanup = factory(irc, state, EAT_NONE, EAT_ALL);
        _jsPlugins[name] = typeof cleanup === 'function' ? cleanup : null;
    } catch (e) {
        console.error(`[JS Plugin: ${name}]`, e);
        const isCSP = e instanceof EvalError || String(e.message).includes('unsafe-eval') || String(e.message).includes('Content Security Policy');
        const msg = isCSP
            ? `[JS Plugin: ${name}] Blocked by Content-Security-Policy — ensure web.py is serving with 'unsafe-eval' in script-src`
            : `[JS Plugin: ${name}] ${e.message}`;
        sysMsg(null, null, msg, 'error');
    }
}

function unloadJsPlugin(name) {
    const cleanup = _jsPlugins[name];
    if (typeof cleanup === 'function') {
        try { cleanup(); } catch (e) { console.error(`[JS Plugin unload: ${name}]`, e); }
    }
    delete _jsPlugins[name];
}

function _firePrint(event, word) {
    const listeners = _hookPrint[event] || [];
    const word_eol = word.map((_, i) => word.slice(i).join(' '));
    let eaten = false;
    for (const { cb, ud } of listeners) {
        try {
            const res = cb(word, word_eol, ud);
            if (res === EAT_ALL) { eaten = true; break; }
        } catch (e) { console.error(`[hookPrint:${event}]`, e); }
    }
    return eaten;
}

const _whoisPending = {};

function onWhoisInfo(m) {
    const key = m.nick.toLowerCase();
    const nid = m.network || Object.keys(state.networks)[0];
    if (!nid) return;

    delete _whoisPending[key];

    const canonNick = dmNickCanonical(nid, m.nick);
    const bufKey = `${nid}/${canonNick}`;
    ensureDmBuf(nid, canonNick);

    const ts = m.ts || Date.now() / 1000;

    if (state.settings.bouncer?.modernWhois !== false) {

        pushRec(bufKey, { type: 'whois_card', data: m, ts, network: nid });
    }

}

function showCtxMenu(e, nick) {
    e.preventDefault();
    const m = $('ctx-menu');
    m.innerHTML = '';
    m.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
    m.style.top = Math.min(e.clientY, window.innerHeight - 260) + 'px';
    m.classList.remove('hidden');

    const [nid, chan] = (state.active || '').split('/');
    const net = state.networks[nid] || {};
    const nicks = state.nicks[state.active] || {};
    const myNick = net.nick;
    const myPfx = nicks[myNick] || '';
    const isOp = myPfx && ['~', '&', '@', '%'].some(p => myPfx.includes(p));
    const targetPfx = nicks[nick] || '';

    const hdr = mk('div', 'ctx-nick-hdr'); hdr.textContent = nick;
    m.appendChild(hdr);
    m.appendChild(mk('div', 'ctx-line'));

    const items = [
        { label: 'Open Dialogue Window', cmd: () => { ensureDmBuf(nid, nick); switchBuf(`${nid}/${nick}`); } },
        {
            label: 'User Info (WhoIs)', cmd: () => {
                _whoisPending[nick.toLowerCase()] = nid;
                ensureDmBuf(nid, nick);
                switchBuf(`${nid}/${nick}`);
                wsSend({ type: 'raw', network: nid, line: `WHOIS ${nick} ${nick}` });
            }
        },
        { label: `Ping`, cmd: () => handleCommand(`/ctcp ${nick} PING`) },
        { label: isIgnored(nick) ? 'Remove Ignore' : 'Ignore', cmd: () => toggleIgnore(nick) },
    ];

    if (isOp && chan && chan.startsWith('#')) {
        const hasOp = targetPfx.includes('@') || targetPfx.includes('&') || targetPfx.includes('~');
        const hasVoice = targetPfx.includes('+');
        items.push({ line: true }, { label: 'Operator Actions', sub: true });
        items.push(
            { label: hasOp ? '  Remove Op' : '  Give Op', cmd: () => handleCommand(`/mode ${chan} ${hasOp ? '-o' : '+o'} ${nick}`) },
            { label: hasVoice ? '  Remove Voice' : '  Give Voice', cmd: () => handleCommand(`/mode ${chan} ${hasVoice ? '-v' : '+v'} ${nick}`) },
            {
                label: '  Kick', cmd: () => {
                    const reason = prompt(`Kick ${nick} from ${chan}? Reason:`, 'Requested');
                    if (reason !== null) handleCommand(`/kick ${chan} ${nick} ${reason}`);
                }
            },
            { label: '  Ban', cmd: () => handleCommand(`/mode ${chan} +b ${nick}!*@*`) },
            {
                label: '  Kickban', cmd: () => {
                    handleCommand(`/mode ${chan} +b ${nick}!*@*`);
                    handleCommand(`/kick ${chan} ${nick} Banned`);
                }
            }
        );
    }

    items.forEach(it => {
        if (it.line) {
            m.appendChild(mk('div', 'ctx-line'));
        } else if (it.sub) {
            const row = mk('div', 'ctx-item ctx-submenu-hdr'); row.textContent = it.label;
            m.appendChild(row);
        } else {
            const row = mk('div', 'ctx-item' + (it.disabled ? ' disabled' : ''));
            row.textContent = it.label;
            if (!it.disabled) row.onclick = () => { it.cmd(); m.classList.add('hidden'); };
            m.appendChild(row);
        }
    });

    const close = (ev) => {
        if (m.contains(ev.target)) return;
        m.classList.add('hidden');
        document.removeEventListener('mousedown', close);
    };
    setTimeout(() => document.addEventListener('mousedown', close), 10);
}

function showMsgCtxMenu(x, y, rec) {
    const m = $('ctx-menu');
    m.innerHTML = '';
    m.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    m.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    m.classList.remove('hidden');

    const nickClean = rec.nick ? rec.nick.replace(/^[~&@%+]/, '') : '';
    const rawText = rec.text || '';

    if (nickClean) {
        const hdr = mk('div', 'ctx-nick-hdr'); hdr.textContent = nickClean;
        m.appendChild(hdr);
        m.appendChild(mk('div', 'ctx-line'));
    }

    const items = [];
    if (rawText) {
        items.push({ label: 'Copy Text', cmd: () => {
            const write = navigator.clipboard && navigator.clipboard.writeText
                ? navigator.clipboard.writeText(rawText)
                : Promise.reject();
            write.catch(() => {
                const ta = document.createElement('textarea');
                ta.value = rawText; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); } catch (_) {}
                ta.remove();
            });
        }});
        if (rec.ts) {
            items.push({ label: 'Copy with Timestamp', cmd: () => {
                const time = fmtTime(rec.ts);
                const pfx = rec.type === 'action' ? `[${time}] * ${rec.nick || ''} ` : `[${time}] <${rec.nick || ''}> `;
                const text = pfx + rawText;
                (navigator.clipboard?.writeText(text) || Promise.reject()).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); } catch (_) {}
                    ta.remove();
                });
            }});
        }
    }
    if (nickClean && (rec.type === 'privmsg' || rec.type === 'action')) {
        items.push({ label: 'Reply', cmd: () => {
            const inp = $('input');
            inp.value = nickClean + ': ';
            inp.focus();
        }});
        items.push({ label: 'Mention', cmd: () => {
            const inp = $('input');
            inp.value = (inp.value ? inp.value.replace(/\s*$/, ' ') : '') + nickClean + ' ';
            inp.focus();
        }});
    }
    if (!items.length) { m.classList.add('hidden'); return; }

    items.forEach(it => {
        const row = mk('div', 'ctx-item');
        row.textContent = it.label;
        row.onclick = () => { it.cmd(); m.classList.add('hidden'); };
        m.appendChild(row);
    });

    const close = (ev) => {
        if (m.contains(ev.target)) return;
        m.classList.add('hidden');
        document.removeEventListener('mousedown', close);
        document.removeEventListener('touchstart', close);
    };
    setTimeout(() => {
        document.addEventListener('mousedown', close);
        document.addEventListener('touchstart', close);
    }, 10);
}

(function initChatInteractions() {
    const buf = $('chat-buffer');
    const pill = $('scroll-bottom-pill');
    if (buf) {
        buf.addEventListener('scroll', _onBufScroll, { passive: true });
    }
    if (pill) {
        pill.addEventListener('click', () => { scrollBot(); resetScrollPill(); });
    }

    if (IS_MOBILE) {
        setInterval(() => {
            document.querySelectorAll('#chat-buffer .ml-ts[data-ts]').forEach(el => {
                el.textContent = relTime(Number(el.dataset.ts));
            });
        }, 60000);
    }

    if (IS_MOBILE && buf) {
        let lpTimer = null, lpStart = null, lpTarget = null;
        const cancel = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpTarget = null; };
        buf.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) return;
            const row = e.target.closest('.ml');
            if (!row || !row._rec) return;
            const t = e.touches[0];
            lpStart = { x: t.clientX, y: t.clientY };
            lpTarget = row;
            lpTimer = setTimeout(() => {
                lpTimer = null;
                if (!lpTarget) return;
                if (navigator.vibrate) navigator.vibrate(12);
                showMsgCtxMenu(lpStart.x, lpStart.y, lpTarget._rec);
                lpTarget = null;
            }, 500);
        }, { passive: true });
        buf.addEventListener('touchmove', e => {
            if (!lpStart || !e.touches.length) return;
            const t = e.touches[0];
            if (Math.abs(t.clientX - lpStart.x) > 10 || Math.abs(t.clientY - lpStart.y) > 10) cancel();
        }, { passive: true });
        buf.addEventListener('touchend', cancel, { passive: true });
        buf.addEventListener('touchcancel', cancel, { passive: true });
    }
})();

$('input').addEventListener('paste', e => {
    const data = e.clipboardData.getData('text');
    if (!data.includes('\n')) return;
    const lines = data.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
    if (lines.length <= 2) return;
    e.preventDefault();
    showPasteConfirm(lines);
});

function showPasteConfirm(lines) {

    const existing = document.getElementById('paste-confirm-bar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'paste-confirm-bar';
    bar.className = 'paste-confirm-bar';

    const msg = document.createElement('span');
    msg.textContent = `Paste ${lines.length} lines?`;

    const preview = document.createElement('span');
    preview.className = 'paste-preview';
    preview.textContent = lines[0].slice(0, 40) + (lines[0].length > 40 ? '…' : '') + (lines.length > 1 ? ` [+${lines.length - 1} more]` : '');

    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send All';
    sendBtn.className = 'paste-btn paste-btn-send';
    sendBtn.onclick = () => {
        bar.remove();
        lines.forEach(l => {
            if (l.startsWith('/')) handleCommand(l);
            else sendMsg(l);
        });
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'paste-btn paste-btn-cancel';
    cancelBtn.onclick = () => bar.remove();

    bar.append(msg, preview, sendBtn, cancelBtn);

    const inputRow = $('input')?.closest('.input-row') || $('input')?.parentElement;
    if (inputRow) inputRow.parentElement.insertBefore(bar, inputRow);
    else document.body.appendChild(bar);
}

let _pluginEditing = null;
let _pluginEditingLang = 'python';
let _pendingSaveLoad = null;
let _pendingPluginEdit = null;

const PY_PLACEHOLDER = `# Python plugin — runs server-side persistently
# Available as both  irc  and  webirc  inside the plugin.

__plugin_info__ = {
    "name": "My Plugin",
    "description": "What this plugin does",
    "author": "You",
    "version": "1.0",
}

def on_message(word, word_eol, ud):
    nick, text, channel, network = word
    if "hello" in text.lower():
        irc.send_msg(network, channel, f"hi {nick}!")
    return irc.EAT_NONE

irc.hook_print("Channel Message", on_message)
`;

const JS_PLACEHOLDER = `// JavaScript plugin — runs client-side in the browser.
// 'irc' is the full client API object.
// Return a cleanup function if you need one.

irc.hookPrint("Channel Message", (word, word_eol, ud) => {
    const [nick, text, channel, network] = word;
    if (text.toLowerCase().includes("hello")) {
        irc.prnt(\`\${nick} said hello!\`);
    }
    return irc.EAT_NONE;
});

// Optional cleanup (called on unload/reload):
// return function cleanup() { ... };
`;

function openPluginManager() {
    $('plugin-modal').classList.remove('hidden');
    refreshPluginList();
    hidePluginEditor();
}
function refreshPluginList() { wsSend({ type: 'plugin_list' }); }
function closePluginManager() {
    $('plugin-modal').classList.add('hidden');
    _pluginEditing = null;
    _pendingPluginEdit = null;
}

function newPlugin(lang = 'python') {
    _pluginEditing = null;
    _pluginEditingLang = lang;
    _pendingPluginEdit = null;
    showPluginEditor(null, '', lang);
}
function editPlugin(name, lang = 'python') {
    _pendingPluginEdit = name;
    _pluginEditingLang = lang;
    wsSend({ type: 'plugin_get', name, lang });
}
function pluginLoad(name, lang = 'python') {
    wsSend({ type: 'plugin_set_enabled', name, lang, enabled: true });
}
function pluginUnload(name, lang = 'python') {
    wsSend({ type: 'plugin_set_enabled', name, lang, enabled: false });
}
function pluginReload(name, lang = 'python') {
    wsSend({ type: 'plugin_set_enabled', name, lang, enabled: true });
}

function showPluginEditor(name, code, lang = 'python') {
    $('plugin-editor-empty').classList.add('hidden');
    $('plugin-editor-content').classList.remove('hidden');
    $('plugin-name-inp').value = name || '';
    $('plugin-editor').value = code || '';
    $('plugin-del-btn').classList.toggle('hidden', !name);
    _pluginEditing = name;
    _pluginEditingLang = lang;

    const langEl = $('plugin-lang-badge');
    if (langEl) {
        langEl.textContent = lang === 'js' ? 'JavaScript' : 'Python';
        langEl.className = `plugin-lang-badge ${lang}`;
    }
    $('plugin-editor').placeholder = lang === 'js' ? JS_PLACEHOLDER : PY_PLACEHOLDER;
}
function hidePluginEditor() {
    $('plugin-editor-empty').classList.remove('hidden');
    $('plugin-editor-content').classList.add('hidden');
    _pluginEditing = null;
}

function savePlugin() {
    const name = $('plugin-name-inp').value.trim().replace(/[^\w\-]/g, '');
    if (!name) { sysMsg(null, null, 'Plugin name required.', 'error'); return; }
    $('plugin-name-inp').value = name;
    _pendingSaveLoad = null;
    wsSend({ type: 'plugin_save', name, lang: _pluginEditingLang, code: $('plugin-editor').value });
}
function saveAndLoadPlugin() {
    const name = $('plugin-name-inp').value.trim().replace(/[^\w\-]/g, '');
    if (!name) { sysMsg(null, null, 'Plugin name required.', 'error'); return; }
    $('plugin-name-inp').value = name;
    _pendingSaveLoad = name;
    wsSend({ type: 'plugin_save', name, lang: _pluginEditingLang, code: $('plugin-editor').value });
}
function deletePluginFromEditor() {
    const name = _pluginEditing || $('plugin-name-inp').value.trim();
    if (!name) return;
    if (!confirm(`Delete plugin "${name}"?`)) return;
    wsSend({ type: 'plugin_delete', name, lang: _pluginEditingLang });
    hidePluginEditor();
}

function onPluginList(m) {
    renderPluginList(m.plugins || []);
}
function renderPluginList(plugins) {
    const list = $('plugin-list');
    if (!list) return;
    list.innerHTML = '';
    if (!plugins.length) {
        list.innerHTML = '<div class="plugin-empty-msg">No plugins installed.<br>Create one with the buttons above.</div>';
        return;
    }
    for (const p of plugins) {
        const { name, type: lang, display, description, author, version, enabled: isLoaded } = p;
        const row = mk('div', 'plugin-row');

        const hdr = mk('div', 'plugin-row-hdr');
        const dot = mk('span', `plugin-dot${isLoaded ? ' loaded' : ''}`);
        const nm = mk('span', 'plugin-row-name'); nm.textContent = display || name;
        const badge = mk('span', `plugin-lang-badge ${lang}`);
        badge.textContent = lang === 'js' ? 'JS' : 'Py';
        hdr.append(dot, nm, badge);

        const meta = mk('div', 'plugin-row-meta');
        if (description) { const d = mk('span', 'plugin-desc'); d.textContent = description; meta.appendChild(d); }
        if (author || version) {
            const av = mk('span', 'plugin-av');
            av.textContent = [author && `by ${author}`, version && `v${version}`].filter(Boolean).join('  ');
            meta.appendChild(av);
        }

        const st = mk('span', `plugin-row-status${isLoaded ? ' loaded' : ''}`);
        st.textContent = isLoaded ? 'enabled' : 'disabled';

        const btns = mk('div', 'plugin-row-btns');
        const editBtn = mk('button', 'btn-sm');
        editBtn.textContent = 'Edit'; editBtn.onclick = () => editPlugin(name, lang);
        if (isLoaded) {
            const reloadBtn = mk('button', 'btn-sm'); reloadBtn.textContent = '↺'; reloadBtn.title = 'Reload';
            reloadBtn.onclick = () => pluginReload(name, lang);
            const unloadBtn = mk('button', 'btn-sm'); unloadBtn.textContent = 'Disable';
            unloadBtn.onclick = () => pluginUnload(name, lang);
            btns.append(reloadBtn, unloadBtn, editBtn);
        } else {
            const loadBtn = mk('button', 'btn-conn btn-sm'); loadBtn.textContent = 'Enable';
            loadBtn.onclick = () => pluginLoad(name, lang);
            btns.append(loadBtn, editBtn);
        }
        const delBtn = mk('button', 'btn-danger btn-sm'); delBtn.textContent = 'X'; delBtn.title = 'Delete';
        delBtn.onclick = () => {
            if (!confirm(`Delete "${name}"?`)) return;
            wsSend({ type: 'plugin_delete', name, lang });
        };
        btns.appendChild(delBtn);
        row.append(hdr, meta, st, btns);
        list.appendChild(row);
    }
}

function onPluginCode(m) {
    if (_pendingPluginEdit === m.name) {
        _pendingPluginEdit = null;
        showPluginEditor(m.name, m.code, m.lang || 'python');
    }
}
function onPluginSaved(m) {
    sysMsg(null, null, `Plugin "${m.name}" saved.`, 'status');
    _pluginEditing = m.name;
    $('plugin-del-btn').classList.remove('hidden');
    refreshPluginList();
    if (_pendingSaveLoad === m.name) {
        _pendingSaveLoad = null;
        pluginLoad(m.name, m.lang || 'python');
    }
}
function onPluginDeleted(m) {
    sysMsg(null, null, `Plugin "${m.name}" deleted.`, 'status');
    refreshPluginList();
}

function updateTitle() {
    const hlCount = Object.values(state.highlights).filter(Boolean).length;
    const urCount = Object.values(state.unread).reduce((s, n) => s + n, 0);

    let label = '';
    if (state.active === HIGHLIGHTS_KEY) {
        label = 'Highlights';
    } else if (state.active) {
        const [netId, chan] = state.active.split('/');
        label = chan === 'Status' ? (state.networks[netId]?.name || netId) : chan;
    }
    const suffix = label ? `${label} — WebIRC` : 'WebIRC';

    if (hlCount > 0 || state.highlightsUnread > 0) document.title = `(!) ${suffix}`;
    else if (urCount > 0) document.title = `(${urCount}) ${suffix}`;
    else document.title = suffix;
}

function openBufSearch() {
    $('buf-search-bar').classList.remove('hidden');
    $('buf-search-inp').focus();
}
function clearBufSearch() {
    const bar = $('buf-search-bar');
    if (!bar || bar.classList.contains('hidden')) return;
    bar.classList.add('hidden');
    $('buf-search-inp').value = '';
    filterBuf('');
}
function filterBuf(term) {
    const t = term.toLowerCase();
    const buf = $('chat-buffer');
    const key = state.active;

    if (t && key && key !== HIGHLIGHTS_KEY && (state.renderStart[key] || 0) > 0) {
        _renderBuffer(key, 0);
    }

    buf.classList.toggle('buf-filtering', !!t);
    for (const el of buf.children) {
        el.style.display = (!t || el.textContent.toLowerCase().includes(t)) ? '' : 'none';
    }
}

function isEditableTarget(el) {
    return !!el && (
        el.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName)
    );
}

function anyModalOpen() {
    return ['plugin-modal', 'list-modal', 'log-modal', 'net-modal', 'netlist-modal', 'settings-modal', 'quick-switcher']
        .some(id => {
            const el = $(id);
            return el && !el.classList.contains('hidden');
        });
}

function focusComposerWithKey(key) {
    const inp = $('input');
    if (!inp) return;
    if (document.activeElement !== inp) inp.focus();
    if (key) {
        const start = inp.selectionStart ?? inp.value.length;
        const end = inp.selectionEnd ?? inp.value.length;
        const next = inp.value.slice(0, start) + key + inp.value.slice(end);
        inp.value = next;
        const pos = start + key.length;
        inp.setSelectionRange(pos, pos);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

document.addEventListener('keydown', e => {
    const activeEl = document.activeElement;
    const isTypingKey = !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1;

    if (isTypingKey && !isEditableTarget(activeEl) && !anyModalOpen()) {
        e.preventDefault();
        focusComposerWithKey(e.key);
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && state.active) {
        e.preventDefault();
        openBufSearch();
    } else if (e.key === 'Escape') {
        let closedAny = false;
        const modals = [
            { id: 'plugin-modal', close: closePluginManager },
            { id: 'list-modal', close: closeListModal },
            { id: 'log-modal', close: closeLogViewer },
            { id: 'net-modal', close: closeNetModal },
            { id: 'netlist-modal', close: closeNetList },
            { id: 'settings-modal', close: closeSettings }
        ];
        for (const m of modals) {
            const el = $(m.id);
            if (el && !el.classList.contains('hidden')) {
                m.close();
                closedAny = true;
                break;
            }
        }
        if (closedAny) {
            e.preventDefault();
        } else if ($('buf-search-bar') && !$('buf-search-bar').classList.contains('hidden')) {
            clearBufSearch();
        }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {

        e.preventDefault();
        openQuickSwitcher();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey) {
        e.preventDefault();
        const keys = getAllBufferKeys();
        if (!keys.length) return;
        const idx = keys.indexOf(state.active);
        const next = e.key === 'ArrowUp'
            ? (idx <= 0 ? keys.length - 1 : idx - 1)
            : (idx >= keys.length - 1 ? 0 : idx + 1);
        switchBuf(keys[next]);
    }
});

let _listData = [];

let _quickSwitcherActive = false;
let _quickSwitcherIndex = 0;
let _quickSwitcherResults = [];

function openQuickSwitcher() {
    if (_quickSwitcherActive) { closeQuickSwitcher(); return; }
    _quickSwitcherActive = true;
    _quickSwitcherIndex = 0;
    _quickSwitcherResults = getAllBufferKeys();

    const modal = mk('div', 'quick-switcher-modal');
    modal.id = 'quick-switcher';
    const inp = mk('input', 'qs-input');
    inp.type = 'text';
    inp.placeholder = 'Type buffer name…';
    inp.autocomplete = 'off';
    const list = mk('div', 'qs-list');
    modal.append(inp, list);
    document.body.appendChild(modal);

    inp.addEventListener('input', () => filterQuickSwitcher(inp.value, list));
    inp.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); _quickSwitcherIndex = (_quickSwitcherIndex + 1) % _quickSwitcherResults.length; updateQuickSwitcherSelection(list); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); _quickSwitcherIndex = (_quickSwitcherIndex - 1 + _quickSwitcherResults.length) % _quickSwitcherResults.length; updateQuickSwitcherSelection(list); }
        else if (e.key === 'Enter' && _quickSwitcherResults.length > 0) { e.preventDefault(); switchBuf(_quickSwitcherResults[_quickSwitcherIndex]); closeQuickSwitcher(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeQuickSwitcher(); }
    });

    renderQuickSwitcherList(list);
    inp.focus();
}

function closeQuickSwitcher() {
    _quickSwitcherActive = false;
    const el = $('quick-switcher');
    if (el) el.remove();
}

function filterQuickSwitcher(term, list) {
    const t = term.toLowerCase();
    _quickSwitcherResults = getAllBufferKeys().filter(k => {
        const [nid, ch] = k.split('/');
        const name = (ch || state.networks[nid]?.name || nid).toLowerCase();
        return !t || name.includes(t);
    });
    _quickSwitcherIndex = 0;
    renderQuickSwitcherList(list);
}

function updateQuickSwitcherSelection(list) {
    list.querySelectorAll('.qs-item').forEach((el, i) => {
        el.classList.toggle('qs-active', i === _quickSwitcherIndex);
    });
    list.children[_quickSwitcherIndex]?.scrollIntoView({ block: 'nearest' });
}

function renderQuickSwitcherList(list) {
    list.innerHTML = '';
    _quickSwitcherResults.slice(0, 20).forEach((key, i) => {
        const [nid, ch] = key.split('/');
        const net = state.networks[nid] || {};
        const name = ch || net.name || nid;
        const item = mk('div', 'qs-item' + (i === _quickSwitcherIndex ? ' qs-active' : ''));
        item.textContent = name;
        item.onclick = () => { switchBuf(key); closeQuickSwitcher(); };
        list.appendChild(item);
    });
    if (_quickSwitcherResults.length === 0) {
        const empty = mk('div', 'qs-empty'); empty.textContent = 'No buffers found'; list.appendChild(empty);
    }
}

function openListModal() {
    const netId = getActiveNetId();
    if (!netId) { sysMsg(null, null, 'Not connected to any network.', 'error'); return; }
    $('list-modal').classList.remove('hidden');
    $('list-search-inp').value = '';
    $('list-count').textContent = '';
    const tbody = $('list-tbody');
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3" style="text-align:center;padding:20px;color:var(--dim)">Fetching channel list\u2026</td>';
    tbody.appendChild(tr);
}
function closeListModal() { $('list-modal').classList.add('hidden'); }

function onListChannels(m) {
    _listData = (m.channels || []).sort((a, b) => b.users - a.users);
    $('list-modal').classList.remove('hidden');
    renderListChannels(_listData);
}
function renderListChannels(channels) {
    const tbody = $('list-tbody');
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const ch of channels) {
        const tr = document.createElement('tr');
        tr.className = 'list-row';
        const tdChan = document.createElement('td');
        tdChan.textContent = ch.channel;
        tdChan.onclick = () => { handleCommand(`/join ${ch.channel}`); closeListModal(); };
        const tdUsers = document.createElement('td');
        tdUsers.textContent = ch.users;
        const tdTopic = document.createElement('td');
        tdTopic.textContent = ch.topic;
        tr.append(tdChan, tdUsers, tdTopic);
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);
    $('list-count').textContent = `${channels.length} channels`;
}
function filterListChannels(term) {
    const t = term.toLowerCase();

    const rows = $('list-tbody').rows;
    let visible = 0;
    for (let i = 0; i < rows.length; i++) {
        const ch = _listData[i];
        if (!ch) continue;
        const show = !t || ch.channel.toLowerCase().includes(t) || ch.topic.toLowerCase().includes(t);
        rows[i].style.display = show ? '' : 'none';
        if (show) visible++;
    }
    $('list-count').textContent = `${visible} channels`;
}

wsConnect();

(function initMobile() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;

    const inp = $('input');
    if (inp) inp.placeholder = 'Type a message…';

    if (window.visualViewport) {
        const updateVH = () => {
            const vvh = window.visualViewport.height;
            document.documentElement.style.setProperty('--vvh', vvh + 'px');

            if (window.visualViewport.offsetTop > 0) {
                window.scrollTo(0, window.visualViewport.offsetTop);
            }
        };
        window.visualViewport.addEventListener('resize', () => {
            updateVH();

            if (document.activeElement === inp) scrollBot();
        });
        window.visualViewport.addEventListener('scroll', updateVH);
        updateVH();
    }

    if (inp) {
        inp.addEventListener('focus', () => {
            document.body.classList.add('keyboard-open');

            scrollBot();
            resetScrollPill();
            setTimeout(scrollBot, 100);
            setTimeout(scrollBot, 300);
        });
        inp.addEventListener('blur', () => {
            document.body.classList.remove('keyboard-open');
        });
    }

    const leftZone = document.createElement('div');
    leftZone.id = 'swipe-left-zone';
    const rightZone = document.createElement('div');
    rightZone.id = 'swipe-right-zone';
    document.body.appendChild(leftZone);
    document.body.appendChild(rightZone);

    let swipe = null;

    const SWIPE_THRESHOLD = 40;
    const SWIPE_MAX_ANGLE = 0.6;

    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        swipe = { startX: t.clientX, startY: t.clientY, drawerOpen: false };

        const treeOpen = $('server-tree').classList.contains('visible');
        const usersOpen = $('userlist-panel').classList.contains('visible');

        if (treeOpen) {
            swipe.mode = 'close-left';
        } else if (usersOpen) {
            swipe.mode = 'close-right';
        } else if (t.clientX < 28) {
            swipe.mode = 'open-left';
        } else if (t.clientX > window.innerWidth - 28) {
            swipe.mode = 'open-right';
        } else {
            swipe = null;
        }
    }

    function onTouchEnd(e) {
        if (!swipe) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - swipe.startX;
        const dy = t.clientY - swipe.startY;

        if (Math.abs(dy) > Math.abs(dx) * (1 / SWIPE_MAX_ANGLE)) { swipe = null; return; }

        if (swipe.mode === 'open-left' && dx > SWIPE_THRESHOLD) toggleTree();
        if (swipe.mode === 'open-right' && dx < -SWIPE_THRESHOLD) toggleUserList();
        if (swipe.mode === 'close-left' && dx < -SWIPE_THRESHOLD) closeMobilePanels();
        if (swipe.mode === 'close-right' && dx > SWIPE_THRESHOLD) closeMobilePanels();

        swipe = null;
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
})();

let state_log = { network: '', channel: '', activeDate: '', total: 0, fromLine: 0, perPage: 300, searchActive: false, loadOlder: false };
let _logPendingTarget = null;

function _openResultInContext(date, channel, network, ts) {
    _logPendingTarget = { ts, date };
    openLogViewerFor(network, channel);
}

function openLogViewer() {
    if (!state.active) return sysMsg(null, null, 'Join a channel or speak to a user first to view logs.', 'error');
    const [net, chan] = state.active.split('/');
    $('log-modal').classList.remove('hidden');
    _populateLogSelectors();
    openLogViewerFor(net, chan);
}
function closeLogViewer() { $('log-modal').classList.add('hidden'); }

function _populateLogSelectors() {
    const netSel = $('log-net-sel');
    const chanSel = $('log-chan-sel');
    if (!netSel || !chanSel) return;
    netSel.innerHTML = '';

    const globalOpt = document.createElement('option');
    globalOpt.value = '*';
    globalOpt.textContent = 'All Networks';
    netSel.appendChild(globalOpt);

    for (const [nid, net] of Object.entries(state.networks)) {
        const opt = document.createElement('option');
        opt.value = nid; opt.textContent = net.name || nid;
        netSel.appendChild(opt);
    }
    _updateLogChanSelector();
}
function _updateLogChanSelector() {
    const netSel = $('log-net-sel');
    const chanSel = $('log-chan-sel');
    if (!netSel || !chanSel) return;
    const nid = netSel.value;

    if (nid === '*') {
        chanSel.innerHTML = '<option value="*">All Channels</option>';
        chanSel.disabled = true;
        const searchAllChk = $('log-search-all');
        if (searchAllChk) {
            searchAllChk.checked = true;
            searchAllChk.disabled = true;
        }
        return;
    }

    chanSel.disabled = false;
    const searchAllChk = $('log-search-all');
    if (searchAllChk) {
        searchAllChk.disabled = false;
    }

    const net = state.networks[nid] || {};
    chanSel.innerHTML = '';
    for (const ch of ['Status', ...(net.channels || [])]) {
        const opt = document.createElement('option');
        opt.value = ch; opt.textContent = ch;
        chanSel.appendChild(opt);
    }

    if (state_log.network === nid && state_log.channel) chanSel.value = state_log.channel;
}
function onLogNetChange() {
    _updateLogChanSelector();
    const nid = $('log-net-sel').value;
    const chan = $('log-chan-sel').value || 'Status';
    openLogViewerFor(nid, chan);
}
function onLogChanChange() {
    const nid = $('log-net-sel').value;
    const chan = $('log-chan-sel').value || 'Status';
    openLogViewerFor(nid, chan);
}
function openLogViewerFor(net, chan) {
    state_log = { network: net, channel: chan, activeDate: '', total: 0, fromLine: 0, perPage: 300, searchActive: false };

    if ($('log-net-sel')) $('log-net-sel').value = net;
    if ($('log-chan-sel')) { _updateLogChanSelector(); $('log-chan-sel').value = chan; }

    if (net === '*') {
        $('log-lines').innerHTML = '<div class="buf-placeholder">Enter a search query below to search all networks.</div>';
        $('log-dates').innerHTML = '<div class="buf-placeholder" style="padding:10px;text-align:center;font-size:12px;color:var(--dim)">Network-wide search active.</div>';
        $('log-search-input').value = '';
        updateLogStatus();
        return;
    }

    $('log-lines').innerHTML = '<div class="buf-placeholder">Select a date to view logs…</div>';
    $('log-dates').innerHTML = '<div class="log-loading">Loading…</div>';
    $('log-search-input').value = '';
    updateLogStatus();
    wsSend({ type: 'get_log_dates', network: net, channel: chan });
}

function _logDateToISO(d) {

    if (d && d.length === 10 && d[2] === '-') {
        return `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
    }
    return d;
}
function _todayLogStr() {
    const n = new Date();
    const dd = String(n.getDate()).padStart(2, '0');
    const mm = String(n.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${n.getFullYear()}`;
}
function _friendlyDate(d) {
    const today = _todayLogStr();
    const yest = (() => {
        const n = new Date(Date.now() - 86400000);
        return `${String(n.getDate()).padStart(2, '0')}-${String(n.getMonth() + 1).padStart(2, '0')}-${n.getFullYear()}`;
    })();
    if (d === today) return 'Today';
    if (d === yest) return 'Yesterday';

    try {
        const dt = new Date(_logDateToISO(d) + 'T00:00:00');
        return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (_) { return d; }
}

function onLogDates(m) {
    const list = $('log-dates');
    list.innerHTML = '';
    if (!m.dates.length) {
        list.innerHTML = '<div class="buf-placeholder" style="padding:10px">No logs found</div>';
        return;
    }
    const today = _todayLogStr();
    m.dates.forEach(d => {
        const item = mk('div', 'log-date-item' + (d === today ? ' log-today' : ''));
        const label = mk('span', 'ldi-label'); label.textContent = _friendlyDate(d);
        const sub = mk('span', 'ldi-sub'); sub.textContent = d;
        item.append(label, sub);
        item.onclick = () => {
            document.querySelectorAll('.log-date-item').forEach(x => x.classList.remove('active'));
            item.classList.add('active');
            state_log.activeDate = d;
            state_log.searchActive = false;
            $('log-search-input').value = '';
            loadLogPage(d, null);
        };
        list.append(item);
    });

    if (_logPendingTarget) {
        const targetDate = _logPendingTarget.date;
        const items = [...list.querySelectorAll('.log-date-item')];
        const match = items.find(x => x.querySelector('.ldi-sub')?.textContent === targetDate);
        if (match) { match.click(); match.scrollIntoView({ block: 'nearest' }); return; }
    }
    if (m.dates.includes(_todayLogStr())) {
        list.querySelector('.log-today')?.click();
    } else {
        list.firstChild?.click();
    }
}

function loadLogPage(date, beforeLine) {
    state_log.loadOlder = beforeLine != null;
    $('log-lines').innerHTML = '<div class="log-loading">Loading…</div>';
    wsSend({
        type: 'get_log', network: state_log.network, channel: state_log.channel,
        date, limit: state_log.perPage, before_line: beforeLine ?? null
    });
}

function onLogContent(m) {
    state_log.total = m.total ?? 0;
    state_log.fromLine = m.from ?? 0;
    const lines = $('log-lines');
    lines.innerHTML = '';
    const frag = document.createDocumentFragment();

    if (state_log.fromLine > 0) {
        const btn = mk('div', 'log-load-older');
        btn.textContent = `↑ Load older (${state_log.fromLine} more lines above)`;
        btn.onclick = () => loadLogPage(state_log.activeDate, state_log.fromLine);
        frag.appendChild(btn);
    }
    if (m.lines.length === 0) {
        const ph = mk('div', 'buf-placeholder'); ph.textContent = 'No messages on this date.';
        frag.appendChild(ph);
    } else {
        m.lines.forEach(l => frag.appendChild(buildLine(l)));
    }
    lines.appendChild(frag);

    if (!state_log.loadOlder) lines.scrollTop = lines.scrollHeight;
    state_log.loadOlder = false;
    updateLogStatus();

    if (_logPendingTarget) {
        const tgt = _logPendingTarget;
        _logPendingTarget = null;
        for (const el of lines.querySelectorAll('.ml')) {
            const r = el._rec;
            if (r && Math.abs(Number(r.ts) - Number(tgt.ts)) < 0.01) {
                setTimeout(() => {
                    el.scrollIntoView({ block: 'center', behavior: 'instant' });
                    el.classList.add('hl-jump-flash');
                    setTimeout(() => el.classList.remove('hl-jump-flash'), 1600);
                }, 30);
                break;
            }
        }
    }
}

function updateLogStatus() {
    const el = $('log-status');
    if (!el) return;
    if (state_log.searchActive) { el.textContent = ''; return; }
    if (!state_log.activeDate) { el.textContent = ''; return; }
    const showing = state_log.total - state_log.fromLine;
    if (state_log.total > 0) {
        el.textContent = `Showing last ${showing} of ${state_log.total} lines — ${state_log.activeDate}`;
    } else {
        el.textContent = state_log.activeDate || '';
    }
}

function searchLogs() {
    const query = $('log-search-input').value.trim();
    if (!query) {
        state_log.searchActive = false;
        if (state_log.activeDate) loadLogPage(state_log.activeDate, null);
        return;
    }
    const allCh = $('log-search-all')?.checked || false;
    state_log.searchActive = true;
    state_log.searchAllChannels = allCh;
    $('log-lines').innerHTML = '<div class="log-loading">Searching…</div>';
    $('log-status').textContent = '';
    wsSend({
        type: 'search_logs', network: state_log.network,
        channel: allCh ? '*' : state_log.channel, query
    });
}

function onSearchResults(m) {
    const lines = $('log-lines');
    lines.innerHTML = '';
    const frag = document.createDocumentFragment();
    const hdr = mk('div', 'log-search-hdr');
    const capped = !!m.truncated;
    hdr.textContent = `${m.results.length}${capped ? '+' : ''} results for "${m.query}"${m.all_channels ? ' (all channels)' : ''} (scanned ${m.total_scanned ?? '?'} lines)`;
    frag.appendChild(hdr);
    if (m.results.length === 0) {
        const ph = mk('div', 'buf-placeholder'); ph.textContent = 'No matches found.';
        frag.appendChild(ph);
    } else {
        let lastDate = null;
        let lastChan = null;
        for (const r of m.results) {

            if (r.date !== lastDate) {
                const sep = mk('div', 'log-date-sep');
                sep.textContent = _friendlyDate(r.date) + ' — ' + r.date;
                frag.appendChild(sep);
                lastDate = r.date;
                lastChan = null;
            }

            const isGlobal = m.network === '*';
            const chanKey = `${r.network || m.network}/${r.channel}`;
            if ((isGlobal || m.all_channels) && r.channel && chanKey !== lastChan) {
                const chSep = mk('div', 'log-date-sep');
                const netName = state.networks[r.network]?.name || r.network || '';
                const chanDisplay = r.channel.startsWith('#') || r.channel.startsWith('&') ? r.channel : '#' + r.channel;
                chSep.textContent = isGlobal ? `[${netName}] ${chanDisplay}` : chanDisplay;
                chSep.style.opacity = '0.6';
                chSep.style.fontSize = '11px';
                frag.appendChild(chSep);
                lastChan = chanKey;
            }
            const row = buildLine(r);

            const txtEl = row.querySelector('.ml-text');
            if (txtEl) txtEl.innerHTML = highlight(txtEl.innerHTML, m.query);

            const tsEl = row.querySelector('.ml-ts');
            if (tsEl && r.date) {
                tsEl.classList.add('log-ctx-link');
                tsEl.title = `Open in context: ${r.date}, ${r.channel}`;
                tsEl.onclick = (e) => {
                    e.stopPropagation();
                    _openResultInContext(r.date, r.channel, r.network || m.network, Number(r.ts));
                };
            }
            frag.appendChild(row);
        }
        if (capped) {
            const cap = mk('div', 'buf-placeholder');
            cap.textContent = 'Result limit reached (200). Refine your search for more specific results.';
            frag.appendChild(cap);
        }
    }
    lines.appendChild(frag);
    $('log-status').textContent = `Searched ${m.total_scanned ?? '?'} lines`;
}

function toggleIgnore(nick) {
    if (!state.settings.ignored) state.settings.ignored = [];
    const idx = state.settings.ignored.indexOf(nick);
    if (idx === -1) {
        state.settings.ignored.push(nick);
        sysMsg(null, null, `Now ignoring ${nick}.`, 'status');
    } else {
        state.settings.ignored.splice(idx, 1);
        sysMsg(null, null, `Stopped ignoring ${nick}.`, 'status');
    }
    wsSend({ type: 'save_settings', settings: state.settings });
    renderIgnoreList();
}

function renderIgnoreList() {
    const container = $('ignore-list');
    if (!container) return;
    container.innerHTML = '';
    const entries = state.settings.ignored || [];
    if (!entries.length) {
        const ph = mk('div', ''); ph.style.cssText = 'color:var(--dim);font-size:12px';
        ph.textContent = 'No ignored entries.';
        container.appendChild(ph);
        return;
    }
    for (const entry of entries) {
        const row = mk('div', '');
        row.style.cssText = 'display:flex;align-items:center;gap:6px';
        const lbl = mk('span', '');
        lbl.style.cssText = 'flex:1;font-size:12px;font-family:var(--font);color:var(--text)';
        lbl.textContent = entry;
        const rm = mk('button', 'btn-danger btn-sm');
        rm.textContent = 'X';
        rm.title = `Remove ignore: ${entry}`;
        rm.addEventListener('click', () => toggleIgnore(entry));
        row.append(lbl, rm);
        container.appendChild(row);
    }
}

function addIgnoreEntry() {
    const inp = $('ignore-add-inp');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    if (!state.settings.ignored) state.settings.ignored = [];
    if (!state.settings.ignored.includes(val)) {
        state.settings.ignored.push(val);
        wsSend({ type: 'save_settings', settings: state.settings });
        sysMsg(null, null, `Now ignoring ${val}.`, 'status');
        renderIgnoreList();
    }
    inp.value = '';
}

function isIgnored(nick, mask) {
    return (state.settings.ignored || []).some(entry => {
        if (entry.includes('!') || entry.includes('*') || entry.includes('?'))
            return matchGlob(entry, mask || nick);
        return entry.toLowerCase() === (nick || '').toLowerCase();
    });
}

function matchGlob(pattern, str) {
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return re.test(str || '');
}
function isHighlight(nick, text, network) {
    const ownNick = (state.networks[network] || {}).nick || '';
    if (ownNick && text.toLowerCase().includes(ownNick.toLowerCase())) return true;
    return (state.settings.highlightWords || []).some(w => w && text.toLowerCase().includes(w.toLowerCase()));
}
let _lastBeep = 0;
function playBeep() {
    if (!state.settings.soundOnHighlight) return;
    const now = Date.now();
    if (now - _lastBeep < 500) return;
    _lastBeep = now;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 820;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
        osc.onended = () => ctx.close();
    } catch (_) { }
}
function watchedNickAlert(nick, eventText, key) {
    const watched = state.settings.watchedNicks || [];
    if (!watched.some(w => w.toLowerCase() === nick.toLowerCase())) return;
    sysMsg(null, null, `[Watch] ${nick} ${eventText}`, 'status');
    notify(`Watched: ${nick}`, eventText, key);
}
function getAllBufferKeys() {
    const keys = [];
    for (const [netId, net] of Object.entries(state.networks)) {
        keys.push(`${netId}/Status`);
        if (state.buffers[`${netId}/Console`]) keys.push(`${netId}/Console`);
        for (const ch of (net.channels || [])) keys.push(`${netId}/${ch}`);
        for (const nick of (state.dms[netId] || [])) keys.push(`${netId}/${nick}`);
    }
    return keys;
}
function _showCtxAt(e, items) {
    const m = $('ctx-menu');
    m.innerHTML = '';
    m.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
    m.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
    m.classList.remove('hidden');
    for (const it of items) {
        if (it.sep) { const s = mk('div', 'ctx-sep'); m.appendChild(s); continue; }
        const el = mk('div', it.danger ? 'ctx-item ctx-item-danger' : 'ctx-item');
        el.textContent = it.label;
        if (it.disabled) { el.classList.add('ctx-item-disabled'); }
        else { el.onclick = () => { m.classList.add('hidden'); it.action(); }; }
        m.appendChild(el);
    }
    const stop = ev => { if (!m.contains(ev.target)) { m.classList.add('hidden'); document.removeEventListener('mousedown', stop); } };
    setTimeout(() => document.addEventListener('mousedown', stop), 10);
}

function showNetCtxMenu(e, netId) {
    const net = state.networks[netId] || {};
    const connected = net.status === 'connected';
    const connecting = net.status === 'connecting';
    const collapsed = !!state.collapsed[netId];
    const items = [];
    if (connected) {
        items.push({ label: 'Disconnect', action: () => wsSend({ type: 'disconnect', network_id: netId }) });
        items.push({ label: 'Reconnect', action: () => { wsSend({ type: 'disconnect', network_id: netId }); setTimeout(() => wsSend({ type: 'connect', network_id: netId }), 800); } });
    } else if (connecting) {
        items.push({ label: 'Connecting…', disabled: true });
    } else {
        items.push({ label: 'Connect', action: () => wsSend({ type: 'connect', network_id: netId }) });
    }
    items.push({ sep: true });
    items.push({
        label: collapsed ? 'Expand' : 'Collapse', action: () => {
            state.collapsed[netId] = !state.collapsed[netId];
            renderTree();
        }
    });
    items.push({ label: 'Network Settings…', action: () => openSettings() });
    _showCtxAt(e, items);
}

function showTreeCtxMenu(e, key, isPinned) {
    const [netId, ch] = key.split('/');
    const net = state.networks[netId] || {};
    const isChannel = ch && ch.match(/^[#&!+]/);
    const isDm = ch && !isChannel && ch !== 'Status' && ch !== 'Console';
    const isJoined = isChannel && (net.channels || []).includes(ch);
    const items = [];

    if (isChannel) {
        if (isJoined) {
            items.push({ label: 'Part channel', action: () => wsSend({ type: 'part', network: netId, channel: ch, reason: 'Leaving' }) });
        } else {
            items.push({ label: 'Rejoin', action: () => wsSend({ type: 'raw', network_id: netId, line: `JOIN ${ch}` }) });
        }
        items.push({ label: 'Copy name', action: () => navigator.clipboard?.writeText(ch) });
        items.push({ sep: true });
        items.push({ label: isPinned ? 'Unpin' : 'Pin to top', action: () => togglePin(key) });
        items.push({ label: 'Close buffer', action: () => closeBuf(key) });
    } else if (isDm) {
        items.push({ label: 'WHOIS', action: () => wsSend({ type: 'raw', network_id: netId, line: `WHOIS ${ch} ${ch}` }) });
        items.push({ label: 'Copy nick', action: () => navigator.clipboard?.writeText(ch) });
        items.push({ sep: true });
        items.push({ label: 'Close DM', action: () => closeBuf(key) });
    } else {

        if (ch === 'Console') items.push({ label: 'Close Console', action: () => closeBuf(key) });
    }

    if (items.length) _showCtxAt(e, items);
}
function togglePin(key) {
    if (!state.settings.pinned) state.settings.pinned = [];
    const idx = state.settings.pinned.indexOf(key);
    if (idx === -1) state.settings.pinned.push(key);
    else state.settings.pinned.splice(idx, 1);
    wsSend({ type: 'save_settings', settings: state.settings });
    renderTree();
}
function closeBuf(key) {
    const [netId, ch] = key.split('/');
    if (!ch || ch === 'Status') return;
    delete state.buffers[key]; delete state.nicks[key];
    delete state.seenRecords[key];
    delete state.renderStart[key];
    delete state.unread[key]; delete state.highlights[key];
    delete _bufLastDate[key];
    if (state.settings.pinned) state.settings.pinned = state.settings.pinned.filter(k => k !== key);
    if (state.dms[netId]) state.dms[netId].delete(ch);
    if (state.active === key) { state.active = null; showWelcome(); }
    renderTree();
}
function exportSettings() {
    const blob = new Blob([JSON.stringify(state.settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'webirc-settings.json'; a.click();
    URL.revokeObjectURL(url);
}
function importSettings() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
        const file = inp.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!data || typeof data !== 'object') throw new Error('Invalid format');
                if (confirm('Replace all settings with imported file?')) {
                    state.settings = data;
                    wsSend({ type: 'save_settings', settings: state.settings });
                    closeSettings();
                    sysMsg(null, null, 'Settings imported.', 'status');
                }
            } catch (err) { alert('Import failed: ' + err.message); }
        };
        reader.readAsText(file);
    };
    inp.click();
}
function downloadLogs() {
    const lines = $('log-lines').querySelectorAll('.ml');
    if (!lines.length) { sysMsg(null, null, 'No log content to download.', 'error'); return; }
    const text = Array.from(lines).map(el => el.textContent.trim()).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state_log.network || 'webirc'}-${state_log.channel || 'log'}-${state_log.activeDate || 'export'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}
function loadHighlightsForm() {
    const wEl = $('hl-words'), wkEl = $('hl-watched'), sEl = $('hl-sound');
    if (wEl) wEl.value = (state.settings.highlightWords || []).join('\n');
    if (wkEl) wkEl.value = (state.settings.watchedNicks || []).join('\n');
    if (sEl) {
        sEl.checked = !!state.settings.soundOnHighlight;
        const lbl = sEl.nextElementSibling?.nextElementSibling;
        if (lbl) lbl.textContent = sEl.checked ? 'Enabled' : 'Disabled';
    }
}
function saveHighlights() {
    state.settings.highlightWords = ($('hl-words').value || '').split('\n').map(s => s.trim()).filter(Boolean);
    state.settings.watchedNicks = ($('hl-watched').value || '').split('\n').map(s => s.trim()).filter(Boolean);
    state.settings.soundOnHighlight = $('hl-sound').checked;
    wsSend({ type: 'save_settings', settings: state.settings });
    sysMsg(null, null, '\u2713 Highlights saved.', 'status');

}

let _eventCleanup = [];

function initEvents() {

    _eventCleanup.forEach(fn => fn());
    _eventCleanup = [];

    const on = (el, event, handler, opts) => {
        if (!el) return;
        el.addEventListener(event, handler, opts);
        _eventCleanup.push(() => el.removeEventListener(event, handler, opts));
    };

    on(window, 'hashchange', handleDeepLink);

    on($('mobile-backdrop'), 'click', closeMobilePanels);
    on($('m-toggle-tree'), 'click', toggleTree);
    on($('m-toggle-users'), 'click', toggleUserList);

    on($('li-user'), 'keydown', e => { if (e.key === 'Enter') doLogin(); });
    on($('li-pass'), 'keydown', e => { if (e.key === 'Enter') doLogin(); });
    on($('btn-login'), 'click', doLogin);

    on($('menu-server'), 'click', e => toggleIrcMenu(e));
    on($('dd-networks'), 'click', openNetList);
    on($('dd-chanlist'), 'click', openListModal);
    on($('dd-logs'), 'click', openLogViewer);
    on($('dd-settings'), 'click', openSettings);
    on($('dd-plugins'), 'click', openPluginManager);

    on($('mtm-networks'), 'click', () => { openNetList(); closeMobilePanels(); });
    on($('mtm-chanlist'), 'click', () => { openListModal(); closeMobilePanels(); });
    on($('mtm-settings'), 'click', () => { openSettings(); closeMobilePanels(); });
    on($('mtm-plugins'), 'click', () => { openPluginManager(); closeMobilePanels(); });

    on($('topic-text'), 'click', editTopic);

    on($('buf-search-inp'), 'input', e => filterBuf(e.target.value));
    on($('buf-search-clear'), 'click', clearBufSearch);

    on($('settings-backdrop'), 'click', closeSettings);
    on($('settings-close'), 'click', closeSettings);

    on($('settings-search'), 'input', e => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) return;
        const panels = document.querySelectorAll('#settings-modal .p-tab');
        for (const panel of panels) {
            if (panel.textContent.toLowerCase().includes(q)) {
                const tab = document.querySelector(`.m-tab[data-tab="${panel.id}"]`);
                if (tab) switchPrefTab(tab, panel.id);
                break;
            }
        }
    });
    on($('settings-search'), 'keydown', e => {
        if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
    });

    on(document.querySelector('#settings-modal .modal-body-tabs'), 'click', e => {
        const tab = e.target.closest('.m-tab');
        if (tab && tab.dataset.tab) switchPrefTab(tab, tab.dataset.tab);
    });

    on($('btn-export'), 'click', exportSettings);
    on($('btn-import'), 'click', importSettings);
    on($('btn-save-identity'), 'click', saveIdentity);

    on($('auth-enabled'), 'change', function () {
        $('auth-fields').classList.toggle('disabled', !this.checked);
    });
    on($('pref-notifications'), 'change', toggleNotifications);
    on($('pref-push-notifications'), 'change', togglePushNotifications);
    on($('btn-save-security'), 'click', saveIdentity);

    on($('btn-save-bouncer'), 'click', saveBouncerSettings);

    on(document.querySelector('.theme-presets'), 'click', e => {
        const btn = e.target.closest('.btn-preset[data-preset]');
        if (btn) applyPreset(btn.dataset.preset);
    });
    on($('btn-reset-theme'), 'click', resetTheme);
    on($('btn-clear-nick-color'), 'click', clearNickColor);
    on($('pref-own-nick-color'), 'change', onNickColourChange);
    on($('pref-other-nick-color'), 'change', onNickColourChange);
    on($('theme-sz'), 'input', () => onSzChange($('theme-sz')));
    on($('theme-font'), 'change', () => onFontChange($('theme-font')));

    on($('btn-add-alias'), 'click', () => addAliasRow('', ''));
    on($('btn-save-aliases'), 'click', saveAliases);

    const btnSaveHighlights = $('btn-save-highlights');
    if (btnSaveHighlights) btnSaveHighlights.addEventListener('click', saveHighlights);

    const prefRawConsole = $('pref-raw-console');
    if (prefRawConsole) prefRawConsole.addEventListener('change', function () { toggleRawConsole(this.checked); });
    const btnSaveAdvanced = $('btn-save-advanced');
    if (btnSaveAdvanced) btnSaveAdvanced.addEventListener('click', saveIdentity);

    const netlistBackdrop = $('netlist-backdrop');
    if (netlistBackdrop) netlistBackdrop.addEventListener('click', closeNetList);
    const netlistClose = $('netlist-close');
    if (netlistClose) netlistClose.addEventListener('click', closeNetList);
    const btnAddNetwork = $('btn-add-network');
    if (btnAddNetwork) btnAddNetwork.addEventListener('click', () => openNetModal(null));

    const netmodalBackdrop = $('netmodal-backdrop');
    if (netmodalBackdrop) netmodalBackdrop.addEventListener('click', closeNetModal);
    const netmodalClose = $('netmodal-close');
    if (netmodalClose) netmodalClose.addEventListener('click', closeNetModal);
    const nwSasl = $('nw-sasl');
    if (nwSasl) nwSasl.addEventListener('change', function () { toggleSaslFields(this); });
    const nwSaslMech = $('nw-sasl-mech');
    if (nwSaslMech) nwSaslMech.addEventListener('change', function () { _toggleSaslMechFields(this.value); });

    const certBtn = $('nw-sasl-cert-upload-btn');
    const certFile = $('nw-sasl-cert-file');
    const certInput = $('nw-sasl-cert');
    if (certBtn && certFile && certInput) {
        on(certBtn, 'click', () => certFile.click());
        on(certFile, 'change', () => handleCertUpload(certFile.files[0], certInput));
    }
    const keyBtn = $('nw-sasl-key-upload-btn');
    const keyFile = $('nw-sasl-key-file');
    const keyInput = $('nw-sasl-key');
    if (keyBtn && keyFile && keyInput) {
        on(keyBtn, 'click', () => keyFile.click());
        on(keyFile, 'change', () => handleCertUpload(keyFile.files[0], keyInput));
    }
    const nwDel = $('nw-del');
    if (nwDel) nwDel.addEventListener('click', deleteNetwork);
    const nwCancel = $('nw-cancel');
    if (nwCancel) nwCancel.addEventListener('click', closeNetModal);
    const nwSave = $('nw-save');
    if (nwSave) nwSave.addEventListener('click', saveNetwork);

    const ignoreAddBtn = $('ignore-add-btn');
    if (ignoreAddBtn) ignoreAddBtn.addEventListener('click', addIgnoreEntry);
    const ignoreAddInp = $('ignore-add-inp');
    if (ignoreAddInp) ignoreAddInp.addEventListener('keydown', e => { if (e.key === 'Enter') addIgnoreEntry(); });

    const prefSpellcheck = $('pref-spellcheck');
    if (prefSpellcheck) prefSpellcheck.addEventListener('change', function () {
        $('input').spellcheck = this.checked;
    });

    const prefAutoAway = $('pref-auto-away');
    if (prefAutoAway) prefAutoAway.addEventListener('change', function () {
        $('pref-auto-away-fields').classList.toggle('disabled', !this.checked);
    });
    const prefUploadMode = $('pref-upload-mode');
    if (prefUploadMode) prefUploadMode.addEventListener('change', toggleUploadFields);

    const logBackdrop = $('log-backdrop');
    if (logBackdrop) logBackdrop.addEventListener('click', closeLogViewer);
    const logClose = $('log-close');
    if (logClose) logClose.addEventListener('click', closeLogViewer);
    const logNetSel = $('log-net-sel');
    if (logNetSel) logNetSel.addEventListener('change', onLogNetChange);
    const logChanSel = $('log-chan-sel');
    if (logChanSel) logChanSel.addEventListener('change', onLogChanChange);
    const logSearchInput = $('log-search-input');
    if (logSearchInput) logSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchLogs(); });
    const logSearchBtn = $('log-search-btn');
    if (logSearchBtn) logSearchBtn.addEventListener('click', searchLogs);

    on($('log-date-filter-inp'), 'change', e => {
        const iso = e.target.value;
        if (!iso) return;
        const [y, mo, d] = iso.split('-');
        const logDate = `${d}-${mo}-${y}`;
        const items = [...document.querySelectorAll('#log-dates .log-date-item')];
        const match = items.find(x => x.querySelector('.ldi-sub')?.textContent === logDate);
        if (match) { match.click(); match.scrollIntoView({ block: 'nearest' }); }
    });

    on($('log-modal'), 'keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const items = [...document.querySelectorAll('#log-dates .log-date-item')];
        if (!items.length) return;
        const activeIdx = items.findIndex(x => x.classList.contains('active'));
        const next = Math.max(0, Math.min(items.length - 1, activeIdx + (e.key === 'ArrowDown' ? 1 : -1)));
        if (next !== activeIdx) { items[next].click(); items[next].scrollIntoView({ block: 'nearest' }); }
    });
    const logDownloadBtn = $('log-download-btn');
    if (logDownloadBtn) logDownloadBtn.addEventListener('click', downloadLogs);

    const listBackdrop = $('list-backdrop');
    if (listBackdrop) listBackdrop.addEventListener('click', closeListModal);
    const listClose = $('list-close');
    if (listClose) listClose.addEventListener('click', closeListModal);
    const listSearchInp = $('list-search-inp');
    if (listSearchInp) listSearchInp.addEventListener('input', e => filterListChannels(e.target.value));

    const pluginBackdrop = $('plugin-backdrop');
    if (pluginBackdrop) pluginBackdrop.addEventListener('click', closePluginManager);
    const pluginClose = $('plugin-close');
    if (pluginClose) pluginClose.addEventListener('click', closePluginManager);

    on($('btn-new-plugin'), 'click', () => newPlugin('python'));
    on($('btn-new-js-plugin'), 'click', () => newPlugin('js'));
    const pluginDelBtn = $('plugin-del-btn');
    if (pluginDelBtn) pluginDelBtn.addEventListener('click', deletePluginFromEditor);
    const btnSavePlugin = $('btn-save-plugin');
    if (btnSavePlugin) btnSavePlugin.addEventListener('click', savePlugin);
    const btnSaveLoadPlugin = $('btn-save-load-plugin');
    if (btnSaveLoadPlugin) btnSaveLoadPlugin.addEventListener('click', saveAndLoadPlugin);

    const chatBuf = $('chat-buffer');
    if (chatBuf) {
        chatBuf.addEventListener('click', e => {
            if (e.target.matches('img[data-expandable], video[data-expandable]'))
                e.target.classList.toggle('expanded');
        });

        chatBuf.addEventListener('error', e => {
            if (e.target.matches && e.target.matches('img[data-expandable]'))
                e.target.style.display = 'none';
        }, true);
    }
    const logLines = $('log-lines');
    if (logLines) {
        logLines.addEventListener('click', e => {
            if (e.target.matches('img[data-expandable], video[data-expandable]'))
                e.target.classList.toggle('expanded');
        });
        logLines.addEventListener('error', e => {
            if (e.target.matches && e.target.matches('img[data-expandable]'))
                e.target.style.display = 'none';
        }, true);
    }

    const uploadBtn = $('upload-btn');
    const fileInput = $('file-input');
    if (uploadBtn && fileInput) {
        on(uploadBtn, 'click', () => fileInput.click());
        on(fileInput, 'change', e => {
            if (e.target.files && e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
                e.target.value = '';
            }
        });
    }

    if (chatBuf) {
        on(chatBuf, 'dragover', e => e.preventDefault());
        on(chatBuf, 'drop', e => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    }
    const inputArea = $('input');
    if (inputArea) {
        on(inputArea, 'dragover', e => e.preventDefault());
        on(inputArea, 'drop', e => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    }
}

function handleFileUpload(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        alert('File size exceeds the 10MB limit.');
        return;
    }
    const formData = new FormData();
    formData.append('file', file);

    const inp = $('input');
    const origPlaceholder = inp.placeholder;
    inp.disabled = true;
    inp.placeholder = 'Uploading file...';

    const uploadInfo = getUploadRequestInfo();
    if (!uploadInfo) {
        inp.disabled = false;
        inp.placeholder = origPlaceholder;
        alert('Upload endpoint is not configured.');
        return;
    }

    fetch(uploadInfo.endpoint, {
        method: 'POST',
        body: formData
    })
    .then(res => {
        if (!res.ok) throw new Error('Upload failed');
        return res.json().then(data => ({ data, responseUrl: uploadInfo.responseBase }));
    })
    .then(({ data, responseUrl }) => {
        inp.disabled = false;
        inp.placeholder = origPlaceholder;
        const fullUrl = resolveUploadUrl(data, responseUrl);
        if (fullUrl) {
            if (inp.value) {
                inp.value += ' ' + fullUrl;
            } else {
                inp.value = fullUrl;
            }
            inp.focus();
        }
    })
    .catch(err => {
        console.error(err);
        inp.disabled = false;
        inp.placeholder = origPlaceholder;
        alert('Failed to upload file.');
    });
}

initEvents();

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.error('[ServiceWorker] Registration failed:', err);
    });
}