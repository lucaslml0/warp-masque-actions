// 默认接入点 + 远程提交的优选 IP/域名解析。
// 来源参考 usque-custom-pro：IPv4/IPv6 段 + bestcf 域名。

export const V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"];
export const V6 = [
  "2606:4700:103::1", "2606:4700:103::2",
  "2606:4700:104::1", "2606:4700:104::2",
];
export const PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095];

// CF 没有 A 记录指向 MASQUE 段，官方域名只能用在 SNI 上
export const OFFICIAL_SNI = "zt-masque.cloudflareclient.com";
export const SNI_NODE = ["162.159.198.1", 443];

// usque-custom-pro 里的优选域名（可能指向更优 Anycast）
export const DEFAULT_DOMAINS = [
  ["masque.bestcf.eu.cc", 443],
  ["masque1.bestcf.eu.cc", 443],
  ["masque2.bestcf.eu.cc", 500],
];

const MAX_CUSTOM = 200;

/** 解析一行：ip:port / [ipv6]:port / domain:port / 纯 host（默认 443） */
export function parseEndpointLine(raw) {
  let s = String(raw || "").trim();
  if (!s || s.startsWith("#")) return null;
  // 去掉注释尾
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash).trim();
  if (!s) return null;

  let host = "", port = 443;

  if (s.startsWith("[")) {
    const m = s.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);
    if (!m) return null;
    host = m[1];
    port = m[2] ? Number(m[2]) : 443;
  } else if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s)) {
    const parts = s.split(":");
    host = parts[0];
    port = parts[1] ? Number(parts[1]) : 443;
  } else if (s.includes(":") && s.split(":").length === 2 && !/^[0-9a-fA-F:]+$/.test(s.split(":")[0])) {
    // domain:port
    const i = s.lastIndexOf(":");
    host = s.slice(0, i);
    port = Number(s.slice(i + 1));
  } else if (/^[0-9a-fA-F:]+$/.test(s) && s.includes("::")) {
    // bare ipv6, default port
    host = s;
    port = 443;
  } else {
    // bare domain or hostname
    host = s;
    port = 443;
  }

  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null;
  const isIp4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIp6 = host.includes(":") && !host.includes(".");
  const kind = isIp4 || isIp6 ? "ip" : "domain";
  return { host, port, kind };
}

/** @param {string[]|object[]} list */
export function normalizeEndpoints(list, { max = MAX_CUSTOM } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    let ep = null;
    if (typeof item === "string") ep = parseEndpointLine(item);
    else if (item && typeof item === "object") {
      const host = item.host || item.server || item.ip || "";
      const port = item.port != null ? Number(item.port) : 443;
      ep = parseEndpointLine(host.includes(":") && !host.includes(".") ? `[${host}]:${port}` : `${host}:${port}`);
    }
    if (!ep) continue;
    const key = `${ep.host.toLowerCase()}|${ep.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
    if (out.length >= max) break;
  }
  return out;
}

/** 默认内置：全端口 IPv4/IPv6 + 官方 SNI + bestcf 域名 */
export function builtinPairs() {
  const pairs = [];
  for (const ip of [...V4, ...V6]) {
    for (const port of PORTS) pairs.push({ host: ip, port, kind: "ip" });
  }
  pairs.push({ host: SNI_NODE[0], port: SNI_NODE[1], kind: "ip", sni: OFFICIAL_SNI, label: "官方域名" });
  for (const [host, port] of DEFAULT_DOMAINS) {
    pairs.push({ host, port, kind: "domain", sni: host });
  }
  return pairs;
}

export function entryName(host, port, label) {
  if (label) return label;
  if (host.includes(":") && !host.includes(".")) {
    const parts = host.split(":");
    const seg = parts[2] || "v6";
    const tail = parts[parts.length - 1] || "0";
    return `v6-${seg}-${tail}-${port}`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `${host.split(".").slice(2).join(".")}-${port}`;
  }
  // domain
  const short = host.replace(/^masque\.?/, "").replace(/\./g, "-");
  return `${short}-${port}`;
}

/**
 * 合并内置 + 自定义。
 * mode: "merge"（默认，内置+自定义）| "prefer"（自定义在前再内置）| "only"（仅自定义，若为空回退内置）
 */
export function mergeEndpointPairs(customList, mode = "merge") {
  const custom = normalizeEndpoints(customList);
  const builtin = builtinPairs();
  if (mode === "only" && custom.length) return custom;
  if (mode === "prefer") {
    const seen = new Set(custom.map((e) => `${e.host.toLowerCase()}|${e.port}`));
    const rest = builtin.filter((e) => !seen.has(`${e.host.toLowerCase()}|${e.port}`));
    return [...custom, ...rest];
  }
  // merge: builtin first, then custom extras
  const seen = new Set(builtin.map((e) => `${e.host.toLowerCase()}|${e.port}`));
  const extra = custom.filter((e) => !seen.has(`${e.host.toLowerCase()}|${e.port}`));
  return [...builtin, ...extra];
}
