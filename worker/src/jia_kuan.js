// 家宽链式：MASQUE 前置 + VPN Gate 住宅 OpenVPN 落地
//
// 节点源是志愿者共享的家庭宽带（日本、韩国居多），出网是住宅 IP。
// 官方机房段丢掉。只保留 TCP（dialer-proxy 只能承载 TCP）。
//
// 缓存 30 分钟：节点掉线正常，拉太勤也没用。

import { mergeEndpointPairs, entryName as epName } from "./endpoints.js";

const VPNGATE_URLS = [
  "https://lucaslml0.github.io/gate/api.txt",
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
  const isV6 = ip.includes(":") && !ip.includes(".");
  const srv = (isV6 || /[a-zA-Z]/.test(ip)) ? `"${ip}"` : ip;
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

function ovpnDirective(text, name) {
  const re = new RegExp(`^[ \\t]*${name}[ \\t]+(.+?)[ \\t]*$`, "m");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function ovpnBlock(text, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function decodeOvpn(configB64, full = false) {
  const clean = configB64.replace(/\s/g, "");
  if (full || clean.length <= OVPN_HEAD_LEN) return b64decode(clean);
  return b64decode(clean.slice(0, OVPN_HEAD_LEN));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/plain" },
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return await res.text();
}

async function fetchJiaKuanNodes() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_MS) return _cache;

  let body = null, lastErr = null;
  for (const url of VPNGATE_URLS) {
    try {
      body = await fetchText(url);
      if (body && body.includes("OpenVPN_ConfigData_Base64")) break;
      lastErr = new Error(`${url} bad response`);
      body = null;
    } catch (e) {
      lastErr = e;
      body = null;
    }
  }
  if (!body) throw new Error("VPN Gate 节点源拉不到: " + (lastErr && lastErr.message));

  const candidates = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] === "*" || line[0] === "#") continue;
    const fields = line.split(",");
    if (fields.length < 15) continue;
    const hostname = fields[0] || "";
    const ip = fields[1] || "";
    if (hostname.startsWith(DC_HOSTNAME_PREFIX) || ip.startsWith(DC_IP_PREFIX)) continue;
    const configB64 = fields[fields.length - 1];
    if (!configB64 || configB64.length < 100) continue;
    let speed = 0;
    try { speed = parseInt(fields[4], 10) || 0; } catch { speed = 0; }
    candidates.push({ country: (fields[6] || "XX").toUpperCase(), speed, configB64 });
  }
  candidates.sort((a, b) => b.speed - a.speed);

  const nodes = [];
  let certs = null;
  for (const item of candidates) {
    let cfg;
    try {
      cfg = decodeOvpn(item.configB64);
      if (!ovpnDirective(cfg, "remote")) cfg = decodeOvpn(item.configB64, true);
    } catch { continue; }
    if ((ovpnDirective(cfg, "proto") || "tcp").toLowerCase() !== "tcp") continue;
    const remote = ovpnDirective(cfg, "remote").split(/\s+/);
    if (!remote[0]) continue;
    if (!certs) {
      try {
        const full = decodeOvpn(item.configB64, true);
        const ca = ovpnBlock(full, "ca");
        const cert = ovpnBlock(full, "cert");
        const key = ovpnBlock(full, "key");
        if (ca && cert && key) certs = { ca, cert, key };
      } catch { /* skip */ }
      if (!certs) continue;
    }
    let port = 443;
    try { if (remote[1]) port = parseInt(remote[1], 10) || 443; } catch { port = 443; }
    nodes.push({
      country: item.country,
      server: remote[0],
      port,
      cipher: ovpnDirective(cfg, "cipher") || "AES-128-CBC",
      auth: ovpnDirective(cfg, "auth") || "SHA1",
      speed: item.speed,
    });
    if (nodes.length >= MAX_LANDINGS) break;
  }
  if (!nodes.length || !certs) throw new Error("没解析出能用的家宽节点（需要 TCP + 完整证书）");

  _cache = { nodes, certs };
  _cacheAt = now;
  return _cache;
}

function q(s) { return JSON.stringify(String(s)); }

function indentCert(text, spaces) {
  return text.split("\n").map((ln) => {
    const t = ln.trim();
    return t ? spaces + t : "";
  }).filter(Boolean).join("\n");
}

/**
 * 生成家宽专属订阅 YAML。
 * @param {object} warp  usque 风格设备信息（privateKey / publicKey / ipv4 / ipv6）
 * @param {{list?: string[], mode?: string}} [custom] 远程提交的优选接入点
 * @returns {Promise<{ yaml: string, landings: number, entries: number }>}
 */
export async function buildJiaKuanConfig(warp, custom) {
  const { nodes, certs } = await fetchJiaKuanNodes();
  const priv = warp.privateKey;
  const pub = warp.peerPublicKey || warp.publicKey;
  const v4 = warp.ipv4;
  const v6 = warp.ipv6;

  const entries = [];
  const proxies = [];
  const pairs = mergeEndpointPairs(custom?.list || [], custom?.mode || "merge");
  const usedNames = new Set();
  for (const ep of pairs) {
    let n = ep.label || epName(ep.host, ep.port, ep.label);
    let base = n, i = 2;
    while (usedNames.has(n)) { n = `${base}-${i++}`; }
    usedNames.add(n);
    entries.push(n);
    const sni = ep.sni || (ep.kind === "domain" ? ep.host : null);
    proxies.push(masqueNode(n, ep.host, ep.port, priv, pub, v4, v6, sni));
  }

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
    .map((n, i) => [n, nodes[i]])
    .sort((a, b) => a[1].country.localeCompare(b[1].country));
  const countryOrder = byCountry.map((x) => x[0]);

  const list = (arr, n = 6) => arr.map((x) => " ".repeat(n) + "- " + q(x)).join("\n");
  const plain = (arr, n = 6) => arr.map((x) => " ".repeat(n) + "- " + x).join("\n");

  const yaml = `# 家宽链式 over Cloudflare WARP (MASQUE)
# 链路: 本机 -> MASQUE -> VPN Gate 住宅 OpenVPN -> 目标
# 前置 ${entries.length} 个 MASQUE；家宽落地 ${nodes.length} 个
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
${list(countryOrder)}

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
  - GEOIP,CN,🎯 全球直连
  - MATCH,🚀 节点选择
`;

  return { yaml, landings: nodes.length, entries: entries.length };
}
