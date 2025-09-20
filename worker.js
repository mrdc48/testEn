// Access the generated M3U playlist by visiting: <your-deployment-url>/playlist.m3u8

// ============ ⚙ CONFIGURATION ============
const config = {
    host: 'portal.elite4k.co', // Replace with your Stalker-Portal host
    mac_address: '00:1A:79:00:46:57', // Replace with your MAC address
    serial_number: 'E3E5E31855F36', // Replace with your serial number
    device_id: 'E55198A8CF00D3547548BD5E3023FD7F66CE58E4D072BD028AA6E250434770F2',
    device_id_2: 'E55198A8CF00D3547548BD5E3023FD7F66CE58E4D072BD028AA6E250434770F2',
    stb_type: 'MAG250',
    api_signature: '263'
};

// Auto-generate hw_version & hw_version_2
async function generateHardwareVersions() {
    config.hw_version = '1.7-BD-' + (await hash(config.mac_address)).substring(0, 2).toUpperCase();
    config.hw_version_2 = await hash(config.serial_number.toLowerCase() + config.mac_address.toLowerCase());
}

async function hash(str) {
    const data = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('MD5', data);
    return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}

function logDebug(message) {
    console.log(`${new Date().toISOString()} - ${message}`);
}

function getHeaders(token = '') {
    const headers = {
        'Cookie': `mac=${config.mac_address}; stb_lang=en; timezone=GMT`,
        'Referer': `${config.host}`,
        'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
        'X-User-Agent': `Model: ${config.stb_type}; Link: WiFi`
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// ============ SAFE JSON PARSER ============
function safeJsonParse(text, context = '') {
    try {
        return JSON.parse(text);
    } catch (e) {
        logDebug(`❌ Failed to parse JSON in ${context}: ${text.substring(0, 200)}`);
        return null;
    }
}

// ============ API CALLS ============
async function getToken() {
    const url = `${config.host}server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
    try {
        const response = await fetch(url, { headers: getHeaders() });
        const text = await response.text();
        const data = safeJsonParse(text, 'getToken');
        return data?.js?.token || '';
    } catch (e) {
        logDebug(`Error in getToken: ${e.message}`);
        return '';
    }
}

async function auth(token) {
    const metrics = { mac: config.mac_address, model: '', type: 'STB', uid: '', device: '', random: '' };
    const metricsEncoded = encodeURIComponent(JSON.stringify(metrics));

    const url = `${config.host}server/load.php?type=stb&action=get_profile`
        + `&hd=1&ver=ImageDescription:0.2.18-r14-pub-250;PORTAL version:5.5.0;API Version:328;`
        + `&num_banks=2&sn=${config.serial_number}`
        + `&stb_type=${config.stb_type}&client_type=STB&image_version=218&video_out=hdmi`
        + `&device_id=${config.device_id}&device_id2=${config.device_id_2}`
        + `&signature=&auth_second_step=1&hw_version=${config.hw_version}`
        + `&not_valid_token=0&metrics=${metricsEncoded}`
        + `&hw_version_2=${config.hw_version_2}&api_signature=${config.api_signature}`
        + `&prehash=&JsHttpRequest=1-xml`;

    try {
        const response = await fetch(url, { headers: getHeaders(token) });
        const text = await response.text();
        const data = safeJsonParse(text, 'auth');
        return data?.js || [];
    } catch (e) {
        logDebug(`Error in auth: ${e.message}`);
        return [];
    }
}

async function handShake(token) {
    const url = `${config.host}server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
    try {
        const response = await fetch(url, { headers: getHeaders() });
        const text = await response.text();
        const data = safeJsonParse(text, 'handShake');
        return data?.js?.token || '';
    } catch (e) {
        logDebug(`Error in handShake: ${e.message}`);
        return '';
    }
}

async function getAccountInfo(token) {
    const url = `${config.host}server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`;
    try {
        const response = await fetch(url, { headers: getHeaders(token) });
        const text = await response.text();
        const data = safeJsonParse(text, 'getAccountInfo');
        return data?.js || [];
    } catch (e) {
        logDebug(`Error in getAccountInfo: ${e.message}`);
        return [];
    }
}

async function getGenres(token) {
    const url = `${config.host}server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
    try {
        const response = await fetch(url, { headers: getHeaders(token) });
        const text = await response.text();
        const data = safeJsonParse(text, 'getGenres');
        return data?.js || [];
    } catch (e) {
        logDebug(`Error in getGenres: ${e.message}`);
        return [];
    }
}

async function getStreamURL(id, token) {
    const url = `${config.host}server/load.php?type=itv&action=create_link&cmd=ffrt%20http://localhost/ch/${id}&JsHttpRequest=1-xml`;
    try {
        const response = await fetch(url, { headers: getHeaders(token) });
        const text = await response.text();
        const data = safeJsonParse(text, 'getStreamURL');
        return data?.js?.cmd || '';
    } catch (e) {
        logDebug(`Error in getStreamURL: ${e.message}`);
        return '';
    }
}

// ============ TOKEN + ACCOUNT FLOW ============
async function genToken() {
    await generateHardwareVersions();
    const token = await getToken();
    if (!token) return { token: '', profile: [], account_info: [] };

    const profile = await auth(token);
    const newToken = await handShake(token);
    if (!newToken) return { token: '', profile, account_info: [] };

    const account_info = await getAccountInfo(newToken);
    return { token: newToken, profile, account_info };
}

// ============ M3U CONVERSION (unchanged) ============
async function convertJsonToM3U(channels, profile, account_info, request) {
    let m3u = [
        '#EXTM3U',
        `# Total Channels => ${channels.length}`,
        '# Script => @tg_aadi',
        ''
    ];

    // Info entries...
    let server_ip = profile.ip || 'Unknown';
    m3u.push(`#EXTINF:-1,IP • ${server_ip}`);
    m3u.push('https://tg-aadi.vercel.app/intro.m3u8');

    let user_ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    m3u.push(`#EXTINF:-1,User IP • ${user_ip}`);
    m3u.push('https://tg-aadi.vercel.app/intro.m3u8');

    // Add channels
    const origin = new URL(request.url).origin;
    channels.forEach(channel => {
        let cmd = channel.cmd || '';
        let real_cmd = cmd.replace('ffrt http://localhost/ch/', '') || 'unknown';
        const logo_url = channel.logo ? `${config.host}misc/logos/320/${channel.logo}` : '';
        m3u.push(`#EXTINF:-1 tvg-name="${channel.name}" tvg-logo="${logo_url}" group-title="${channel.title}",${channel.name}`);
        m3u.push(`${origin}/${real_cmd}.m3u8`);
    });

    return m3u.join('\n');
}

// ============ MAIN HANDLER ============
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const lastPart = url.pathname.split('/').pop();

    const { token, profile, account_info } = await genToken();
    if (!token) return new Response('Token generation failed', { status: 500 });

    if (url.pathname === '/playlist.m3u8') {
        const channelsUrl = `${config.host}server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
        try {
            const response = await fetch(channelsUrl, { headers: getHeaders(token) });
            const text = await response.text();
            const channelsData = safeJsonParse(text, 'get_all_channels');
            if (!channelsData?.js?.data) return new Response('No channels found', { status: 500 });

            const genres = await getGenres(token);
            const groupTitleMap = {};
            genres.forEach(g => groupTitleMap[g.id] = g.title || 'Other');

            const channels = channelsData.js.data.map(item => ({
                name: item.name || 'Unknown',
                cmd: item.cmd || '',
                tvgid: item.xmltv_id || '',
                id: item.tv_genre_id || '',
                logo: item.logo || '',
                title: groupTitleMap[item.tv_genre_id] || 'Other'
            }));

            const m3uContent = await convertJsonToM3U(channels, profile, account_info, request);
            return new Response(m3uContent, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
        } catch (e) {
            return new Response(`Error fetching channels: ${e.message}`, { status: 500 });
        }
    }

    if (lastPart.endsWith('.m3u8') && lastPart !== 'playlist.m3u8') {
        const id = lastPart.replace(/\.m3u8$/, '');
        const stream = await getStreamURL(id, token);
        return stream ? Response.redirect(stream, 302) : new Response('No stream URL received', { status: 500 });
    }

    return new Response('Not Found', { status: 404 });
}
