// 家宽链式：MASQUE 前置 + VPN Gate 住宅 OpenVPN 落地
//
// 节点源是志愿者共享的家庭宽带（日本、韩国居多），出网是住宅 IP。
// 官方机房段丢掉。只保留 TCP（dialer-proxy 只能承载 TCP）。
//
// 缓存 30 分钟：节点掉线正常，拉太勤也没用。

const V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"];
const V6 = ["2606:4700:103::1", "2606:4700:103::2",
            "2606:4700:104::1", "2606:4700:104::2"];
const PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095];
const OFFICIAL_SNI = "zt-masque.cloudflareclient.com";
const SNI_NODE = ["162.159.198.1", 443];

const VPNGATE_URLS = [
  "https://www.vpngate.net/api/iphone/",
  "http://www.vpngate.net/api/iphone/",
];
const DC_HOSTNAME_PREFIX = "public-vpn";
const DC_IP_PREFIX = "219.100.37.";
const OVPN_HEAD_LEN = 6000;
const MAX_LANDINGS = 40;
const CACHE_MS = 30 * 60 * 1000;

let _cache = null;
let _cacheAt = 0;

function entryName(ip, port) {
  if (ip.includes(":")) {
    const seg = ip.split(":")[2];
    const tail = ip.split(":").pop();
    return `v6-${seg}-${tail}-${port}`;
  }
  return `${ip.split(".").slice(2).join(".")}-${port}`;
}

function masqueNode(name, ip, port, priv, pub, v4, v6, sni) {
  const srv = ip.includes(":") ? `"${ip}"` : ip;
  const extra = sni ? `\n    sni: ${sni}` : "";
  return `  - name: ${name}
    type: masque
    server: ${srv}
    port: ${port}${extra}
    private-key: ${priv}
    public-key: ${pub}
    ip: ${v4}
    ipv6: ${v6}
    mtu: 1280
    udp: true
    remote-dns-resolve: true
    dns: [1.1.1.1, 2606:4700:4700::1111]`;
}

function b64decode(s) {
  const clean = s.replace(/\s/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function directive(text, name) {
  const m = text.match(new RegExp("^[ \\t]*" + name + "[ \\t]+(.+?)[ \\t]*$", "m"));
  return m ? m[1].trim() : "";
}

function block(text, tag) {
  const m = text.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1].trim() : "";
}

function decodeOvpn(configB64, full = false) {
  const clean = configB64.replace(/\s/g, "");
  if (full || clean.length <= OVPN_HEAD_LEN) return b64decode(clean);
  return b64decode(clean.slice(0, OVPN_HEAD_LEN));
}

function indentCert(text, spaces) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => spaces + l).join("\n");
}

function q(s) {
  return JSON.stringify(String(s == null ? "" : s));
}

/** 拉 VPN Gate 清单并解析出住宅 TCP 节点 + 共用证书。 */
export async function fetchJiaKuanNodes() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_MS) return _cache;

  let text = "";
  let lastErr = null;
  for (const url of VPNGATE_URLS) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain" },
        cf: { cacheTtl: 1800, cacheEverything: true },
      });
      if (!resp.ok) {
        lastErr = new Error("节点源返回 " + resp.status);
        continue;
      }
      text = await resp.text();
      if (text && text.includes("OpenVPN_ConfigData_Base64")) break;
      lastErr = new Error("节点源内容异常");
      text = "";
    } catch (e) {
      lastErr = e;
    }
  }
  if (!text) throw lastErr || new Error("节点源没有返回内容");

  const candidates = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] === "*" || line[0] === "#") continue;
    const fields = line.split(",");
    if (fields.length < 15) continue;
    const hostname = fields[0] || "";
    const ip = fields[1] || "";
    if (hostname.startsWith(DC_HOSTNAME_PREFIX)) continue;
    if (ip.startsWith(DC_IP_PREFIX)) continue;
    const configB64 = fields[fields.length - 1];
    if (!configB64 || configB64.length < 100) continue;
    candidates.push({
      country: (fields[6] || "XX").toUpperCase(),
      speed: parseInt(fields[4], 10) || 0,
      configB64,
    });
  }
  candidates.sort((a, b) => b.speed - a.speed);

  const nodes = [];
  let certs = null;
  for (const item of candidates) {
    let cfg = "";
    try {
      cfg = decodeOvpn(item.configB64);
      if (!directive(cfg, "remote")) cfg = decodeOvpn(item.configB64, true);
    } catch {
      continue;
    }
    if ((directive(cfg, "proto") || "tcp").toLowerCase() !== "tcp") continue;
    const remote = directive(cfg, "remote").split(/\s+/);
    if (!remote[0]) continue;

    if (!certs) {
      try {
        const full = decodeOvpn(item.configB64, true);
        const ca = block(full, "ca");
        const cert = block(full, "cert");
        const key = block(full, "key");
        if (ca && cert && key) certs = { ca, cert, key };
      } catch { /* skip */ }
      if (!certs) continue;
    }

    nodes.push({
      country: item.country,
      server: remote[0],
      port: parseInt(remote[1], 10) || 443,
      cipher: directive(cfg, "cipher") || "AES-128-CBC",
      auth: directive(cfg, "auth") || "SHA1",
      speed: item.speed,
    });
    if (nodes.length >= MAX_LANDINGS) break;
  }

  if (!nodes.length || !certs) {
    throw new Error("没解析出能用的家宽节点（需要 TCP + 完整证书）");
  }

  _cache = { nodes, certs };
  _cacheAt = now;
  return _cache;
}

/**
 * 生成家宽专属订阅 YAML。
 * @param {object} warp  usque 风格设备信息（privateKey / peerPublicKey / ipv4 / ipv6）
 * @returns {Promise<{ yaml: string, landings: number, entries: number }>}
 */
export async function buildJiaKuanConfig(warp) {
  const { nodes, certs } = await fetchJiaKuanNodes();
  const priv = warp.privateKey;
  const pub = warp.peerPublicKey || warp.publicKey;
  const v4 = warp.ipv4;
  const v6 = warp.ipv6;

  const entries = [];
  const proxies = [];
  for (const ip of [...V4, ...V6]) {
    for (const port of PORTS) {
      const n = entryName(ip, port);
      entries.push(n);
      proxies.push(masqueNode(n, ip, port, priv, pub, v4, v6, null));
    }
  }
  entries.push("官方域名");
  proxies.push(masqueNode("官方域名", SNI_NODE[0], SNI_NODE[1], priv, pub, v4, v6, OFFICIAL_SNI));

  const frontGroup = "⚡ MASQUE前置";
  const countryCount = {};
  const landingNames = [];
  nodes.forEach((node, i) => {
    countryCount[node.country] = (countryCount[node.country] || 0) + 1;
    const name = `🏠 ${node.country}-家宽-${String(countryCount[node.country]).padStart(2, "0")}`;
    landingNames.push(name);
    const lines = [
      `  - name: ${q(name)}`,
      "    type: openvpn",
      `    server: ${node.server}`,
      `    port: ${node.port}`,
      "    proto: tcp",
      "    username: vpn",
      "    password: vpn",
      `    cipher: ${node.cipher}`,
      `    auth: ${node.auth}`,
      "    udp: false",
      "    handshake-timeout: 30",
      "    remote-dns-resolve: true",
      "    dns: [8.8.8.8, 1.1.1.1]",
      `    dialer-proxy: ${q(frontGroup)}`,
    ];
    if (i === 0) {
      lines.push("    ca: &jkca |-", indentCert(certs.ca, "      "));
      lines.push("    cert: &jkcert |-", indentCert(certs.cert, "      "));
      lines.push("    key: &jkkey |-", indentCert(certs.key, "      "));
    } else {
      lines.push("    ca: *jkca", "    cert: *jkcert", "    key: *jkkey");
    }
    proxies.push(lines.join("\n"));
  });

  const byCountry = landingNames
    .map((n, i) => ({ n, c: nodes[i].country }))
    .sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0))
    .map((x) => x.n);

  const list = (arr, indent = 6) =>
    arr.map((x) => " ".repeat(indent) + `- ${q(x)}`).join("\n");
  const plain = (arr, indent = 6) =>
    arr.map((x) => " ".repeat(indent) + `- ${x}`).join("\n");

  const yaml = `# 家宽链式 over Cloudflare WARP (MASQUE)
# 链路: 本机 -> MASQUE 前置 -> VPN Gate 住宅 OpenVPN -> 目标
# 前置 ${entries.length} 个；家宽落地 ${nodes.length} 个
# 节点是网友共享的，掉线正常。「🏠 家宽自动」会按速度往下换。
# 需要 mihomo（openvpn + dialer-proxy）

mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: true
unified-delay: true
tcp-concurrent: true
external-controller: 127.0.0.1:9090

dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://1.1.1.1/dns-query

proxies:
${proxies.join("\n")}

proxy-groups:
  - name: ${q(frontGroup)}
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
${plain(entries)}

  - name: "🏠 家宽自动"
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 1800
    lazy: true
    proxies:
${list(landingNames)}

  - name: "🏠 家宽节点"
    type: select
    proxies:
${list(byCountry)}

  - name: 🚀 节点选择
    type: select
    proxies:
      - "🏠 家宽自动"
      - "🏠 家宽节点"
      - ${q(frontGroup)}
      - DIRECT

  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择

rules:
  - GEOIP,LAN,🎯 全球直连,no-resolve
  - GEOIP,CN,🎯 全球直连,no-resolve
  - MATCH,🚀 节点选择
`;

  return { yaml, landings: nodes.length, entries: entries.length };
}
