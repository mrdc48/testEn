// Access the generated M3U playlist by visiting: <your-deployment-url>/playlist.m3u8

// ============ ⚙ CONFIGURATION ============
const config = {
    host: 'portal.elite4k.co', // ✅ Domain only, no http:// and no /c/
    mac_address: '00:1A:79:00:46:57',
    serial_number: 'E3E5E31855F36',
    device_id: 'E55198A8CF00D3547548BD5E3023FD7F66CE58E4D072BD028AA6E250434770F2',
    device_id_2: 'E55198A8CF00D3547548BD5E3023FD7F66CE58E4D072BD028AA6E250434770F2',
    stb_type: 'MAG250',
    api_signature: '263',
};

// Token cache (global, survives between requests while worker stays hot)
let cachedAuth = {
    token: '',
    profile: [],
    account_info: [],
    expiry: 0, // UNIX timestamp
};

// How often to refresh token (ms)
const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes

// ================== HELPERS ==================
async function hash(str) {
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('MD5', data);
    return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function generateHardwareVersions() {
    config.hw_version = '1.7-BD-' + (await hash(config.mac_address)).substring(0, 2).toUpperCase();
    config.hw_version_2 = await hash(config.serial_number.toLowerCase() + config.mac_address.toLowerCase());
}

function logDebug(message) {
    console.log(`${new Date().toISOString()} - ${message}`);
}

function getHeaders(token = '') {
    const headers = {
        'Cookie': `mac=${config.mac_address}; stb_lang=en; timezone=GMT`,
        'Referer': `http://${config.host}/stalker_portal/c/`,
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': `Model: ${config.stb_type}; Link: WiFi`
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

// ================== PORTAL FUNCTIONS ==================
async function getToken() {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
    const res = await fetch(url, { headers: getHeaders() });
    const text = await res.text();
    const data = safeJsonParse(text);
    return data.js?.token || '';
}

async function auth(token) {
    const metrics = { mac: config.mac_address, model: '', type: 'STB', uid: '', device: '', random: '' };
    const metricsEncoded = encodeURIComponent(JSON.stringify(metrics));
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=get_profile`
        + `&num_banks=2&sn=${config.serial_number}&stb_type=${config.stb_type}&client_type=STB`
        + `&device_id=${config.device_id}&device_id2=${config.device_id_2}`
        + `&hw_version=${config.hw_version}&hw_version_2=${config.hw_version_2}&metrics=${metricsEncoded}`
        + `&api_signature=${config.api_signature}&JsHttpRequest=1-xml`;

    const res = await fetch(url, { headers: getHeaders(token) });
    const text = await res.text();
    const data = safeJsonParse(text);
    return data.js || [];
}

async function handShake(token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
    const res = await fetch(url, { headers: getHeaders() });
    const text = await res.text();
    const data = safeJsonParse(text);
    return data.js?.token || '';
}

async function getAccountInfo(token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;
    const res = await fetch(url, { headers: getHeaders(token) });
    const text = await res.text();
    const data = safeJsonParse(text);
    return data.js || [];
}

async function getGenres(token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
    const res = await fetch(url, { headers: getHeaders(token) });
    const text = await res.text();
    const data = safeJsonParse(text);
    return data.js || [];
}

async function getStreamURL(id, token) {
    const url = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${id}&JsHttpRequest=1-xml`;
    const res = await fetch(url, { headers: getHeaders(token) });
    const text = await res.text();
    const data = safeJsonParse(text);

    let cmd = data.js?.cmd || '';
    cmd = cmd.replace(/^ffrt\s+/, ''); // remove only "ffrt "
    return cmd;
}

// ================== TOKEN MANAGEMENT ==================
async function refreshTokenIfNeeded() {
    const now = Date.now();

    if (cachedAuth.token && now < cachedAuth.expiry) {
        return cachedAuth;
    }

    logDebug("Refreshing token...");

    await generateHardwareVersions();
    const token = await getToken();
    if (!token) return { token: '', profile: [], account_info: [], expiry: 0 };

    const profile = await auth(token);
    const newToken = await handShake(token);
    if (!newToken) return { token: '', profile, account_info: [], expiry: 0 };

    const account_info = await getAccountInfo(newToken);

    cachedAuth = {
        token: newToken,
        profile,
        account_info,
        expiry: now + TOKEN_REFRESH_INTERVAL, // next refresh
    };

    return cachedAuth;
}

// ================== M3U CONVERSION ==================
async function convertJsonToM3U(channels, profile, account_info) {
    let m3u = ['#EXTM3U', `# Total Channels => ${channels.length}`, '# Script => @tg_aadi', ''];

    for (let c of channels) {
        if (!c.cmd) continue;
        const realCmd = c.cmd.replace(/^ffrt\s+/, '');
        const streamUrl = realCmd.endsWith('.m3u8') ? realCmd : `${realCmd}.m3u8`;

        m3u.push(`#EXTINF:-1 tvg-id="${c.tvgid}" tvg-logo="${c.logo}" group-title="${c.title}",${c.name}`);
        m3u.push(streamUrl);
    }

    return m3u.join('\n');
}

// ================== WORKER HANDLER ==================
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const lastPart = url.pathname.split('/').pop();

    try {
        const { token, profile, account_info } = await refreshTokenIfNeeded();
        if (!token) return new Response('Token generation failed', { status: 500 });

        if (url.pathname === '/playlist.m3u8') {
            const channelsUrl = `http://${config.host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
            const res = await fetch(channelsUrl, { headers: getHeaders(token) });
            const text = await res.text();
            const channelsData = safeJsonParse(text);

            const genres = await getGenres(token);
            let channels = [];
            if (channelsData.js?.data) {
                channels = channelsData.js.data.map(item => ({
                    name: item.name || 'Unknown',
                    cmd: item.cmd || '',
                    tvgid: item.xmltv_id || '',
                    id: item.tv_genre_id || '',
                    logo: item.logo || ''
                }));
            }

            const groupTitleMap = {};
            genres.forEach(g => { groupTitleMap[g.id] = g.title || 'Other'; });
            channels = channels.map(c => ({ ...c, title: groupTitleMap[c.id] || 'Other' }));

            const m3uContent = await convertJsonToM3U(channels, profile, account_info);
            return new Response(m3uContent, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
        }

        if (lastPart.endsWith('.m3u8') && lastPart !== 'playlist.m3u8') {
            const id = lastPart.replace(/\.m3u8$/, '');
            const stream = await getStreamURL(id, token);
            if (!stream) return new Response('No stream URL received', { status: 500 });

            return Response.redirect(stream, 302);
        }

        return new Response('Not Found', { status: 404 });
    } catch (e) {
        return new Response(`Internal Server Error: ${e.message}`, { status: 500 });
    }
}
