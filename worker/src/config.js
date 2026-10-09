// 生成 mihomo 配置：MASQUE 接入点 x Opera 落地 全组合。
// 接入点清单是真机握手实测筛过的，别往回加 162.159.194/196/197/204
// 和 v6 的 102/105 段 —— 它们回 QUIC 包但 login 失败。
//
// 端口 4443 和 8095 是后来补测出来的，4 个 v4 地址 x 这两个端口 8/8 全通。
// 优选 IP/域名见 endpoints.js；可通过 POST /push/<token>/endpoints 远程提交。
// 免费落地见 free_land.js；MASQUE 高级参数（sni/mtu/dns/network/cc）由 settings.advanced 传入。
import { mergeEndpointPairs, entryName as epName } from "./endpoints.js";
import { buildFreeProviders, buildFreeGroups, freeForService } from "./free_land.js";

const RS = "https://raw.githubusercontent.com";
const RULESETS = [
  ["🎯 全球直连", RS + "/cmliu/ACL4SSR/refs/heads/main/Clash/CFnat.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/UnBan.list"],
  ["🛑 全球拦截", RS + "/ACL4SSR/ACL4SSR/master/Clash/BanAD.list"],
  ["🍃 应用净化", RS + "/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list"],
  ["🍃 应用净化", RS + "/cmliu/ACL4SSR/main/Clash/adobe.list"],
  ["🍃 应用净化", RS + "/cmliu/ACL4SSR/main/Clash/IDM.list"],
  ["📢 谷歌FCM", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/GoogleFCM.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list"],
  ["Ⓜ️ 微软服务", RS + "/ACL4SSR/ACL4SSR/master/Clash/Microsoft.list"],
  ["🍎 苹果服务", RS + "/ACL4SSR/ACL4SSR/master/Clash/Apple.list"],
  ["📲 电报信息", RS + "/ACL4SSR/ACL4SSR/master/Clash/Telegram.list"],
  ["🤖 AI服务", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list"],
  ["🤖 AI服务", RS + "/juewuy/ShellClash/master/rules/ai.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/Copilot.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/GithubCopilot.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/Claude.list"],
  ["🤖 AI服务", RS + "/cmliu/ACL4SSR/main/Clash/Gemini.list"],
  ["📹 油管视频", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/YouTube.list"],
  ["🎥 奈飞视频", RS + "/ACL4SSR/ACL4SSR/master/Clash/Ruleset/Netflix.list"],
  ["🌍 国外媒体", RS + "/ACL4SSR/ACL4SSR/master/Clash/ProxyMedia.list"],
  ["🌍 国外媒体", RS + "/cmliu/ACL4SSR/main/Clash/Emby.list"],
  ["🚀 节点选择", RS + "/ACL4SSR/ACL4SSR/master/Clash/ProxyLite.list"],
  ["🚀 节点选择", RS + "/cmliu/ACL4SSR/main/Clash/CMBlog.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"],
  ["🎯 全球直连", RS + "/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list"]
];

function entryName(ip, port) {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `v6-${parts[2]}-${parts[parts.length - 1]}-${port}`;
  }
  return `${ip.split(".").slice(2).join(".")}-${port}`;
}

/** @param {object} [adv] MASQUE 高级：sni, mtu, dns[], network, stack, cc, outerCc, bbrProfile, remoteDns, udp */
function masqueNode(name, ip, port, priv, pub, v4, v6, sni, adv = {}) {
  const isV6 = ip.includes(":") && !ip.includes(".");
  const srv = (isV6 || /[a-zA-Z]/.test(ip)) ? `"${ip}"` : ip;
  const finalSni = sni || adv.sni || null;
  const extra = finalSni ? `\n    sni: ${finalSni}` : "";
  const mtu = Number(adv.mtu) > 0 ? Number(adv.mtu) : 1280;
  const dnsList = Array.isArray(adv.dns) && adv.dns.length
    ? adv.dns
    : ["1.1.1.1", "2606:4700:4700::1111"];
  const remoteDns = adv.remoteDns !== false;
  const udp = adv.udp !== false;
  const network = adv.network && adv.network !== "quic" ? adv.network : null;
  let stackBlock = "";
  if (adv.stack && adv.stack !== "auto") {
    stackBlock += `\n    ip-stack:\n      mode: ${adv.stack}`;
    if (adv.cc) stackBlock += `\n      congestion-controller: ${adv.cc}`;
  } else if (adv.cc) {
    stackBlock += `\n    ip-stack:\n      mode: auto\n      congestion-controller: ${adv.cc}`;
  }
  let outerCc = "";
  if (adv.outerCc) {
    outerCc += `\n    congestion-controller: ${adv.outerCc}`;
    if (adv.bbrProfile) outerCc += `\n    bbr-profile: ${adv.bbrProfile}`;
  }
  const netLine = network ? `\n    network: ${network}` : "";
  return `  - name: ${name}
    type: masque
    server: ${srv}
    port: ${port}${extra}${netLine}
    private-key: ${priv}
    public-key: ${pub}
    ip: ${v4}
    ipv6: ${v6}
    mtu: ${mtu}
    udp: ${udp}
    remote-dns-resolve: ${remoteDns}
    dns: [${dnsList.join(", ")}]${stackBlock}${outerCc}`;
}

function buildEntries(warp, custom, adv) {
  const { privateKey: priv, peerPublicKey: pub, ipv4: v4, ipv6: v6 } = warp;
  const entries = [], proxies = [];
  const v4Entries = [];
  const pairs = mergeEndpointPairs(custom?.list || [], custom?.mode || "merge");
  const usedNames = new Set();
  for (const ep of pairs) {
    let n = ep.label || epName(ep.host, ep.port, ep.label);
    let base = n, i = 2;
    while (usedNames.has(n)) { n = `${base}-${i++}`; }
    usedNames.add(n);
    entries.push(n);
    const isV6 = ep.host.includes(":") && !ep.host.includes(".");
    if (!isV6) v4Entries.push(n);
    const sni = ep.sni || (ep.kind === "domain" ? ep.host : null);
    proxies.push(masqueNode(n, ep.host, ep.port, priv, pub, v4, v6, sni, adv));
  }
  return { entries, proxies, v4Entries };
}

const AI_DOMAINS = [
  "openai.fm", "operator.chatgpt.com", "chat.com",
  "anthropic.com", "claude.ai", "claudeusercontent.com",
  "gemini.google.com", "aistudio.google.com", "generativelanguage.googleapis.com",
  "notebooklm.google.com", "notebooklm.google", "labs.google", "deepmind.com",
  "x.ai", "grok.com", "meta.ai",
  "perplexity.ai", "pplx.ai", "perplexity.com",
  "mistral.ai", "chat.mistral.ai",
  "cohere.com", "cohere.ai", "ai21.com", "together.ai", "together.xyz",
  "fireworks.ai", "groq.com",
  "huggingface.co", "hf.co", "huggingface.js.org",
  "replicate.com", "replicate.delivery", "runpod.io", "modal.com",
  "openrouter.ai", "poe.com", "quora.com",
  "cursor.com", "cursor.sh", "codeium.com", "windsurf.com",
  "tabnine.com", "sourcegraph.com", "phind.com", "v0.dev", "v0.app",
  "bolt.new", "lovable.dev", "devin.ai", "cognition.ai",
  "midjourney.com", "stability.ai", "stablediffusionweb.com",
  "leonardo.ai", "runwayml.com", "pika.art", "lumalabs.ai",
  "ideogram.ai", "recraft.ai", "krea.ai", "civitai.com",
  "elevenlabs.io", "eleven-labs.com", "play.ht", "suno.com", "suno.ai",
  "udio.com", "assemblyai.com", "deepgram.com",
  "you.com", "kagi.com", "exa.ai", "tavily.com",
  "jasper.ai", "copy.ai", "writesonic.com", "notion.so",
  "langchain.com", "langsmith.com", "wandb.ai", "weightsandbiases.com",
  "pinecone.io", "weaviate.io", "qdrant.tech", "chromadb.com",
  "deepseek.com", "moonshot.cn", "moonshotai.com", "kimi.com",
  "bigmodel.cn", "zhipuai.cn", "z.ai",
  "minimaxi.com", "minimax.io", "hailuoai.com",
  "siliconflow.cn", "dashscope.aliyuncs.com",
];

const q = (a, n = 6) => a.map((x) => " ".repeat(n) + `- "${x}"`).join("\n");
const p = (a, n = 6) => a.map((x) => " ".repeat(n) + `- ${x}`).join("\n");

function buildRules() {
  const prov = [], rules = [];
  RULESETS.forEach(([group, url], i) => {
    const pn = `rule${String(i).padStart(2, "0")}`;
    prov.push(`  ${pn}:\n    type: http\n    behavior: classical\n    format: text\n    interval: 86400\n    url: ${url}\n    path: ./ruleset/${pn}.list`);
    rules.push(`  - RULE-SET,${pn},${group}`);
  });
  const ai = AI_DOMAINS.map((d) => `  - DOMAIN-SUFFIX,${d},🤖 AI服务`);
  return { prov: prov.join("\n"), rules: [...ai, ...rules].join("\n") };
}

function head(ipv6) {
  return `mixed-port: 7890\nallow-lan: false\nmode: rule\nlog-level: info\nipv6: ${ipv6}\nunified-delay: true\ntcp-concurrent: true\nfind-process-mode: 'off'\nexternal-controller: 127.0.0.1:9090\n\nprofile:\n  store-selected: true\n  store-fake-ip: true\n\nsniffer:\n  enable: true\n  sniff:\n    HTTP:\n      ports: [80, 8080-8880]\n      override-destination: true\n    TLS:\n      ports: [443, 8443]\n    QUIC:\n      ports: [443, 8443]\n  skip-domain:\n    - '+.push.apple.com'\n    - '+.apple.com'\n\ndns:\n  enable: true\n  listen: 0.0.0.0:1053\n  ipv6: ${ipv6}\n  enhanced-mode: fake-ip\n  fake-ip-range: 198.18.0.1/16\n  fake-ip-filter:\n    - '+.lan'\n    - '+.local'\n    - '*.msftconnecttest.com'\n    - '*.msftncsi.com'\n  default-nameserver:\n    - 223.5.5.5\n    - 119.29.29.29\n  nameserver:\n    - https://223.5.5.5/dns-query\n    - https://1.12.12.12/dns-query\n  proxy-server-nameserver:\n    - https://223.5.5.5/dns-query\n  nameserver-policy:\n    'geosite:cn,private':\n      - https://223.5.5.5/dns-query\n      - https://1.12.12.12/dns-query\n    'geosite:geolocation-!cn':\n      - https://1.1.1.1/dns-query\n      - https://8.8.8.8/dns-query`;
}

function tailGroups(picks, free) {
  const aiFirst = freeForService(free, "AI")
    ? `      - "🤖 AI自动优选"\n      - "🌍 免费落地可手动"\n` : "";
  const streamFirst = freeForService(free, "stream")
    ? `      - "🎬 流媒体自动优选"\n      - "🌍 免费落地可手动"\n` : "";
  return `  - name: 📹 油管视频\n    type: select\n    proxies:\n${streamFirst}      - 🚀 节点选择\n      - ♻️ 自动选择\n      - 🔄 故障转移\n${p(picks)}\n\n  - name: 🎥 奈飞视频\n    type: select\n    proxies:\n${streamFirst}      - 🚀 节点选择\n      - ♻️ 自动选择\n      - 🔄 故障转移\n${p(picks)}\n\n  - name: 🌍 国外媒体\n    type: select\n    proxies:\n${streamFirst}      - 🚀 节点选择\n      - ♻️ 自动选择\n      - 🔄 故障转移\n      - 🎯 全球直连\n\n  - name: 📲 电报信息\n    type: select\n    proxies:\n      - 🚀 节点选择\n      - ♻️ 自动选择\n      - 🎯 全球直连\n\n  - name: 🤖 AI服务\n    type: select\n    proxies:\n${aiFirst}      - 🚀 节点选择\n      - ♻️ 自动选择\n      - 🔄 故障转移\n${p(picks)}\n\n  - name: Ⓜ️ 微软服务\n    type: select\n    proxies:\n      - 🎯 全球直连\n      - 🚀 节点选择\n      - ♻️ 自动选择\n\n  - name: 🍎 苹果服务\n    type: select\n    proxies:\n      - 🎯 全球直连\n      - 🚀 节点选择\n      - ♻️ 自动选择\n\n  - name: 📢 谷歌FCM\n    type: select\n    proxies:\n      - 🚀 节点选择\n      - 🎯 全球直连\n      - ♻️ 自动选择\n\n  - name: 🎯 全球直连\n    type: select\n    proxies:\n      - DIRECT\n      - 🚀 节点选择\n      - ♻️ 自动选择\n\n  - name: 🛑 全球拦截\n    type: select\n    proxies:\n      - REJECT\n      - DIRECT\n\n  - name: 🍃 应用净化\n    type: select\n    proxies:\n      - REJECT\n      - DIRECT\n\n  - name: 🐟 漏网之鱼\n    type: select\n    proxies:\n      - 🚀 节点选择\n      - 🎯 全球直连\n      - ♻️ 自动选择`;
}

export function buildConfig(warp, opera, proton, wind, custom, opts = {}) {
  const free = opts.free || null;
  const advanced = opts.advanced || {};
  const { entries, proxies, v4Entries } = buildEntries(warp, custom, advanced);

  const byLoc = {};
  for (const land of opera.landings) {
    for (const ent of entries) {
      const name = `${land.tag}@${ent}`;
      (byLoc[land.loc] ||= []).push(name);
      proxies.push(
        `  - {name: "${name}", type: http, server: ${land.ip}, port: ${land.port}, ` +
        `username: ${opera.username}, password: ${opera.password}, tls: true, ` +
        `sni: ${land.host}, skip-cert-verify: false, dialer-proxy: ${ent}}`);
    }
  }
  const combos = Object.values(byLoc).reduce((a, b) => a + b.length, 0);

  let protonNames = [];
  const protonByCC = {};
  if (proton && proton.servers && proton.servers.length) {
    proton.servers.forEach((srv, i) => {
      const ent = v4Entries[i % v4Entries.length];
      protonNames.push(srv.name);
      const cc = srv.name.replace(/\d+$/, "");
      (protonByCC[cc] = protonByCC[cc] || []).push(srv.name);
      proxies.push(`  - name: "${srv.name}"\n    type: wireguard\n    server: ${srv.ip}\n    port: ${srv.port}\n    ip: 10.2.0.2\n    private-key: ${proton.privateKey}\n    public-key: ${srv.pub}\n    udp: true\n    mtu: 1280\n    dialer-proxy: ${ent}`);
    });
  }

  const windNames = [];
  const windByLoc = {};
  if (wind && wind.servers && wind.servers.length) {
    wind.servers.forEach((srv, i) => {
      const ent = v4Entries[i % v4Entries.length];
      const name = `WS-${srv.tag}`;
      windNames.push(name);
      (windByLoc[srv.loc] = windByLoc[srv.loc] || []).push(name);
      proxies.push(
        `  - {name: "${name}", type: http, server: ${srv.host}, port: ${srv.port}, ` +
        `username: ${wind.username}, password: ${wind.password}, tls: true, ` +
        `sni: ${srv.host}, skip-cert-verify: false, dialer-proxy: ${ent}}`);
    });
  }
  const windLocNames = Object.keys(windByLoc).map((l) => `WS-${l}`);
  const windLocDefs = Object.entries(windByLoc).map(([loc, names]) =>
    `  - name: WS-${loc}\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 100\n    lazy: true\n    proxies:\n${q(names)}`).join("\n\n");

  const locNames = Object.keys(byLoc).map((l) => `${l}线路`);
  const protonCCNames = Object.keys(protonByCC).map((c) => `Proton-${c}`);
  const protonCCDefs = Object.entries(protonByCC).map(([cc, names]) =>
    `  - name: Proton-${cc}\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 100\n    lazy: true\n    proxies:\n${q(names)}`).join("\n\n");

  const freeOn = !!(free && free.enabled && free.countries && free.countries.length);
  const picks = [...locNames, "WARP直连"];
  if (freeOn) {
    picks.unshift("⚡ 免费落地自动", "🌍 免费落地可手动");
    if (freeForService(free, "AI")) picks.unshift("🤖 AI自动优选");
    if (freeForService(free, "stream")) picks.unshift("🎬 流媒体自动优选");
  }
  if (protonNames.length) picks.push("Proton线路", ...protonCCNames);
  if (windNames.length) picks.push("Windscribe线路", ...windLocNames);
  const locDefs = Object.entries(byLoc).map(([loc, tags]) => `  - name: ${loc}线路\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 80\n    lazy: true\n    proxies:\n${q(tags)}`).join("\n\n");

  const { prov, rules } = buildRules();

  const yaml = `# Opera VPN over Cloudflare WARP (MASQUE)\n# 由 Cloudflare Worker 生成于 ${new Date().toISOString()}\n\n${head(true)}\n\nproxies:\n${proxies.join("\n")}\n\nproxy-groups:\n  - name: 🚀 节点选择\n    type: select\n    proxies:\n      - ♻️ 自动选择\n${p(picks)}\n      - 🔄 故障转移\n\n  - name: ♻️ 自动选择\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 50\n    lazy: true\n    proxies:\n${p(picks)}\n\n  - name: 🔄 故障转移\n    type: fallback\n    url: http://www.gstatic.com/generate_204\n    interval: 180\n    lazy: true\n    proxies:\n${p(picks)}\n\n${locDefs}\n\n  - name: WARP直连\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 50\n    lazy: true\n    proxies:\n${q(entries)}\n${protonNames.length ? `\n  - name: Proton线路\n    type: select\n    proxies:\n      - Proton-自动\n${p(protonCCNames)}\n\n  - name: Proton-自动\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 80\n    lazy: true\n    proxies:\n${q(protonNames)}\n\n${protonCCDefs}\n` : ""}${windNames.length ? `\n  - name: Windscribe线路\n    type: select\n    proxies:\n      - WS-自动\n${p(windLocNames)}\n\n  - name: WS-自动\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 80\n    lazy: true\n    proxies:\n${q(windNames)}\n\n${windLocDefs}\n` : ""}\n${freeOn ? buildFreeGroups(free) : ""}\n${tailGroups(picks, free)}\n\nrule-providers:\n${prov}\n\n${freeOn ? buildFreeProviders(free, "WARP直连") : ""}\n\nrules:\n${rules}\n  - GEOIP,LAN,🎯 全球直连,no-resolve\n  - GEOIP,CN,🎯 全球直连\n  - MATCH,🐟 漏网之鱼\n`;

  return { yaml, entries: entries.length, landings: opera.landings.length,
           combos, proton: protonNames.length, wind: windNames.length,
           free: freeOn ? free.countries.length : 0 };
}
