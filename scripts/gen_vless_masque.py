#!/usr/bin/env python3
"""Generate VLESS-over-WARP-MASQUE mihomo config from a VLESS URI list.

Chain: client -> WARP MASQUE -> VLESS landing -> destination.
Usage: gen_vless_masque.py <usque-config.json> <vless-list-url> <output-dir>
"""
import base64
import json
import os
import re
import sys
import urllib.parse
import urllib.request

V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"]
V6 = ["2606:4700:103::1", "2606:4700:103::2", "2606:4700:104::1", "2606:4700:104::2"]
PORTS = (443, 500, 1701, 4500, 4443, 8443, 8095)
OFFICIAL_SNI = "zt-masque.cloudflareclient.com"
SOURCE_URL = "https://lucaslml0.github.io/gate/jiedian.txt"


def pem_to_b64der(value):
    return "".join(line.strip() for line in value.strip().splitlines()
                   if line.strip() and not line.startswith("-----"))


def quote(value):
    return json.dumps(str(value), ensure_ascii=False)


def fetch_text(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; warp-masque-actions/1.0)",
        "Accept": "text/plain,*/*",
    })
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def decode_source(body):
    # Supports plain URI lists and a Base64-encoded subscription body.
    if "vless://" not in body and not re.search(r"^[A-Za-z0-9+/=\r\n]+$", body.strip()):
        return body
    if "vless://" not in body:
        try:
            decoded = base64.b64decode(re.sub(r"\s+", "", body)).decode("utf-8", errors="replace")
            if "vless://" in decoded:
                return decoded
        except Exception:
            pass
    return body


def parse_vless(uri, index):
    uri = uri.strip()
    if not uri.lower().startswith("vless://"):
        return None
    try:
        parts = urllib.parse.urlsplit(uri)
        uuid = urllib.parse.unquote(parts.username or "")
        host = parts.hostname
        port = parts.port
        if not uuid or not host or not port:
            return None
        q = urllib.parse.parse_qs(parts.query, keep_blank_values=True)
        get = lambda *keys, default="": next(
            (q[k][0] for k in keys if q.get(k) and q[k][0] != ""), default
        )
        security = get("security", default="none").lower()
        network = get("type", "network", default="tcp").lower()
        label = urllib.parse.unquote(parts.fragment).strip() or f"VLESS-{index:02d}"
        label = label.replace(chr(13), " ").replace(chr(10), " ").replace(chr(9), " ")[:80]
        node = {
            "name": label, "type": "vless", "server": host, "port": port,
            "uuid": uuid, "network": network, "udp": True,
        }
        flow = get("flow")
        if flow:
            node["flow"] = flow
        if security in ("tls", "reality"):
            node["tls"] = True
            sni = get("sni", "servername", "serverName")
            if sni:
                node["servername"] = sni
            fp = get("fp", "client-fingerprint")
            if fp:
                node["client-fingerprint"] = fp
            alpn = get("alpn")
            if alpn:
                node["alpn"] = [x for x in alpn.split(",") if x]
        if security == "reality":
            pbk = get("pbk", "public-key")
            sid = get("sid", "short-id")
            if not pbk:
                return None
            node["reality-opts"] = {"public-key": pbk, **({"short-id": sid} if sid else {})}
        elif security not in ("none", "tls", ""):
            # Unsupported transport security is safer to skip than to silently misconfigure.
            return None
        if network == "ws":
            path = get("path", default="/")
            headers = {}
            host_header = get("host")
            if host_header:
                headers["Host"] = host_header
            node["ws-opts"] = {"path": path or "/", **({"headers": headers} if headers else {})}
        elif network == "grpc":
            service = get("serviceName", "service-name", "path")
            node["grpc-opts"] = {"grpc-service-name": service} if service else {}
        elif network in ("tcp", "httpupgrade", "xhttp"):
            if network == "httpupgrade":
                path = get("path", default="/")
                node["http-upgrade-opts"] = {"path": path or "/"}
                host_header = get("host")
                if host_header:
                    node["http-upgrade-opts"]["headers"] = {"Host": host_header}
            elif network == "xhttp":
                path = get("path", default="/")
                node["xhttp-opts"] = {"path": path or "/"}
        else:
            return None
        return node
    except (ValueError, UnicodeError):
        return None


def masque_node(name, server, port, priv, pub, v4, v6, sni=None):
    node = {
        "name": name, "type": "masque", "server": server, "port": port,
        "private-key": priv, "public-key": pub, "ip": v4, "ipv6": v6,
        "mtu": 1280, "udp": True, "remote-dns-resolve": True,
        "dns": ["1.1.1.1", "2606:4700:4700::1111"],
    }
    if ":" in server:
        node["server"] = server
    if sni:
        node["sni"] = sni
    return node


def build(cfg, landings):
    priv = cfg["private_key"].strip()
    if priv.startswith("-----"):
        priv = pem_to_b64der(priv)
    pub = pem_to_b64der(cfg["endpoint_pub_key"])
    v4, v6 = cfg["ipv4"], cfg["ipv6"]
    front = []
    for ip in V4 + V6:
        for port in PORTS:
            label = f"v6-{ip.split(':')[2]}-{ip.rsplit(':', 1)[-1]}-{port}" if ":" in ip else f"{'.'.join(ip.split('.')[2:])}-{port}"
            front.append(masque_node(label, ip, port, priv, pub, v4, v6))
    front.append(masque_node("官方域名", "162.159.198.1", 443, priv, pub, v4, v6, OFFICIAL_SNI))

    # One VLESS proxy per landing x MASQUE endpoint, each pinned to one front hop.
    # Source subscriptions commonly contain duplicate display names (e.g. "United").
    # Make landing labels unique before deriving proxy and proxy-group names.
    proxies = list(front)
    groups_by_landing = {}
    label_counts = {}
    used_group_names = set()
    for idx, landing in enumerate(landings, 1):
        base_label = landing["name"]
        base_label = base_label.replace(chr(13), " ").replace(chr(10), " ").replace(chr(9), " ")
        base_label = base_label.strip()[:64] or f"VLESS-{idx:02d}"
        label_counts[base_label] = label_counts.get(base_label, 0) + 1
        suffix = label_counts[base_label]
        safe_label = base_label if suffix == 1 else f"{base_label} [{suffix}]"
        group_name = f"{safe_label}线路"
        while group_name in used_group_names:
            suffix += 1
            safe_label = f"{base_label} [{suffix}]"
            group_name = f"{safe_label}线路"
        used_group_names.add(group_name)
        combo_names = []
        for front_node in front:
            combo_name = f"{safe_label}@{front_node['name']}"
            combo_names.append(combo_name)
            node = dict(landing)
            node["name"] = combo_name
            node["dialer-proxy"] = front_node["name"]
            proxies.append(node)
        groups_by_landing[safe_label] = combo_names

    def group(name, kind, names, **kwargs):
        return {"name": name, "type": kind, "proxies": names, **kwargs}

    proxy_groups = [
        group("🚀 节点选择", "select", ["♻️ 自动选择", "🔄 故障转移", *[f"{k}线路" for k in groups_by_landing]]),
        group("♻️ 自动选择", "url-test", [f"{k}线路" for k in groups_by_landing],
              url="https://www.gstatic.com/generate_204", interval=300, tolerance=80, lazy=True),
        group("🔄 故障转移", "fallback", [f"{k}线路" for k in groups_by_landing],
              url="https://www.gstatic.com/generate_204", interval=180, lazy=True),
    ]
    for label, names in groups_by_landing.items():
        proxy_groups.append(group(f"{label}线路", "url-test", names,
                                  url="https://www.gstatic.com/generate_204", interval=300,
                                  tolerance=80, lazy=True))
    proxy_groups.extend([
        group("🎯 全球直连", "select", ["DIRECT", "🚀 节点选择"]),
        group("🛑 全球拦截", "select", ["REJECT", "DIRECT"]),
        group("🐟 漏网之鱼", "select", ["🚀 节点选择", "🎯 全球直连", "♻️ 自动选择"]),
    ])
    config = {
        "mixed-port": 7890, "allow-lan": False, "mode": "rule",
        "log-level": "info", "ipv6": True, "unified-delay": True,
        "tcp-concurrent": True, "find-process-mode": "off",
        "external-controller": "127.0.0.1:9090",
        "dns": {"enable": True, "enhanced-mode": "fake-ip", "fake-ip-range": "198.18.0.1/16",
                "nameserver": ["https://dns.alidns.com/dns-query", "https://1.1.1.1/dns-query"]},
        "proxies": proxies, "proxy-groups": proxy_groups,
        "rules": ["GEOIP,LAN,DIRECT,no-resolve", "GEOIP,CN,DIRECT", "MATCH,🐟 漏网之鱼"],
    }
    return config, len(front), len(landings), len(proxies) - len(front)


def main():
    if len(sys.argv) < 4:
        print("用法: gen_vless_masque.py <usque-config.json> <vless-list-url> <输出目录>", file=sys.stderr)
        sys.exit(2)
    cfg_path, source_url, outdir = sys.argv[1:4]
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    print(f"读取 VLESS 节点源: {source_url}", flush=True)
    body = decode_source(fetch_text(source_url))
    landings = []
    for line in body.splitlines():
        parsed = parse_vless(line, len(landings) + 1)
        if parsed:
            landings.append(parsed)
    # Deduplicate by endpoint and UUID while preserving source order.
    unique = {}
    for node in landings:
        unique[(node["server"], node["port"], node["uuid"])] = node
    landings = list(unique.values())
    if not landings:
        raise SystemExit("未从节点源解析到有效的 vless:// URI；请检查 jiedian.txt 格式或源站状态。")
    config, n_front, n_land, n_combo = build(cfg, landings)
    try:
        import yaml
    except ImportError:
        raise SystemExit("缺少 PyYAML，请先运行: pip install pyyaml")
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "vless-masque.yaml")
    with open(path, "w", encoding="utf-8") as f:
        f.write("# VLESS over WARP MASQUE；链路：客户端 -> MASQUE 前置 -> VLESS 落地 -> 目标\n")
        yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False, width=120)
    print(f"已生成 {path}")
    print(f"MASQUE 前置: {n_front}; VLESS 落地: {n_land}; 套娃组合: {n_combo}")


if __name__ == "__main__":
    main()
