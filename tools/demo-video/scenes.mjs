const lines = (items, start, step) =>
  items
    .map(
      (html, i) => `<div style="animation-delay:${(start + i * step).toFixed(2)}s">${html}</div>`,
    )
    .join("");
const LOCK =
  '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const SERVER =
  '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>';
const KEY =
  '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2"/></svg>';
const SEAL =
  '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const ARROW = (delay) =>
  `<svg class="arw"><path d="M2 12H120" style="animation-delay:${delay}s"/><path d="M112 5L127 12L112 19Z" style="animation-delay:${delay + 0.5}s"/></svg>`;
const LAPTOP =
  '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/></svg>';

export function scenes(vi) {
  const t = (en, v) => (vi ? v : en);
  return {
    model: `<div class="ttl">${t("Zero-knowledge, <b>by design.</b>", "Zero-knowledge, <b>từ thiết kế.</b>")}</div>
      <p class="sub2">${t("Your secrets are encrypted on your device. 7key only ever stores ciphertext.", "Secret được mã hoá trên máy bạn. 7key chỉ lưu bản mã.")}</p>
      <div class="zk stg">
        <div class="node"><span class="step">01 ${t("ENCRYPT", "MÃ HOÁ")}</span><div class="ic">${LOCK}</div><strong>${t("Your device", "Máy của bạn")}</strong><span>AES-256-GCM</span><div class="val">STRIPE_KEY=sk_live_51N…</div></div>
        <div class="lane">${ARROW(0.35)}<span class="pkt">a8f3…e91c</span></div>
        <div class="node srv"><span class="step">02 ${t("STORE", "LƯU")}</span><div class="ic">${SERVER}</div><strong>${t("7key cloud", "Cloud 7key")}</strong><span>${t("No keys, ever", "Không bao giờ giữ khoá")}</span><div class="val enc">a8f3c0…9d41e91c</div></div>
        <div class="lane">${ARROW(0.85)}<span class="pkt" style="animation-delay:1.5s">a8f3…e91c</span></div>
        <div class="node"><span class="step">03 ${t("DECRYPT", "GIẢI MÃ")}</span><div class="ic">${LAPTOP}</div><strong>${t("Your team", "Nhóm của bạn")}</strong><span>${t("Only members with the key", "Chỉ ai có khoá")}</span><div class="val">STRIPE_KEY=sk_live_51N…</div></div>
      </div>`,
    team: `<div class="ttl">${t("One key per team, <b>sealed for each member.</b>", "Mỗi nhóm một khoá, <b>niêm phong cho từng người.</b>")}</div>
      <div class="dia" style="width:1180px;height:470px;margin-top:22px" data-links="org>t1:v:0.35; org>t2:v:0.35; t1>p1:v:0.75; t1>p2:v:0.75; t2>p3:v:0.75; k>m1:h:1.35:1.75; k>m2:h:1.45:1.95; k>m3:h:1.55:2.15">
        <template class="tokt">${KEY}</template>
        <span class="hd" style="left:0">${t("Structure", "Cấu trúc")}</span>
        <span class="hd" style="left:640px;animation-delay:1s">${t("Team key", "Khoá của nhóm")}</span>
        <div class="split" style="left:600px;animation-delay:1s"></div>
        <div class="n" data-id="org" style="left:180px;top:44px;width:200px"><small>${t("Organization", "Tổ chức")}</small>Northwind</div>
        <div class="n hl" data-id="t1" style="left:30px;top:178px;width:210px;animation-delay:.45s"><small>${t("Team", "Nhóm")}</small>Platform</div>
        <div class="n" data-id="t2" style="left:320px;top:178px;width:210px;animation-delay:.45s"><small>${t("Team", "Nhóm")}</small>Mobile</div>
        <div class="n" data-id="p1" style="left:0;top:318px;width:180px;animation-delay:.85s"><small>${t("Project", "Dự án")}</small>Payments API<div class="envs"><i>Dev</i><i>Staging</i><i>Prod</i></div></div>
        <div class="n" data-id="p2" style="left:190px;top:318px;width:180px;animation-delay:.85s"><small>${t("Project", "Dự án")}</small>Web App<div class="envs"><i>Dev</i><i>Staging</i><i>Prod</i></div></div>
        <div class="n" data-id="p3" style="left:380px;top:318px;width:180px;animation-delay:.85s"><small>${t("Project", "Dự án")}</small>iOS App<div class="envs"><i>Dev</i><i>Staging</i><i>Prod</i></div></div>
        <div class="n hl key" data-id="k" style="left:640px;top:166px;width:170px;height:150px;animation-delay:1.1s"><div class="kic">${KEY}</div>${t("Platform key", "Khoá Platform")}<span class="mono">AES-256</span></div>
        <div class="n mem" data-id="m1" style="left:870px;top:44px;width:310px;animation-delay:1.25s"><span class="av">O</span>Olivia<span class="sl">${SEAL}${t("Sealed with her public key", "Niêm phong bằng khoá công khai")}</span></div>
        <div class="n mem" data-id="m2" style="left:870px;top:186px;width:310px;animation-delay:1.35s"><span class="av">J</span>James<span class="sl">${SEAL}${t("Sealed with his public key", "Niêm phong bằng khoá công khai")}</span></div>
        <div class="n mem" data-id="m3" style="left:870px;top:328px;width:310px;animation-delay:1.45s"><span class="av">S</span>Sophia<span class="sl">${SEAL}${t("Sealed with her public key", "Niêm phong bằng khoá công khai")}</span></div>
        <div class="foot" style="left:640px;top:440px;animation-delay:2.6s">${t("The server only stores the sealed copies.", "Server chỉ lưu các bản đã niêm phong.")}</div>
      </div>`,
    ci: `<div class="ttl">${t("CI reads secrets. <b>Nobody pastes them.</b>", "CI tự đọc secret. <b>Không ai phải dán.</b>")}</div>
      <div class="win"><div class="bar"><i></i><i></i><i></i><strong>deploy</strong> · main · #128</div>
        <div class="lines">
          ${lines(
            [
              `<div class="step"><span class="ok">✓</span>Set up job<span class="t">1s</span></div>`,
              `<div class="step"><span class="ok">✓</span>Run Linhv14/7key-action@v1<span class="t">2s</span></div>`,
              `<div class="log"><div class="m">7key: loaded 8 values into the job environment</div></div>`,
              `<div class="step"><span class="ok">✓</span>Run ./deploy.sh<span class="t">41s</span></div>`,
            ],
            0.3,
            0.45,
          )}
        </div></div>`,
    agent: `<div class="ttl"><span class="soonb">${t("New", "Mới")}</span><span>${t("AI agents call APIs.", "AI agent gọi API.")} <b>${t("They never see the key.", "Không bao giờ thấy key.")}</b></span></div>
      <div class="mcp">$ <b>7key agent</b> --project storefront --env production -- claude</div>
      <div class="term"><div class="bar" style="display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08);color:#8a8a8a;font-size:14px"><span>●</span><span>●</span><span>●</span>&nbsp; claude — storefront</div>
        <div class="body lines">
          ${lines(
            [
              `<span class="dim">7key: Storefront / Production for claude</span>`,
              `<span class="dim">  SHOPIFY_ADMIN_TOKEN  → *.myshopify.com</span>`,
              `<span class="dim">Allow? [y/N] </span><span class="u">y</span>`,
              `<span class="p">&gt;</span> <span class="u">${t("Pull today's orders from our Shopify store", "Lấy đơn hàng hôm nay từ Shopify store")}</span>`,
              `<span class="tool">⏺ Bash</span> <span class="dim">(echo $SHOPIFY_ADMIN_TOKEN)</span>`,
              `<span class="dim">  ⎿ </span><span class="ph">7key-ph-3f9c41a0d2e8b7c1a94e0d27</span>`,
              `<span class="tool">⏺ Bash</span> <span class="dim">(curl -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_TOKEN" https://northwind.myshopify.com/admin/api/orders.json)</span>`,
              `<span class="dim">  ⎿ 200 OK</span>`,
              `<span class="dim">7key: used SHOPIFY_ADMIN_TOKEN for northwind.myshopify.com</span>`,
              `<span class="ok">✓</span> ${t('Today: <span class="num">42 orders</span>, <span class="num">$3,180.50</span>. Top seller: Linen Shirt (9).', 'Hôm nay: <span class="num">42 đơn</span>, <span class="num">$3,180.50</span>. Bán chạy nhất: Linen Shirt (9).')}`,
            ],
            0.35,
            0.38,
          )}
        </div></div>
      <div class="agents stg"><span>Claude Code</span><span>Codex</span><span>Cursor</span><span>${t("Any CLI", "Mọi CLI")}</span></div>`,
  };
}
