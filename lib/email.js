// Email sending via Resend. Renders an editorial HTML analysis email.

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM    = process.env.RESEND_FROM    || "hello@tintandtinge.com";
const REPLYTO = process.env.RESEND_REPLY_TO || "hello@tintandtinge.com";
const BUSINESS_NAME    = process.env.BUSINESS_NAME    || "Tint and Tinge";
const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || "Address pending";
const SUPPORT_EMAIL    = process.env.BUSINESS_SUPPORT_EMAIL || "hello@tintandtinge.com";
const APP_URL          = process.env.APP_URL || "https://tintandtinge.com";

export async function sendAnalysisEmail({ to, name, result, orderRef }) {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping send");
    return { id: "dry-run-no-key" };
  }
  const html = renderAnalysisHtml({ name, result, orderRef });
  const subject = `${name ? name + ", y" : "Y"}our color season is ${result.season}`;
  const r = await resend.emails.send({
    from: `Tint & Tinge <${FROM}>`,
    to,
    replyTo: REPLYTO,
    subject,
    html,
  });
  return r;
}

// ---------------- TEMPLATE ----------------
// Email-safe HTML — table-based layout, inline styles, hex colors.

const CREAM    = "#faf6f1";
const CREAM_2  = "#f3ece2";
const QUOTE_BG = "#f3e3d6";
const LINE     = "#e6dcce";
const INK      = "#3a352e";
const ACCENT   = "#6b574a";
const MUTED    = "#8a7f73";
const ROSE_DEEP= "#b9776f";

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function swatchCell(name, hex) {
  return `<td valign="top" align="center" width="80" style="padding:4px;">
    <table cellpadding="0" cellspacing="0" border="0" width="72" style="background:${hex};border:1px solid ${LINE};border-radius:8px;">
      <tr><td align="center" height="60" style="height:60px;">&nbsp;</td></tr>
    </table>
    <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:${INK};margin-top:6px;">${esc(name)}</div>
    <div style="font-family:Arial,sans-serif;font-size:9.5px;color:${MUTED};">${hex.toUpperCase()}</div>
  </td>`;
}

function renderRow(items, cols = 6) {
  let html = "";
  for (let i = 0; i < items.length; i += cols) {
    html += `<tr>`;
    for (let j = 0; j < cols; j++) {
      const idx = i + j;
      if (idx < items.length) html += swatchCell(items[idx][0], items[idx][1]);
      else html += `<td width="80">&nbsp;</td>`;
    }
    html += `</tr>`;
  }
  return html;
}

function avoidRow(name, hex, reason) {
  return `<tr>
    <td valign="top" width="60" style="padding:10px;">
      <table cellpadding="0" cellspacing="0" border="0" width="40" style="background:${hex};border-radius:6px;">
        <tr><td height="40">&nbsp;</td></tr>
      </table>
    </td>
    <td valign="middle" style="padding:10px 0;font-family:Georgia,serif;">
      <div style="font-size:16px;font-weight:600;color:${INK};">${esc(name)}</div>
      <div style="font-family:Arial,sans-serif;font-size:13px;color:${MUTED};margin-top:2px;">${esc(reason)}</div>
    </td>
    <td valign="middle" align="right" style="padding:10px;font-family:Arial,sans-serif;font-size:11px;color:${MUTED};">${hex.toUpperCase()}</td>
  </tr>`;
}

function metalSwatches(hexes) {
  return hexes.map((h) => `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${h};border:1px solid ${LINE};margin-right:4px;vertical-align:middle;"></span>`).join("");
}

export function renderAnalysisHtml({ name, result, orderRef }) {
  const greet = name ? `Hello ${esc(name.split(" ")[0])},` : "Hello,";
  const palette = result.data.palette;
  const neutrals = result.data.neutrals;
  const avoid = result.data.avoid;
  const meta = result.data;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Color Analysis — Tint &amp; Tinge</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM};">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:18px;overflow:hidden;">

      <!-- header -->
      <tr><td style="padding:24px 32px;border-bottom:1px solid ${LINE};">
        <table width="100%"><tr>
          <td style="font-family:Georgia,serif;font-size:18px;color:${INK};">Tint &amp; Tinge</td>
          <td align="right" style="font-family:Arial,sans-serif;font-size:11px;color:${MUTED};">Ref ${esc(orderRef)}</td>
        </tr></table>
      </td></tr>

      <!-- hero -->
      <tr><td align="center" style="padding:48px 32px 32px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:3px;color:${ROSE_DEEP};font-weight:700;text-transform:uppercase;margin-bottom:14px;">${greet} Your season is</div>
        <div style="font-family:Georgia,serif;font-size:48px;line-height:1.1;color:${INK};margin-bottom:12px;">${esc(result.season)}</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:17px;color:${ACCENT};">${esc(meta.tagline)}</div>
        <div style="margin-top:20px;display:inline-block;background:${CREAM_2};border-radius:999px;padding:8px 18px;font-family:Arial,sans-serif;font-size:13px;color:${ACCENT};">
          Confidence <strong style="color:${INK};margin-left:6px;">${result.confidence}%</strong>
        </div>
      </td></tr>

      <!-- palette -->
      <tr><td style="padding:0 24px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;color:${ROSE_DEEP};font-weight:700;text-transform:uppercase;padding:0 8px;">Your palette</div>
        <div style="font-family:Georgia,serif;font-size:24px;color:${INK};padding:6px 8px 8px;">Eighteen colors that were always yours.</div>
        <div style="font-family:Arial,sans-serif;font-size:13px;color:${ACCENT};padding:0 8px 16px;line-height:1.5;">Each chosen for how it harmonizes with your features. Wear these confidently — in clothing, accessories, makeup, and your home.</div>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">${renderRow(palette, 6)}</table>
      </td></tr>

      <tr><td style="height:30px;"></td></tr>

      <!-- neutrals -->
      <tr><td style="padding:0 24px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;color:${ROSE_DEEP};font-weight:700;text-transform:uppercase;padding:0 8px;">Foundation neutrals</div>
        <div style="font-family:Georgia,serif;font-size:22px;color:${INK};padding:6px 8px 16px;">Build your wardrobe on these.</div>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">${renderRow(neutrals, 5)}</table>
      </td></tr>

      <tr><td style="height:30px;"></td></tr>

      <!-- avoid -->
      <tr><td style="padding:0 32px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;color:${ROSE_DEEP};font-weight:700;text-transform:uppercase;">Use sparingly</div>
        <div style="font-family:Georgia,serif;font-size:22px;color:${INK};margin:6px 0 16px;">Colors to keep at arm's length.</div>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
          ${avoid.map(([n,h,r]) => avoidRow(n, h, r)).join("")}
        </table>
      </td></tr>

      <tr><td style="height:30px;"></td></tr>

      <!-- style edit -->
      <tr><td style="padding:0 32px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;color:${ROSE_DEEP};font-weight:700;text-transform:uppercase;">Your style edit</div>
        <div style="font-family:Georgia,serif;font-size:22px;color:${INK};margin:6px 0 16px;">Tailored guidance.</div>

        <div style="background:${CREAM};border:1px solid ${LINE};border-radius:12px;padding:20px;margin-bottom:12px;">
          <div style="font-family:Arial,sans-serif;font-size:9px;color:${ROSE_DEEP};font-weight:700;letter-spacing:2px;text-transform:uppercase;">Metals</div>
          <div style="font-family:Georgia,serif;font-size:17px;color:${INK};font-weight:600;margin:4px 0 8px;">${esc(meta.metals.title)}</div>
          <div style="font-family:Arial,sans-serif;font-size:13px;color:${ACCENT};line-height:1.55;">${esc(meta.metals.text)}</div>
          <div style="margin-top:12px;">${metalSwatches(meta.metals.swatches)}</div>
        </div>

        <div style="background:${CREAM};border:1px solid ${LINE};border-radius:12px;padding:20px;margin-bottom:12px;">
          <div style="font-family:Arial,sans-serif;font-size:9px;color:${ROSE_DEEP};font-weight:700;letter-spacing:2px;text-transform:uppercase;">Prints &amp; patterns</div>
          <div style="font-family:Georgia,serif;font-size:17px;color:${INK};font-weight:600;margin:4px 0 8px;">${esc(meta.prints.title)}</div>
          <div style="font-family:Arial,sans-serif;font-size:13px;color:${ACCENT};line-height:1.55;">${esc(meta.prints.text)}</div>
        </div>

        <div style="background:${CREAM};border:1px solid ${LINE};border-radius:12px;padding:20px;">
          <div style="font-family:Arial,sans-serif;font-size:9px;color:${ROSE_DEEP};font-weight:700;letter-spacing:2px;text-transform:uppercase;">Makeup edit</div>
          <div style="font-family:Georgia,serif;font-size:17px;color:${INK};font-weight:600;margin:4px 0 8px;">${esc(meta.makeup.title)}</div>
          <div style="font-family:Arial,sans-serif;font-size:13px;color:${ACCENT};line-height:1.55;">${esc(meta.makeup.text)}</div>
          <div style="margin-top:12px;">${metalSwatches(meta.makeup.swatches)}</div>
        </div>
      </td></tr>

      <tr><td style="height:30px;"></td></tr>

      <!-- meaning -->
      <tr><td style="padding:0 32px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${QUOTE_BG};border-radius:14px;">
          <tr><td style="padding:28px 32px;">
            <div style="font-family:Georgia,serif;font-size:48px;line-height:0;color:${ROSE_DEEP};">&ldquo;</div>
            <div style="font-family:Georgia,serif;font-style:italic;font-size:16px;line-height:1.55;color:${INK};">${esc(meta.meaning)}</div>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="height:30px;"></td></tr>

      <tr><td align="center" style="padding:0 32px 32px;">
        <a href="${APP_URL}" style="display:inline-block;background:#2a2823;color:${CREAM};padding:14px 28px;border-radius:999px;font-family:Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;">Save this email or visit your dashboard</a>
      </td></tr>

      <!-- footer -->
      <tr><td style="background:${CREAM};padding:24px 32px;border-top:1px solid ${LINE};text-align:center;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:${MUTED};">With warmth, the Tint &amp; Tinge team</div>
        <div style="font-family:Arial,sans-serif;font-size:11px;color:${MUTED};margin-top:14px;line-height:1.6;">
          ${esc(BUSINESS_NAME)} · ${esc(BUSINESS_ADDRESS)}<br>
          Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:${ROSE_DEEP};">${SUPPORT_EMAIL}</a> · <a href="${APP_URL}/refund" style="color:${ROSE_DEEP};">7-day refund</a> · <a href="${APP_URL}/privacy" style="color:${ROSE_DEEP};">Privacy</a>
          <br><br>
          This is a digital approximation, not a substitute for in-person draping with a certified analyst.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
