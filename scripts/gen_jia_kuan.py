#!/usr/bin/env python3
"""家宽链式 over Cloudflare WARP (MASQUE) — mihomo 配置生成。

链路: 本机 -> MASQUE 前置 -> VPN Gate 住宅 OpenVPN -> 目标
用法: python3 gen_jia_kuan.py <usque-config.json> <输出目录>
"""
import base64, json, os, re, sys, urllib.request

V4 = ["162.159.198.1", "162.159.198.2", "162.159.199.1", "162.159.199.2"]
V6 = ["2606:4700:103::1", "2606:4700:103::2", "2606:4700:104::1", "2606:4700:104::2"]
PORTS = (443, 500, 1701, 4500, 4443, 8443, 8095)
OFFICIAL_SNI = "zt-masque.cloudflareclient.com"
SNI_NODE = ("162.159.198.1", 443)
VPNGATE_URLS = (
    "https://www.vpngate.net/api/iphone/",
    "http://www.vpngate.net/api/iphone/",
)
DC_HOSTNAME_PREFIX = "public-vpn"
DC_IP_PREFIX = "219.100.37."
OVPN_HEAD_LEN = 6000
MAX_LANDINGS = 40
RS = "https://raw.githubusercontent.com"
RULESETS = [
    ("🎯 全球直连", f"{RS}/cmliu/ACL4SSR/refs/heads/main/Clash/CFnat.list"),
    ("🎯 全球直连", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list"),
    ("🛑 全球拦截", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/BanAD.list"),
    ("🍃 应用净化", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list"),
    ("📲 电报信息", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Telegram.list"),
    ("🤖 AI服务", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list"),
    ("📹 油管视频", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list"),
    ("🎥 奈飞视频", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list"),
    ("🚀 节点选择", f"{RS}/ACL4SSR/ACL4SSR/master/Clash/ProxyLite.list"),
]


def pem_to_b64der(pem):
    """剥掉 PEM 头尾，只留 base64 DER，给 mihomo public-key 用。"""
    return "".join(
        ln.strip() for ln in pem.strip().splitlines()
        if ln.strip() and not ln.startswith("-----")
    )


def entry_name(ip, port):
    if ":" in ip:
        seg, tail = ip.split(":")[2], ip.rsplit(":", 1)[-1]
        return f"v6-{seg}-{tail}-{port}"
    return f"{'.'.join(ip.split('.')[2:])}-{port}"


def masque_node(name, ip, port, priv, pub, v4, v6, sni=None):
    srv = f'"{ip}"' if ":" in ip else ip
    extra = f"\n    sni: {sni}" if sni else ""
    return (
        f"  - name: {name}\n    type: masque\n    server: {srv}\n    port: {port}{extra}\n"
        f"    private-key: {priv}\n    public-key: {pub}\n    ip: {v4}\n    ipv6: {v6}\n"
        f"    mtu: 1280\n    udp: true\n    remote-dns-resolve: true\n"
        f"    dns: [1.1.1.1, 2606:4700:4700::1111]"
    )


def b64decode_text(s):
    return base64.b64decode(re.sub(r"\s+", "", s)).decode("utf-8", errors="replace")


def ovpn_directive(text, name):
    m = re.search(rf"^[ \t]*{re.escape(name)}[ \t]+(.+?)[ \t]*$", text, re.M)
    return m.group(1).strip() if m else ""


def ovpn_block(text, tag):
    m = re.search(rf"<{tag}>([\s\S]*?)</{tag}>", text)
    return m.group(1).strip() if m else ""


def decode_ovpn(config_b64, full=False):
    clean = re.sub(r"\s+", "", config_b64)
    if full or len(clean) <= OVPN_HEAD_LEN:
        return b64decode_text(clean)
    return b64decode_text(clean[:OVPN_HEAD_LEN])


def fetch_vpngate():
    last_err = None
    for url in VPNGATE_URLS:
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/plain"}
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            if body and "OpenVPN_ConfigData_Base64" in body:
                return body
            last_err = RuntimeError(f"{url} bad response")
        except Exception as e:
            last_err = e
            print(f"警告: 拉取 {url} 失败: {e}", file=sys.stderr)
    raise RuntimeError(f"VPN Gate 节点源拉不到: {last_err}")


def parse_vpngate(text):
    candidates = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line[0] in "*#":
            continue
        fields = line.split(",")
        if len(fields) < 15:
            continue
        hostname, ip = fields[0] or "", fields[1] or ""
        if hostname.startswith(DC_HOSTNAME_PREFIX) or ip.startswith(DC_IP_PREFIX):
            continue
        config_b64 = fields[-1]
        if not config_b64 or len(config_b64) < 100:
            continue
        try:
            speed = int(fields[4])
        except ValueError:
            speed = 0
        candidates.append({
            "country": (fields[6] or "XX").upper(),
            "speed": speed,
            "config_b64": config_b64,
        })
    candidates.sort(key=lambda x: x["speed"], reverse=True)
    nodes, certs = [], None
    for item in candidates:
        try:
            cfg = decode_ovpn(item["config_b64"])
            if not ovpn_directive(cfg, "remote"):
                cfg = decode_ovpn(item["config_b64"], full=True)
        except Exception:
            continue
        if (ovpn_directive(cfg, "proto") or "tcp").lower() != "tcp":
            continue
        remote = ovpn_directive(cfg, "remote").split()
        if not remote:
            continue
        if certs is None:
            try:
                full = decode_ovpn(item["config_b64"], full=True)
                ca, cert, key = ovpn_block(full, "ca"), ovpn_block(full, "cert"), ovpn_block(full, "key")
                if ca and cert and key:
                    certs = {"ca": ca, "cert": cert, "key": key}
            except Exception:
                pass
            if certs is None:
                continue
        try:
            port = int(remote[1]) if len(remote) > 1 else 443
        except ValueError:
            port = 443
        nodes.append({
            "country": item["country"], "server": remote[0], "port": port,
            "cipher": ovpn_directive(cfg, "cipher") or "AES-128-CBC",
            "auth": ovpn_directive(cfg, "auth") or "SHA1", "speed": item["speed"],
        })
        if len(nodes) >= MAX_LANDINGS:
            break
    if not nodes or not certs:
        raise RuntimeError("没解析出能用的家宽节点（需要 TCP + 完整证书）")
    return nodes, certs


def indent_cert(text, spaces):
    return "\n".join(spaces + ln.strip() for ln in text.splitlines() if ln.strip())


def yaml_quote(s):
    return json.dumps(str(s), ensure_ascii=False)


def build(cfg, landings, certs):
    # usque config.json: private_key / endpoint_pub_key / ipv4 / ipv6
    priv = cfg["private_key"].strip()
    if priv.startswith("-----"):
        priv = pem_to_b64der(priv)
    pub = pem_to_b64der(cfg["endpoint_pub_key"])
    v4, v6 = cfg["ipv4"], cfg["ipv6"]
    entries, proxies = [], []
    for ip in V4 + V6:
        for port in PORTS:
            n = entry_name(ip, port)
            entries.append(n)
            proxies.append(masque_node(n, ip, port, priv, pub, v4, v6))
    entries.append("官方域名")
    proxies.append(masque_node("官方域名", SNI_NODE[0], SNI_NODE[1], priv, pub, v4, v6, OFFICIAL_SNI))
    front_group = "⚡ MASQUE前置"
    country_count, landing_names = {}, []
    for i, node in enumerate(landings):
        country_count[node["country"]] = country_count.get(node["country"], 0) + 1
        name = f"🏠 {node['country']}-家宽-{country_count[node['country']]:02d}"
        landing_names.append(name)
        lines = [
            f"  - name: {yaml_quote(name)}", "    type: openvpn",
            f"    server: {node['server']}", f"    port: {node['port']}",
            "    proto: tcp", "    username: vpn", "    password: vpn",
            f"    cipher: {node['cipher']}", f"    auth: {node['auth']}",
            "    udp: false", "    handshake-timeout: 30",
            "    remote-dns-resolve: true", "    dns: [8.8.8.8, 1.1.1.1]",
            f"    dialer-proxy: {yaml_quote(front_group)}",
        ]
        if i == 0:
            lines += [
                "    ca: &jkca |-", indent_cert(certs["ca"], "      "),
                "    cert: &jkcert |-", indent_cert(certs["cert"], "      "),
                "    key: &jkkey |-", indent_cert(certs["key"], "      "),
            ]
        else:
            lines += ["    ca: *jkca", "    cert: *jkcert", "    key: *jkkey"]
        proxies.append("\n".join(lines))
    by_country = sorted(zip(landing_names, landings), key=lambda x: x[1]["country"])
    country_order = [n for n, _ in by_country]

    def q(items, n=6):
        return "\n".join(" " * n + f"- {yaml_quote(x)}" for x in items)

    def plain(items, n=6):
        return "\n".join(" " * n + f"- {x}" for x in items)

    prov, rules = [], []
    for i, (group, url) in enumerate(RULESETS):
        pn = f"rule{i:02d}"
        prov.append(
            f"  {pn}:\n    type: http\n    behavior: classical\n    format: text\n"
            f"    interval: 86400\n    url: {url}\n    path: ./ruleset/{pn}.list"
        )
        rules.append(f"  - RULE-SET,{pn},{group}")

    yaml = f"""# 家宽链式 over Cloudflare WARP (MASQUE)
# 链路: 本机 -> MASQUE -> VPN Gate 住宅 OpenVPN -> 目标
# 前置 {len(entries)} 个 MASQUE；家宽落地 {len(landings)} 个
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
{chr(10).join(proxies)}

proxy-groups:
  - name: {yaml_quote(front_group)}
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    proxies:
{plain(entries)}

  - name: "🏠 家宽自动"
    type: fallback
    url: https://www.gstatic.com/generate_204
    interval: 1800
    lazy: true
    proxies:
{q(landing_names)}

  - name: "🏠 家宽节点"
    type: select
    proxies:
{q(country_order)}

  - name: 🚀 节点选择
    type: select
    proxies:
      - "🏠 家宽自动"
      - "🏠 家宽节点"
      - {yaml_quote(front_group)}
      - DIRECT

  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT
      - 🚀 节点选择

  - name: 🛑 全球拦截
    type: select
    proxies:
      - REJECT
      - DIRECT

rule-providers:
{chr(10).join(prov)}

rules:
{chr(10).join(rules)}
  - GEOIP,LAN,🎯 全球直连,no-resolve
  - GEOIP,CN,🎯 全球直连
  - MATCH,🚀 节点选择
"""
    return yaml, len(entries), len(landings)


def main():
    if len(sys.argv) < 3:
        print("用法: gen_jia_kuan.py <usque-config.json> <输出目录>", file=sys.stderr)
        sys.exit(1)
    cfg_path, outdir = sys.argv[1], sys.argv[2]
    with open(cfg_path) as f:
        cfg = json.load(f)
    print("正在拉取 VPN Gate 家宽节点…", flush=True)
    landings, certs = parse_vpngate(fetch_vpngate())
    countries = sorted({n["country"] for n in landings})
    print(f"解析到 {len(landings)} 个家宽节点，国家: {', '.join(countries)}", flush=True)
    yaml, n_entry, n_land = build(cfg, landings, certs)
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "jia-kuan-masque.yaml")
    with open(path, "w", encoding="utf-8") as f:
        f.write(yaml)
    print(f"已生成 {path}")
    print(f"MASQUE 接入点 {n_entry} 个")
    print(f"家宽落地     {n_land} 个")


if __name__ == "__main__":
    main()
