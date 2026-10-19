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
const LAPTOP =
  '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/></svg>';

export function scenes(vi) {
  const t = (en, v) => (vi ? v : en);
  return {
    model: `<div class="ttl">${t("Zero-knowledge, <b>by design.</b>", "Zero-knowledge, <b>từ thiết kế.</b>")}</div>
      <p class="sub2">${t("Your secrets are encrypted on your device. 7key only ever stores ciphertext.", "Secret được mã hoá trên máy bạn. 7key chỉ lưu bản mã.")}</p>
      <div class="zk stg">
        <div class="node"><span class="step">01 ${t("ENCRYPT", "MÃ HOÁ")}</span><div class="ic">${LOCK}</div><strong>${t("Your device", "Máy của bạn")}</strong><span>AES-256-GCM</span><div class="val">STRIPE_KEY=sk_live_51N…</div></div>
        <div class="lane"><span class="pkt">a8f3…e91c</span></div>
        <div class="node srv"><span class="step">02 ${t("STORE", "LƯU")}</span><div class="ic">${SERVER}</div><strong>${t("7key cloud", "Cloud 7key")}</strong><span>${t("No keys, ever", "Không bao giờ giữ khoá")}</span><div class="val enc">a8f3c0…9d41e91c</div></div>
        <div class="lane"><span class="pkt" style="animation-delay:.8s">a8f3…e91c</span></div>
        <div class="node"><span class="step">03 ${t("DECRYPT", "GIẢI MÃ")}</span><div class="ic">${LAPTOP}</div><strong>${t("Your team", "Team của bạn")}</strong><span>${t("Only members with the key", "Chỉ ai có khoá")}</span><div class="val">STRIPE_KEY=sk_live_51N…</div></div>
      </div>`,
    team: `<div class="ttl">${t("One key per team, <b>sealed for each member.</b>", "Mỗi team một khoá, <b>niêm phong cho từng người.</b>")}</div>
      <div class="tree stg">
        <div class="box"><small>${t("Organization", "Tổ chức")}</small>Northwind</div>
        <div class="arrow">→</div>
        <div class="col"><div class="box hl"><small>Team</small>Platform</div><div class="box"><small>Team</small>Mobile</div></div>
        <div class="arrow">→</div>
        <div class="col"><div class="box"><small>${t("Project", "Dự án")}</small>Payments API<div class="envs"><i>Dev</i><i>Staging</i><i>Prod</i></div></div></div>
        <div class="arrow">↔</div>
        <div class="members"><div class="mem"><b>O</b>olivia@northwind.dev<em>🔒 sealed</em></div><div class="mem"><b>J</b>james@northwind.dev<em>🔒 sealed</em></div><div class="mem"><b>S</b>sophia@northwind.dev<em>🔒 sealed</em></div></div>
      </div>`,
    ci: `<div class="ttl">${t("CI reads secrets. <b>Nobody pastes them.</b>", "CI tự đọc secret. <b>Không ai phải dán.</b>")}</div>
      <div class="win"><div class="bar"><i></i><i></i><i></i><strong>deploy</strong> · main · #128</div>
        <div class="lines">
          ${lines(
            [
              `<div class="step"><span class="ok">✓</span>Set up job<span class="t">1s</span></div>`,
              `<div class="step"><span class="ok">✓</span>Run Linhv14/7key-action@v1<span class="t">2s</span></div>`,
              `<div class="log"><div class="g">✓ ${t("Verified", "Đã xác minh")} northwind/payments-api @ refs/heads/main (GitHub OIDC)</div></div>`,
              `<div class="log"><div class="g">✓ ${t("Loaded 8 values from", "Đã nạp 8 giá trị từ")} Production</div></div>`,
              `<div class="log"><div class="m">STRIPE_SECRET_KEY=<span class="a">***</span>   DATABASE_URL=<span class="a">***</span></div></div>`,
              `<div class="step"><span class="ok">✓</span>Run ./deploy.sh<span class="t">41s</span></div>`,
            ],
            0.4,
            0.55,
          )}
        </div></div>`,
    agent: `<div class="ttl"><span class="soonb">${t("New", "Mới")}</span><span>${t("AI agents call APIs.", "AI agent gọi API.")} <b>${t("They never see the key.", "Không bao giờ thấy key.")}</b></span></div>
      <div class="mcp">$ <b>7key agent</b> --project Storefront --env production -- claude &nbsp;<span class="ok" style="color:#ff6a3d">✓ SHOPIFY_ADMIN_TOKEN → *.myshopify.com</span></div>
      <div class="term"><div class="bar" style="display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08);color:#8a8a8a;font-size:14px"><span>●</span><span>●</span><span>●</span>&nbsp; claude — storefront</div>
        <div class="body lines">
          ${lines(
            [
              `<span class="p">&gt;</span> <span class="u">${t("Pull today's orders from our Shopify store", "Lấy đơn hàng hôm nay từ Shopify store")}</span>`,
              `<span class="tool">⏺ Bash</span> <span class="dim">(echo $SHOPIFY_ADMIN_TOKEN)</span>`,
              `<span class="dim">  ⎿ </span><span class="ph">7key-ph-3f9c41a0d2e8</span><span class="dim"> · ${t("a placeholder, not the token", "chỉ là placeholder, không phải token")}</span>`,
              `<span class="tool">⏺ Bash</span> <span class="dim">(curl -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_TOKEN" https://northwind.myshopify.com/admin/api/orders.json)</span>`,
              `<span class="dim">  ⎿ 200 OK · ${t("7key swapped in the real token on the way out", "7key thay token thật trên đường gửi đi")}</span>`,
              `<span class="ok">✓</span> ${t('Today: <span class="num">42 orders</span>, <span class="num">$3,180.50</span>. Top seller: Linen Shirt (9).', 'Hôm nay: <span class="num">42 đơn</span>, <span class="num">$3,180.50</span>. Bán chạy nhất: Linen Shirt (9).')}`,
            ],
            0.5,
            0.7,
          )}
        </div></div>
      <div class="agents stg"><span>Claude Code</span><span>Codex</span><span>Cursor</span><span>${t("Any CLI", "Mọi CLI")}</span></div>`,
  };
}
