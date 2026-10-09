// 界面沿用 cfnew 的赛博朋克终端风：青/品红霓虹、等宽字体、扫描线。
const CSS = `
:root{
  --bg:#05030e; --bg2:#0a0820;
  --cyan:#00f0ff; --pink:#ff2bd6; --purple:#a347ff;
  --yellow:#fff200; --mint:#00ff9d; --red:#ff3860;
  --text:#e6f5ff; --dim:#7aa9c4;
  --border:rgba(0,240,255,.55); --grid:rgba(255,43,214,.16);
}
*{margin:0;padding:0;box-sizing:border-box}
html{overflow-x:hidden}
html,body{min-height:100%}
body{
  font-family:"JetBrains Mono","Fira Code","Courier New",
    "PingFang SC","Microsoft YaHei","Noto Sans SC",monospace;
  background:radial-gradient(ellipse at 20% 10%,#2a0040 0%,var(--bg) 55%,#000 100%);
  color:var(--text);
  padding:32px 16px 56px;
  display:flex;justify-content:center;
  position:relative;overflow-x:hidden;
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    linear-gradient(var(--grid) 1px,transparent 1px) 0 0/44px 44px,
    linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/44px 44px;
  opacity:.5;
}
body::after{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:1;
  background:repeating-linear-gradient(180deg,rgba(0,240,255,.05) 0 1px,transparent 1px 4px);
}
.term{
  min-width:0;overflow:hidden;
  border:1px solid var(--border);
  background:rgba(8,4,28,.86);
  box-shadow:0 0 24px rgba(0,240,255,.14),inset 0 0 60px rgba(163,71,255,.07);
}
.head{
  display:flex;align-items:center;gap:12px;
  padding:12px 16px;border-bottom:1px solid var(--border);
  background:linear-gradient(90deg,rgba(255,43,214,.16),rgba(0,240,255,.16));
}
.dots{display:flex;gap:8px}
.dot{width:11px;height:11px;transform:rotate(45deg);background:var(--pink);box-shadow:0 0 8px var(--pink)}
.dot:nth-child(2){background:var(--yellow);box-shadow:0 0 8px var(--yellow)}
.dot:nth-child(3){background:var(--mint);box-shadow:0 0 8px var(--mint)}
.title{
  color:var(--cyan);font-size:13px;font-weight:700;
  letter-spacing:.25em;text-transform:uppercase;text-shadow:0 0 6px var(--cyan);
}
.title::before{content:"// ";color:var(--pink)}
.body{padding:22px 20px;min-width:0}
input{
  background:rgba(0,0,0,.45);
  border:1px solid var(--border);color:var(--cyan);
  font-family:inherit;font-size:12px;padding:11px 12px;outline:none;
  text-shadow:0 0 4px var(--cyan);
}
input:focus{border-color:var(--pink);box-shadow:0 0 12px rgba(255,43,214,.4)}
button{
  font-family:inherit;font-size:12px;letter-spacing:.12em;text-transform:uppercase;
  padding:11px 18px;cursor:pointer;
  background:transparent;border:1px solid var(--pink);color:var(--pink);
  text-shadow:0 0 6px var(--pink);transition:.15s;white-space:nowrap;
}
button:hover{background:var(--pink);color:#05030e;text-shadow:none;box-shadow:0 0 16px var(--pink)}
button.gh{border-color:var(--cyan);color:var(--cyan);text-shadow:0 0 6px var(--cyan)}
button.gh:hover{background:var(--cyan);color:#05030e;box-shadow:0 0 16px var(--cyan)}
button:disabled{opacity:.4;cursor:not-allowed}
#msg{margin-top:10px;font-size:12px;min-height:18px}
`;

/** KV 没绑时的指引页。报错要能自己解决，别只丢个栈。 */
export function renderNoKV() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:520px;position:relative;z-index:2;min-width:0;align-self:center}
.step{font-size:12px;color:var(--dim);line-height:2;margin-top:6px}
.step b{color:var(--cyan);font-weight:400}
.step code{color:var(--yellow)}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">KV Not Bound</div>
  </div>
  <div class="body">
    <div class="step">
      还没绑 KV，配置和密码都没地方存。<br><br>
      <b>1.</b> Cloudflare 后台 → 存储和数据库 → KV → 创建实例<br>
      <b>2.</b> 回到这个 Worker → 设置 → 绑定 → 添加 → KV 命名空间<br>
      <b>3.</b> 变量名填 <code>KV</code>（两个字母，大写），命名空间选刚建的<br>
      <b>4.</b> 部署，刷新本页
    </div>
  </div>
</div></div></body></html>`;
}

/** 首次访问的初始化页，设管理密码。 */
export function renderSetup() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:430px;position:relative;z-index:2;min-width:0;align-self:center}
.f{display:flex;flex-direction:column;gap:10px}
.hint{font-size:11px;color:var(--dim);line-height:1.9;margin-top:14px}
.hint b{color:var(--yellow);font-weight:400}
.lead{font-size:12px;color:var(--cyan);line-height:1.8;margin-bottom:16px}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">First Run</div>
  </div>
  <div class="body">
    <div class="lead">第一次打开，先设一个管理密码。<br>之后订阅路径、改密码都在界面里做。</div>
    <form class="f" onsubmit="return go(event)">
      <input type="password" id="p" placeholder="PASSWORD (>= 8)" autofocus autocomplete="new-password">
      <input type="password" id="c" placeholder="CONFIRM" autocomplete="new-password">
      <button type="submit">设置</button>
    </form>
    <div id="msg"></div>
    <div class="hint">
      密码只存哈希（PBKDF2 + 随机盐），KV 里看不到明文。<br>
      <b>忘了只能删掉 KV 里的 auth:cred 重来</b>，没有找回。
    </div>
  </div>
</div></div>
<script>
async function go(e){
  e.preventDefault();
  const b=document.querySelector('button'), m=document.getElementById('msg');
  b.disabled=true; m.textContent='> 设置中…'; m.style.color='var(--yellow)';
  try{
    const r=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:document.getElementById('p').value,
                           confirm:document.getElementById('c').value})});
    const j=await r.json();
    if(j.ok){m.textContent='> 完成';m.style.color='var(--mint)';location.reload();}
    else{m.textContent='> '+j.error;m.style.color='var(--red)';b.disabled=false;}
  }catch(err){m.textContent='> '+err.message;m.style.color='var(--red)';b.disabled=false;}
  return false;
}
</script>
</body></html>`;
}

/** 登录页。密码错时不提示"用户名错误"这类可枚举信息。 */
export function renderLogin(err) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:400px;position:relative;z-index:2;min-width:0;align-self:center}
.f{display:flex;flex-direction:column;gap:12px}
.hint{font-size:11px;color:var(--dim);line-height:1.8;margin-top:14px}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">Auth Required</div>
  </div>
  <div class="body">
    <form class="f" onsubmit="return go(event)">
      <input type="password" id="p" placeholder="PASSWORD" autofocus autocomplete="current-password">
      <button type="submit">进入</button>
    </form>
    <div id="msg"></div>
    <div class="hint">连续失败 8 次会锁定 15 分钟。</div>
  </div>
</div></div>
<script>
async function go(e){
  e.preventDefault();
  const b=document.querySelector('button'), m=document.getElementById('msg');
  b.disabled=true; m.textContent='> 验证中…'; m.style.color='var(--yellow)';
  try{
    const r=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({password:document.getElementById('p').value})});
    const j=await r.json();
    if(j.ok){m.textContent='> 通过';m.style.color='var(--mint)';location.reload();}
    else{m.textContent='> '+j.error;m.style.color='var(--red)';b.disabled=false;}
  }catch(err){m.textContent='> '+err.message;m.style.color='var(--red)';b.disabled=false;}
  return false;
}
</script>
</body></html>`;
}

export function renderUI(state, host, sp, token, cred, pushToken, protonCred, windUsage, jk = {}, ep = {}) {
  const s = state || {};
  const warp = s.warp || {};
  const stat = s.stats || {};
  const updated = s.updatedAt ? new Date(s.updatedAt) : null;
  const ago = updated ? Math.floor((Date.now() - updated.getTime()) / 60000) : null;
  const exp = s.expiresAt ? new Date(s.expiresAt) : null;
  const left = exp ? Math.floor((exp.getTime() - Date.now()) / 60000) : null;
  const leftTxt = left === null ? "—"
    : left <= 0 ? "已过期，下次访问订阅时自动重建"
    : `${Math.floor(left / 60)} 小时 ${left % 60} 分后过期`;
  const fmt = (d) => d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
  const sub = `https://${host}${sp}?token=${token}`;
  const jkSub = `https://${host}${sp}?token=${token}&target=jk`;
  const jkEnabled = !!(jk && jk.jkEnabled);
  const jkMeta = (jk && jk.jkMeta) || null;
  const pushUrl = pushToken ? `https://${host}/push/${pushToken}` : "";
  const pExp = protonCred && protonCred.expiresAt
    ? new Date(protonCred.expiresAt * 1000) : null;
  const windInfo = s.wind || null;
  const windPct = windUsage && windUsage.max
    ? Math.round((windUsage.used / windUsage.max) * 100) : 0;
  const gb = (n) => (n / 1073741824).toFixed(2) + " GB";
  const windUsageTxt = windUsage && windUsage.max
    ? `${gb(windUsage.used)} / ${gb(windUsage.max)}（${windPct}%）` : null;
  const pLeft = pExp ? Math.floor((pExp.getTime() - Date.now()) / 86400000) : null;

  const row = (k, v, cls = "") =>
    `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPERA // MASQUE</title>
<style>${CSS}
.wrap{width:100%;max-width:880px;position:relative;z-index:2;min-width:0}
.sec{margin-bottom:26px;min-width:0}
.sec:last-child{margin-bottom:0}
.sec-t{
  color:var(--pink);font-size:11px;letter-spacing:.22em;text-transform:uppercase;
  margin-bottom:12px;text-shadow:0 0 6px var(--pink);
}
.sec-t::before{content:"▍";color:var(--cyan);margin-right:6px}
.row{
  display:flex;justify-content:space-between;align-items:baseline;gap:16px;
  padding:7px 0;border-bottom:1px dashed rgba(0,240,255,.14);font-size:13px;
}
.row:last-child{border-bottom:none}
.k{color:var(--dim);letter-spacing:.06em;white-space:nowrap}
.v{color:var(--cyan);text-align:right;word-break:break-all}
.v.ok{color:var(--mint);text-shadow:0 0 6px var(--mint)}
.v.warn{color:var(--yellow);text-shadow:0 0 6px var(--yellow)}
.v.err{color:var(--red);text-shadow:0 0 6px var(--red)}
.grid{display:grid;min-width:0;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.cell{
  border:1px solid rgba(0,240,255,.3);padding:12px 14px;
  background:rgba(0,240,255,.04);min-width:0;
}
.cell .n{font-size:26px;font-weight:700;color:var(--cyan);text-shadow:0 0 10px var(--cyan);line-height:1.1}
.cell .l{font-size:10px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase;margin-top:6px;
  overflow-wrap:anywhere}
.sub{display:flex;gap:8px;align-items:stretch;margin-top:4px;flex-wrap:wrap}
.sub input{flex:1;min-width:0}
.pw{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:4px}
.pw input{min-width:0}
@media(max-width:700px){.pw{grid-template-columns:1fr}}
.note{font-size:11px;color:var(--dim);line-height:1.85;margin-top:12px;
  overflow-wrap:anywhere;word-break:break-word}
.note b{color:var(--yellow);font-weight:400}
.foot{
  margin-top:18px;text-align:center;font-size:10px;color:var(--dim);
  letter-spacing:.2em;text-transform:uppercase;
}
.foot a{color:var(--purple);text-decoration:none}
.foot a:hover{color:var(--pink)}
.head{position:relative}
.out{
  margin-left:auto;font-size:10px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--dim);text-decoration:none;border:1px solid rgba(122,169,196,.4);
  padding:4px 10px;transition:.15s;
}
.out:hover{color:var(--red);border-color:var(--red);text-shadow:0 0 6px var(--red)}
@media(max-width:560px){
  body{padding:18px 10px 40px}
  .row{flex-direction:column;gap:2px;font-size:12px}
  .v{text-align:left}
  .sub{flex-direction:column}
  button{width:100%}
  .grid{grid-template-columns:1fr 1fr;gap:8px}
  .body{padding:16px 12px}
  .note{letter-spacing:0;font-size:11px}
  .title{font-size:10px;letter-spacing:.12em}
  .k,.v{letter-spacing:0}
  .cell .n{font-size:22px}
  .cell .l{letter-spacing:.08em;font-size:9px}
  .sec-t{letter-spacing:.14em}
}
@media(max-width:360px){
  .grid{grid-template-columns:1fr}
}
</style></head>
<body><div class="wrap"><div class="term">
  <div class="head">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="title">Opera over MASQUE</div>
    <a class="out" href="/logout">退出</a>
  </div>
  <div class="body">

    <div class="sec">
      <div class="sec-t">订阅</div>
      <div class="sub">
        <input id="u" value="${sub}" readonly>
        <button onclick="cp('u')">复制</button>
        <button class="gh" onclick="location.href=document.getElementById('u').value">下载</button>
      </div>
      <div class="note">
        一份聚合，导进去有两类线路可切：<br>
        <b>亚洲/欧洲/美洲线路</b> — 走 MASQUE 再落 Opera，能换出口国家，但多一跳会慢些。<br>
        <b>WARP直连</b> — 只走 MASQUE，出口是 Cloudflare 自己的 IP，快但选不了国家。<br>
        <b>Proton线路</b> — MASQUE 打底 + Proton WireGuard 落地，10 个国家（配置后出现）。<br>
        <b>Windscribe线路</b> — MASQUE 打底 + Windscribe 落地，13 个地区，有香港（配置后出现）。<br>
        套娃线路超时或落地挂了，切 WARP直连顶上。
      </div>
      <div id="msg"></div>
    </div>

    <div class="sec">
      <div class="sec-t">家宽链式</div>
      ${row("状态", jkEnabled ? "已开启" : "未开启", jkEnabled ? "ok" : "warn")}
      ${jkEnabled && jkMeta ? row("落地节点", `${jkMeta.landings || 0} 条（缓存至 ${fmt(jkMeta.expiresAt ? new Date(jkMeta.expiresAt) : null)}）`, "ok") : ""}
      ${jkEnabled ? `
      <div class="sub" style="margin-top:10px">
        <input id="jk" value="${jkSub}" readonly>
        <button onclick="cp('jk')">复制</button>
        <button class="gh" onclick="location.href=document.getElementById('jk').value">下载</button>
      </div>
      ` : ""}
      <div class="sub" style="margin-top:10px">
        <button onclick="jkToggle(${jkEnabled ? "false" : "true"})">${jkEnabled ? "关闭家宽链式" : "开启家宽链式"}</button>
        ${jkEnabled ? `<button class="gh" onclick="go('/api/jia-kuan/refresh')">刷新家宽节点</button>` : ""}
      </div>
      <div class="note">
        MASQUE 当前置，落地换成 <a href="https://www.vpngate.net/cn/" target="_blank" rel="noopener" style="color:var(--cyan)">VPN Gate</a>
        志愿者共享的家庭宽带，出网是住宅 IP（日本、韩国居多）。<br>
        开启后订阅地址加 <code>?target=jk</code> 即为家宽专属订阅。<br>
        节点掉线正常，客户端用「🏠 家宽自动」会自己往下换。需要 mihomo（openvpn + dialer-proxy）。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">优选接入点</div>
      ${row("自定义条数", (ep.endpoints && ep.endpoints.length) ? String(ep.endpoints.length) : "0（仅内置）",
             (ep.endpoints && ep.endpoints.length) ? "ok" : "")}
      ${ep.meta && ep.meta.updatedAt ? row("最近提交", ep.meta.updatedAt.replace("T"," ").slice(0,19)+" UTC", "ok") : ""}
      ${ep.meta && ep.meta.mode ? row("合并模式", ep.meta.mode, "") : ""}
      <div class="note">
        内置含 WARP MASQUE IP 段 + <code>masque*.bestcf.eu.cc</code> 域名。<br>
        本地优选后可 <b>POST</b> 到推送地址末尾加 <code>/endpoints</code> 远程提交：<br>
        <code>POST ${pushUrl ? pushUrl+"/endpoints" : "https://你的worker/push/&lt;令牌&gt;/endpoints"}</code><br>
        Body JSON：<code>{"endpoints":["162.159.198.1:443","masque.bestcf.eu.cc:443"],"mode":"prefer","replace":true}</code><br>
        mode：<code>merge</code>（默认，内置+自定义）/ <code>prefer</code>（自定义优先）/ <code>only</code>（仅自定义）。
        ${(ep.endpoints && ep.endpoints.length) ? '<br><a href="#" onclick="go(\'/api/endpoints/clear\');return false" style="color:var(--red)">清空自定义，恢复内置</a>' : ""}
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">节点</div>
      <div class="grid">
        <div class="cell"><div class="n">${stat.combos ?? "—"}</div><div class="l">组合节点</div></div>
        <div class="cell"><div class="n">${stat.entries ?? "—"}</div><div class="l">MASQUE 接入点</div></div>
        <div class="cell"><div class="n">${stat.landings ?? "—"}</div><div class="l">Opera 落地</div></div>
        <div class="cell"><div class="n">${stat.entries ?? "—"}</div><div class="l">WARP 直连</div></div>
        <div class="cell"><div class="n">${stat.proton || "—"}</div><div class="l">Proton 落地</div></div>
        <div class="cell"><div class="n">${stat.wind || "—"}</div><div class="l">Windscribe 落地</div></div>
      </div>
      <div class="note">
        每个落地和每个接入点都组合一遍，任一环失效都还有别的路走。<br>
        节点名 <b>欧洲1@198.1-443</b> = 欧洲第 1 个落地，经 162.159.198.1:443 接入。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">状态</div>
      ${row("上次更新", updated ? `${fmt(updated)}（${ago} 分钟前）` : "尚未生成",
             updated ? (ago > 250 ? "warn" : "ok") : "err")}
      ${row("凭据剩余", leftTxt, left === null ? "" : left <= 0 ? "warn" : "ok")}
      ${row("到期时间", fmt(exp))}
      ${row("密码更新于", cred && cred.updatedAt ? fmt(new Date(cred.updatedAt)) : "—")}
      ${row("WARP 设备", warp.deviceId ? warp.deviceId.slice(0, 8) + "…" : "—")}
      ${row("WARP 注册于", warp.registeredAt ? fmt(new Date(warp.registeredAt)) : "—")}
      ${row("内网地址", warp.ipv4 || "—")}
    </div>

    <div class="sec">
      <div class="sec-t">操作</div>
      <div class="sub">
        <button onclick="go('/api/refresh')">刷新 Opera 凭据</button>
        <button class="gh" onclick="go('/api/reset-warp')">重注册 WARP 设备</button>
      </div>
      <div class="note">
        Opera 凭据 4 小时到期。<b>不用定时任务</b>——订阅被访问时才检查，
        没过期直接给缓存，过期了才重新注册。<br>
        想提前换一份就点刷新。<br>
        WARP 设备信息存在 KV 里复用，<b>一般不用重注册</b>，除非 MASQUE 整体连不上。
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Proton 落地</div>
      ${protonCred ? `
      <div class="row"><span class="k">状态</span><span class="v ok">已配置 ${
        protonCred.servers.length} 台</span></div>
      <div class="row"><span class="k">证书剩余</span><span class="v ${
        pLeft <= 1 ? "warn" : "ok"}">${pLeft} 天（${
        pExp.toISOString().slice(0, 10)} 到期）</span></div>
      ` : `
      <div class="row"><span class="k">状态</span><span class="v warn">未配置</span></div>
      `}
      <div class="note" style="margin-top:10px">
        推送地址（流水线用）：
        ${pushUrl ? `<code style="word-break:break-all">${pushUrl}</code>` : "未生成"}
        <br>
        <button onclick="go('/api/proton/token')" style="margin-top:8px">${pushToken ? "换一个令牌" : "生成推送令牌"}</button>
        ${protonCred ? `<button class="gh" onclick="go('/api/proton/clear')">清除 Proton</button>` : ""}
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">Windscribe 落地</div>
      ${windInfo ? `
      ${row("状态", `已配置 ${windInfo.servers || 0} 台`, "ok")}
      ${windUsageTxt ? row("用量", windUsageTxt, windPct > 90 ? "warn" : "ok") : ""}
      ` : `
      ${row("状态", s.windErr ? "失败：" + s.windErr : "未配置", s.windErr ? "err" : "warn")}
      `}
      <div class="sub" style="margin-top:10px">
        ${windInfo ? `<button class="gh" onclick="go('/api/wind/clear')">清除账号</button>` : ""}
      </div>
      <div class="note">由 GitHub Actions 开户后 POST 到推送地址 <code>/wind</code> 后缀。</div>
    </div>

    <div class="sec">
      <div class="sec-t">订阅路径</div>
      <div class="sub">
        <input id="sp" value="${sp.replace(/^\//,"")}" placeholder="sub">
        <button onclick="setPath()">修改</button>
      </div>
    </div>

    <div class="sec">
      <div class="sec-t">改密码</div>
      <div class="pw">
        <input type="password" id="op" placeholder="原密码" autocomplete="current-password">
        <input type="password" id="np" placeholder="新密码" autocomplete="new-password">
        <input type="password" id="cp" placeholder="确认" autocomplete="new-password">
        <button onclick="setPw()">提交</button>
      </div>
    </div>

    <div class="foot">OPERA // MASQUE · <a href="https://github.com/lucaslml0/warp-masque-actions" target="_blank" rel="noopener">GitHub</a></div>
  </div>
</div></div>
<script>
function cp(id){
  const el=document.getElementById(id);
  navigator.clipboard.writeText(el.value).then(()=>{
    const m=document.getElementById('msg');
    if(m){m.textContent='> 已复制';m.style.color='var(--mint)';}
  });
}
async function go(path){
  const m=document.getElementById('msg');
  const bs=[...document.querySelectorAll('button')];
  bs.forEach(b=>b.disabled=true);
  if(m){m.textContent='> 处理中…';m.style.color='var(--yellow)';}
  try{
    const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const j=await r.json();
    if(j.ok){if(m){m.textContent='> '+(j.msg||'完成');m.style.color='var(--mint)';}setTimeout(()=>location.reload(),600);}
    else{if(m){m.textContent='> '+(j.error||'失败');m.style.color='var(--red)';}bs.forEach(b=>b.disabled=false);}
  }catch(e){if(m){m.textContent='> '+e.message;m.style.color='var(--red)';}bs.forEach(b=>b.disabled=false);}
}
async function jkToggle(on){
  const m=document.getElementById('msg');
  const bs=[...document.querySelectorAll('button')];
  bs.forEach(b=>b.disabled=true);
  if(m){m.textContent='> 处理中…';m.style.color='var(--yellow)';}
  try{
    const r=await fetch('/api/jia-kuan',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({enabled:!!on})});
    const j=await r.json();
    if(j.ok){if(m){m.textContent='> '+(j.msg||'完成');m.style.color='var(--mint)';}setTimeout(()=>location.reload(),600);}
    else{if(m){m.textContent='> '+(j.error||'失败');m.style.color='var(--red)';}bs.forEach(b=>b.disabled=false);}
  }catch(e){if(m){m.textContent='> '+e.message;m.style.color='var(--red)';}bs.forEach(b=>b.disabled=false);}
}
async function setPath(){
  const m=document.getElementById('msg');
  try{
    const r=await fetch('/api/sub-path',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({path:document.getElementById('sp').value})});
    const j=await r.json();
    if(j.ok){if(m){m.textContent='> '+(j.msg||'完成');m.style.color='var(--mint)';}setTimeout(()=>location.reload(),600);}
    else{if(m){m.textContent='> '+(j.error||'失败');m.style.color='var(--red)';}}
  }catch(e){if(m){m.textContent='> '+e.message;m.style.color='var(--red)';}}
}
async function setPw(){
  const m=document.getElementById('msg');
  try{
    const r=await fetch('/api/password',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({oldPassword:document.getElementById('op').value,
                           newPassword:document.getElementById('np').value,
                           confirm:document.getElementById('cp').value})});
    const j=await r.json();
    if(j.ok){if(m){m.textContent='> '+(j.msg||'完成');m.style.color='var(--mint)';}}
    else{if(m){m.textContent='> '+(j.error||'失败');m.style.color='var(--red)';}}
  }catch(e){if(m){m.textContent='> '+e.message;m.style.color='var(--red)';}}
}
</script>
</body></html>`;
}
