// Opera VPN over Cloudflare WARP (MASQUE) —— Worker 版
//
// 部署只需要绑一个 KV，密码和订阅路径都在界面上设，不用 cron。
//
// 职责:
//   1. 订阅被访问时按需重建：Opera 凭据没过期就直接给缓存，
//      过期了才重新注册。凭据有效期 4 小时（opera-proxy 的 -refresh 默认值）
//   2. WARP 注册信息存 KV 复用，不每次重注册（设备是有限资源）
//   3. 首次访问引导设密码，之后订阅路径、改密码都在界面里做
import { registerWarp } from "./warp.js";
import { fetchOpera } from "./opera.js";
import { buildConfig } from "./config.js";
import { buildJiaKuanConfig } from "./jia_kuan.js";
import { parseBlob } from "./proton.js";
import { fetchWindscribe, fetchSession } from "./windscribe.js";
import { renderUI, renderLogin, renderSetup, renderNoKV } from "./ui.js";
import {
  safeEqual, makeCred, checkPassword, signToken, verifyToken,
  readCookie, rateLimit, clearRateLimit, normalizePath,
} from "./auth.js";

const K_WARP = "warp:device";     // WARP 注册信息，长期复用
const K_CFG = "config:yaml";      // 聚合配置（套娃线路 + WARP 直连）
const K_JK = "config:jia-kuan";   // 家宽链式订阅缓存
const K_JK_META = "state:jia-kuan"; // 家宽缓存元数据
const K_STATE = "state:meta";     // 状态元数据，给 UI 用
const K_CRED = "auth:cred";       // 密码哈希 + 盐
const K_SET = "settings";         // 订阅路径等设置
const K_CLAIM = "auth:claim";     // 初始化时的抢占标记
const K_PROTON = "proton:cred";   // Proton 凭据（由流水线推送）
const K_PUSH = "proton:token";    // 流水线的写入令牌
const K_WIND = "wind:account";    // Windscribe 账号，长期复用（连着开户会被降额）
const K_LOCK = "rebuild:lock";    // 重建锁，防并发重复注册
const K_EP = "endpoints:custom";  // 远程提交的优选 IP/域名
const K_EP_META = "endpoints:meta"; // 优选列表元数据
const COOKIE = "om_session";
const DEFAULT_SUB = "sub";

// Opera 凭据有效期。opera-proxy 默认每 4 小时刷新一次登录和设备密码
// （main.go: -refresh 4h），API 本身不返回真实 TTL，按这个值走。
// 留 10 分钟余量，别卡着点过期。
const TTL_MS = 4 * 3600 * 1000;
const SKEW_MS = 10 * 60 * 1000;
// 家宽节点清单缓存 30 分钟（与 jia_kuan.js 内存缓存对齐）
const JK_TTL_MS = 30 * 60 * 1000;

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const html = (body, s = 200) =>
  new Response(body, {
    status: s,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const notFound = () => new Response("Not Found", { status: 404 });

async function getSettings(env) {
  const s = (await env.KV.get(K_SET, "json")) || {};
  return {
    subPath: s.subPath || DEFAULT_SUB,
    // 家宽链式：默认关闭，管理页勾上后订阅地址加 ?target=jk 即专属订阅
    jkEnabled: !!s.jkEnabled,
  };
}

/** 读取远程提交的优选接入点。 */
async function getCustomEndpoints(env) {
  const list = (await env.KV.get(K_EP, "json")) || [];
  const meta = (await env.KV.get(K_EP_META, "json")) || {};
  return { list: Array.isArray(list) ? list : [], meta };
}

/** 生成 / 刷新家宽订阅。未开启时返回 null。 */
async function ensureJiaKuan(env, { force = false } = {}) {
  const settings = await getSettings(env);
  if (!settings.jkEnabled) return null;

  if (!force) {
    const meta = await env.KV.get(K_JK_META, "json");
    const cached = await env.KV.get(K_JK);
    if (cached && meta && meta.expiresAt && Date.parse(meta.expiresAt) > Date.now()) {
      return cached;
    }
  }

  const warp = await getWarp(env);
  const custom = await getCustomEndpoints(env);
  const { yaml, landings, entries } = await buildJiaKuanConfig(warp, {
    list: custom.list, mode: custom.meta.mode || "merge",
  });
  const now = Date.now();
  const meta = {
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + JK_TTL_MS).toISOString(),
    landings,
    entries,
  };
  await env.KV.put(K_JK, yaml);
  await env.KV.put(K_JK_META, JSON.stringify(meta));
  return yaml;
}

/** 拿 WARP 设备信息，KV 里有就复用，没有才注册。 */
async function getWarp(env, force = false) {
  if (!force) {
    const cached = await env.KV.get(K_WARP, "json");
    if (cached && cached.privateKey) return cached;
  }
  const w = await registerWarp("cf-worker");
  await env.KV.put(K_WARP, JSON.stringify(w));
  return w;
}

/** Windscribe 账号只用流水线推来的那个，Worker 不自己开户。 */
async function getWind(env) {
  const acc = await env.KV.get(K_WIND, "json");
  if (!acc || !acc.sessionAuthHash) return null;
  return await fetchWindscribe(acc);
}

/** 重建配置。WARP 复用，Opera 每次重取（凭据会过期）。 */
async function rebuild(env, { forceWarp = false } = {}) {
  const warp = await getWarp(env, forceWarp);
  const opera = await fetchOpera();
  let proton = null;
  const pc = await env.KV.get(K_PROTON, "json");
  if (pc && (!pc.expiresAt || pc.expiresAt * 1000 > Date.now())) proton = pc;
  let wind = null, windErr = null;
  try {
    wind = await getWind(env);
  } catch (e) {
    windErr = e.message;
  }
  const custom = await getCustomEndpoints(env);
  const { yaml, entries, landings, combos, proton: pn, wind: wn } =
    buildConfig(warp, opera, proton, wind, { list: custom.list, mode: custom.meta.mode || "merge" });

  const now = Date.now();
  const state = {
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    stats: { entries, landings, combos, proton: pn || 0, wind: wn || 0 },
    protonExpiresAt: proton ? proton.expiresAt : null,
    wind: wind ? { userId: wind.account.userId, servers: wn || 0 } : null,
    windErr,
    warp: {
      deviceId: warp.deviceId,
      ipv4: warp.ipv4,
      ipv6: warp.ipv6,
      registeredAt: warp.registeredAt,
    },
  };

  await env.KV.put(K_CFG, yaml);
  await env.KV.put(K_STATE, JSON.stringify(state));
  return state;
}

function isFresh(state) {
  if (!state || !state.expiresAt) return false;
  return Date.parse(state.expiresAt) - SKEW_MS > Date.now();
}

async function ensureConfig(env) {
  const state = await env.KV.get(K_STATE, "json");
  const yaml = await env.KV.get(K_CFG);
  if (yaml && isFresh(state)) return yaml;

  const lock = await env.KV.get(K_LOCK);
  if (lock && Date.now() - Number(lock) < 90000) {
    if (yaml) return yaml;
  } else {
    await env.KV.put(K_LOCK, String(Date.now()), { expirationTtl: 120 });
    try {
      await rebuild(env);
    } finally {
      await env.KV.delete(K_LOCK);
    }
  }
  return (await env.KV.get(K_CFG)) || yaml;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = req.headers.get("cf-connecting-ip") || "unknown";

    if (!env || !env.KV) return html(renderNoKV(), 500);

    const cred = await env.KV.get(K_CRED, "json");
    const authed = cred && (await verifyToken(cred, readCookie(req, COOKIE)));

    if (!cred) {
      if (path === "/api/setup" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pw = String(body.password || "");
        if (pw.length < 8) return json({ ok: false, error: "密码至少 8 位" }, 400);
        if (pw !== body.confirm) return json({ ok: false, error: "两次输入不一致" }, 400);

        const claim = crypto.randomUUID();
        if (await env.KV.get(K_CRED)) {
          return json({ ok: false, error: "密码已被设置，请刷新页面" }, 409);
        }
        await env.KV.put(K_CLAIM, claim, { expirationTtl: 60 });
        if ((await env.KV.get(K_CLAIM)) !== claim) {
          return json({ ok: false, error: "密码已被设置，请刷新页面" }, 409);
        }

        const c = await makeCred(pw);
        if (await env.KV.get(K_CRED)) {
          return json({ ok: false, error: "密码已被设置，请刷新页面" }, 409);
        }
        await env.KV.put(K_CRED, JSON.stringify(c));
        await env.KV.delete(K_CLAIM);
        const token = await signToken(c);
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; ` +
                          `SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
          },
        });
      }
      if (path === "/") return html(renderSetup());
      return notFound();
    }

    const settings = await getSettings(env);
    const subPath = "/" + settings.subPath;

    if (path === subPath) {
      const t = url.searchParams.get("token") || "";
      if (!(await verifyToken(cred, t)) && !authed) return notFound();

      const target = (url.searchParams.get("target") || "").toLowerCase();
      if (target === "jk" || target === "vg") {
        if (!settings.jkEnabled) {
          return new Response(
            "家宽链式没开。到管理页勾上「开启家宽链式」再访问。",
            { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
          );
        }
        try {
          const yaml = await ensureJiaKuan(env);
          if (!yaml) {
            return new Response("家宽配置生成失败，稍后重试",
              { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
          }
          return new Response(yaml, {
            headers: {
              "content-type": "text/yaml; charset=utf-8",
              "content-disposition": "attachment; filename=jia-kuan-masque.yaml",
              "profile-update-interval": "1",
              "cache-control": "no-store",
            },
          });
        } catch (e) {
          const reason = e && e.message ? e.message : String(e);
          return new Response(
            `家宽节点暂时拉不到：${reason}\n过几分钟再更新，客户端会先用着上一份。`,
            { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
          );
        }
      }

      const yaml = await ensureConfig(env);
      if (!yaml) {
        return new Response("配置生成失败，稍后重试或到管理页手动刷新",
          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return new Response(yaml, {
        headers: {
          "content-type": "text/yaml; charset=utf-8",
          "content-disposition": "attachment; filename=opera-masque.yaml",
          "profile-update-interval": "4",
          "cache-control": "no-store",
        },
      });
    }

    // ---- 流水线推送：Proton / Windscribe / 优选接入点 ----
    if (path.startsWith("/push/") && req.method === "POST") {
      const tk = await env.KV.get(K_PUSH);
      const rest = path.slice(6);
      const slash = rest.indexOf("/");
      const got = slash < 0 ? rest : rest.slice(0, slash);
      const kind = slash < 0 ? "proton" : rest.slice(slash + 1);
      if (!tk || !got || !safeEqual(got, tk)) return notFound();

      const body = await req.text();

      if (kind === "wind") {
        let acc;
        try {
          acc = JSON.parse(body);
        } catch {
          return json({ ok: false, error: "不是合法的 JSON" }, 400);
        }
        if (!acc || !acc.sessionAuthHash || !acc.locHash) {
          return json({ ok: false, error: "缺 sessionAuthHash 或 locHash" }, 400);
        }
        if (acc.status !== undefined && acc.status !== 1) {
          return json({ ok: false, error: `账号 status=${acc.status}，是被降额的号，没法用` }, 400);
        }
        await env.KV.put(K_WIND, JSON.stringify(acc));
        try {
          const st = await rebuild(env);
          return json({ ok: true, msg: `已写入 Windscribe 账号，${st.stats.wind} 台落地` });
        } catch (e) {
          return json({ ok: true, msg: "账号已写入，但重建配置失败：" + e.message });
        }
      }

      if (kind === "endpoints" || kind === "ep" || kind === "ips") {
        // 本地优选后远程提交：POST /push/<token>/endpoints
        // body: { "endpoints": ["ip:port", "domain:port", ...], "replace": true, "mode": "merge"|"prefer"|"only" }
        // 也接受纯文本，一行一个
        let items = [], mode = "merge", replace = true;
        const ct = (req.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          let obj;
          try { obj = JSON.parse(body || "{}"); } catch {
            return json({ ok: false, error: "不是合法的 JSON" }, 400);
          }
          const raw = obj.endpoints || obj.ips || obj.list || obj.servers || [];
          items = Array.isArray(raw) ? raw : String(raw).split(/[\n,]+/);
          if (obj.mode) mode = String(obj.mode);
          if (obj.replace === false) replace = false;
        } else {
          items = String(body || "").split(/\r?\n/);
        }
        items = items.map((x) => String(x).trim()).filter((x) => x && !x.startsWith("#"));
        if (!items.length) return json({ ok: false, error: "endpoints 列表为空" }, 400);
        if (items.length > 200) return json({ ok: false, error: "最多 200 条" }, 400);

        let final = items;
        if (!replace) {
          const prev = (await env.KV.get(K_EP, "json")) || [];
          const seen = new Set(prev.map((x) => String(x).toLowerCase()));
          for (const x of items) {
            if (!seen.has(String(x).toLowerCase())) prev.push(x);
          }
          final = prev.slice(0, 200);
        }
        const meta = {
          updatedAt: new Date().toISOString(),
          count: final.length,
          mode: ["merge", "prefer", "only"].includes(mode) ? mode : "merge",
          source: "push",
        };
        await env.KV.put(K_EP, JSON.stringify(final));
        await env.KV.put(K_EP_META, JSON.stringify(meta));
        try {
          const st = await rebuild(env);
          return json({
            ok: true,
            msg: `已写入 ${final.length} 条优选接入点（mode=${meta.mode}），配置已重建`,
            meta,
            combos: st.stats.combos,
          });
        } catch (e) {
          return json({
            ok: true,
            msg: `已写入 ${final.length} 条，但重建配置失败：` + e.message,
            meta,
          });
        }
      }

      let parsed;
      try {
        parsed = parseBlob(body);
      } catch (e) {
        return json({ ok: false, error: e.message }, 400);
      }
      await env.KV.put(K_PROTON, JSON.stringify(parsed));
      try {
        const st = await rebuild(env);
        return json({ ok: true, msg: `已写入 ${parsed.servers.length} 台 Proton 落地`,
                      combos: st.stats.combos, proton: st.stats.proton });
      } catch (e) {
        return json({ ok: true, msg: "凭据已写入，但重建配置失败：" + e.message });
      }
    }

    if (path === "/login" && req.method === "POST") {
      if (!(await rateLimit(env, ip))) {
        return json({ ok: false, error: "尝试过多，15 分钟后再试" }, 429);
      }
      const body = await req.json().catch(() => ({}));
      if (!(await checkPassword(cred, String(body.password || "")))) {
        return json({ ok: false, error: "密码错误" }, 401);
      }
      await clearRateLimit(env, ip);
      const token = await signToken(cred);
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; ` +
                        `SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
        },
      });
    }

    if (path === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    if (path === "/") {
      if (!authed) return html(renderLogin());
      const state = await env.KV.get(K_STATE, "json");
      const token = await signToken(cred);
      const pushToken = await env.KV.get(K_PUSH);
      const protonCred = await env.KV.get(K_PROTON, "json");
      let windUsage = null;
      const wa = await env.KV.get(K_WIND, "json");
      if (wa && wa.sessionAuthHash) {
        try { windUsage = await fetchSession(wa); } catch { windUsage = null; }
      }
      const jkMeta = await env.KV.get(K_JK_META, "json");
      const epCustom = await getCustomEndpoints(env);
      return html(renderUI(state, url.host, subPath, token, cred,
                           pushToken, protonCred, windUsage,
                           { jkEnabled: settings.jkEnabled, jkMeta },
                           { endpoints: epCustom.list, meta: epCustom.meta }));
    }

    if (!authed) return notFound();

    if (path === "/api/state") {
      return json((await env.KV.get(K_STATE, "json")) || {});
    }

    if (path === "/api/endpoints" && req.method === "GET") {
      const custom = await getCustomEndpoints(env);
      return json({ ok: true, endpoints: custom.list, meta: custom.meta });
    }

    if (path === "/api/endpoints/clear" && req.method === "POST") {
      await env.KV.delete(K_EP);
      await env.KV.delete(K_EP_META);
      try { await rebuild(env); } catch { /* ignore */ }
      return json({ ok: true, msg: "已清空优选接入点，恢复内置列表" });
    }

    if (path === "/api/proton/token" && req.method === "POST") {
      const t = crypto.randomUUID().replace(/-/g, "") +
                crypto.randomUUID().replace(/-/g, "");
      await env.KV.put(K_PUSH, t);
      return json({ ok: true, token: t, msg: "令牌已更新，旧的立即失效" });
    }

    if (path === "/api/proton/clear" && req.method === "POST") {
      await env.KV.delete(K_PROTON);
      try { await rebuild(env); } catch { /* */ }
      return json({ ok: true, msg: "Proton 凭据已清除" });
    }

    if (path === "/api/sub-path" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const p = normalizePath(body.path);
      if (!p) {
        return json({
          ok: false,
          error: "只能用字母数字和 - _，1-64 位，且不能是 login/logout/api/setup",
        }, 400);
      }
      await env.KV.put(K_SET, JSON.stringify({ ...settings, subPath: p }));
      return json({ ok: true, msg: `订阅路径已改为 /${p}` });
    }

    if (path === "/api/jia-kuan" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const on = !!body.enabled;
      await env.KV.put(K_SET, JSON.stringify({ ...settings, jkEnabled: on }));
      if (!on) {
        await env.KV.delete(K_JK);
        await env.KV.delete(K_JK_META);
        return json({ ok: true, msg: "家宽链式已关闭" });
      }
      try {
        await ensureJiaKuan(env, { force: true });
        const meta = await env.KV.get(K_JK_META, "json");
        return json({
          ok: true,
          msg: `家宽链式已开启，${meta?.landings || 0} 条落地`,
          meta,
        });
      } catch (e) {
        return json({ ok: false, error: "开启失败：" + e.message }, 500);
      }
    }

    if (path === "/api/jia-kuan/refresh" && req.method === "POST") {
      if (!settings.jkEnabled) {
        return json({ ok: false, error: "家宽链式未开启" }, 400);
      }
      try {
        await ensureJiaKuan(env, { force: true });
        const meta = await env.KV.get(K_JK_META, "json");
        return json({ ok: true, msg: `已刷新，${meta?.landings || 0} 条落地`, meta });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (path === "/api/refresh" && req.method === "POST") {
      try {
        const st = await rebuild(env);
        return json({ ok: true, msg: "已刷新", state: st });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (path === "/api/reset-warp" && req.method === "POST") {
      try {
        const st = await rebuild(env, { forceWarp: true });
        return json({ ok: true, msg: "WARP 已重注册", state: st });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (path === "/api/password" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!(await checkPassword(cred, String(body.oldPassword || "")))) {
        return json({ ok: false, error: "原密码错误" }, 401);
      }
      const pw = String(body.newPassword || "");
      if (pw.length < 8) return json({ ok: false, error: "新密码至少 8 位" }, 400);
      const c = await makeCred(pw);
      await env.KV.put(K_CRED, JSON.stringify(c));
      const token = await signToken(c);
      return new Response(JSON.stringify({ ok: true, msg: "密码已改，旧链接全部失效" }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; ` +
                        `SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
        },
      });
    }

    if (path === "/api/wind/clear" && req.method === "POST") {
      await env.KV.delete(K_WIND);
      try { await rebuild(env); } catch { /* */ }
      return json({ ok: true, msg: "已清除，重跑一次流水线拿新账号" });
    }

    return notFound();
  },
};
