// 免费落地节点池：来自 Au1rxx/free-vpn-subscriptions 按国家订阅
// 经 WARP/MASQUE 中转（dialer-proxy），适合 AI/流媒体连通性测试

export const FREE_COUNTRIES = [
  { code: "US", flag: "🇺🇸", name: "美国" },
  { code: "JP", flag: "🇯🇵", name: "日本" },
  { code: "SG", flag: "🇸🇬", name: "新加坡" },
  { code: "HK", flag: "🇭🇰", name: "香港" },
  { code: "TW", flag: "🇹🇼", name: "台湾" },
  { code: "KR", flag: "🇰🇷", name: "韩国" },
];

const FREE_URL = (code) =>
  `https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/by-country/clash-${code}.yaml`;

/** 默认设置 */
export function defaultFreeSettings() {
  return {
    enabled: false,
    useWarp: true,
    // ai-streaming | ai-only | streaming-only | all-foreign
    scope: "ai-streaming",
    // stable | all
    protocolMode: "stable",
    countries: ["US", "JP", "SG"],
  };
}

function providerId(code, kind = "general") {
  return `FREE-${code}-${kind.toUpperCase()}`;
}

function health(kind) {
  if (kind === "ai") {
    return { url: "https://chatgpt.com/", expected: "200-399", interval: 120, timeout: 9000 };
  }
  if (kind === "stream") {
    return { url: "https://www.netflix.com/", expected: "200-399", interval: 120, timeout: 9000 };
  }
  return { url: "https://www.gstatic.com/generate_204", expected: "204", interval: 120, timeout: 5000 };
}

/**
 * 生成 proxy-providers 块（含缩进）
 * @param {{enabled, useWarp, protocolMode, countries}} free
 * @param {string} [warpGroup="WARP直连"] dialer-proxy / 下载代理组名
 */
export function buildFreeProviders(free, warpGroup = "WARP直连") {
  if (!free?.enabled || !free.countries?.length) return "";
  const lines = ["proxy-providers:"];
  for (const code of free.countries) {
    const meta = FREE_COUNTRIES.find((c) => c.code === code) || { flag: "🌐", code };
    for (const kind of ["general", "ai", "stream"]) {
      const hc = health(kind);
      const pid = providerId(code, kind);
      lines.push(`  ${pid}:`);
      lines.push(`    type: http`);
      lines.push(`    url: "${FREE_URL(code)}"`);
      lines.push(`    path: ./providers/free-${code}-${kind}.yaml`);
      lines.push(`    interval: 3600`);
      lines.push(`    size-limit: 8388608`);
      if (free.useWarp) lines.push(`    proxy: "${warpGroup}"`);
      if (free.protocolMode === "stable") {
        lines.push(`    exclude-type: "hysteria2|tuic|wireguard|http|https|socks4|socks5"`);
      }
      lines.push(`    health-check:`);
      lines.push(`      enable: true`);
      lines.push(`      url: "${hc.url}"`);
      lines.push(`      expected-status: "${hc.expected}"`);
      lines.push(`      interval: ${hc.interval}`);
      lines.push(`      timeout: ${hc.timeout}`);
      lines.push(`      lazy: false`);
      lines.push(`    override:`);
      lines.push(`      additional-prefix: "${meta.flag} ${code} | "`);
      if (free.useWarp) lines.push(`      dialer-proxy: "${warpGroup}"`);
    }
  }
  return lines.join("\n");
}

/**
 * 生成免费落地相关 proxy-groups 片段
 */
export function buildFreeGroups(free) {
  if (!free?.enabled || !free.countries?.length) return "";

  const useGeneral = free.countries.map((c) => `      - ${providerId(c, "general")}`).join("\n");
  const useAi = free.countries.map((c) => `      - ${providerId(c, "ai")}`).join("\n");
  const useStream = free.countries.map((c) => `      - ${providerId(c, "stream")}`).join("\n");

  const countrySelect = free.countries
    .map((code) => {
      const meta = FREE_COUNTRIES.find((c) => c.code === code) || { flag: "🌐" };
      return `  - name: "${meta.flag} ${code}"
    type: select
    use:
      - ${providerId(code, "general")}`;
    })
    .join("\n\n");

  return `
  - name: "⚡ 免费落地自动"
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 80
    lazy: true
    use:
${useGeneral}

  - name: "🤖 AI自动优选"
    type: url-test
    url: https://chatgpt.com/
    interval: 300
    tolerance: 100
    lazy: true
    use:
${useAi}

  - name: "🎬 流媒体自动优选"
    type: url-test
    url: https://www.netflix.com/
    interval: 300
    tolerance: 100
    lazy: true
    use:
${useStream}

  - name: "🌍 免费落地可手动"
    type: select
    proxies:
      - "🤖 AI自动优选"
      - "🎬 流媒体自动优选"
      - "⚡ 免费落地自动"
${free.countries
  .map((code) => {
    const meta = FREE_COUNTRIES.find((c) => c.code === code) || { flag: "🌐" };
    return `      - "${meta.flag} ${code}"`;
  })
  .join("\n")}

${countrySelect}
`;
}

/** 根据 scope 决定某策略组是否优先免费落地 */
export function freeForService(free, service) {
  if (!free?.enabled) return false;
  const s = free.scope || "ai-streaming";
  if (s === "all-foreign") return true;
  if (s === "ai-only") return service === "AI";
  if (s === "streaming-only") return service === "stream";
  // ai-streaming
  return service === "AI" || service === "stream";
}
