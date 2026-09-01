import { useEffect, useState } from "react";
import * as QRCode from "qrcode";

import { colors } from "@/lib/colors";

/**
 * Getting offdesk onto a phone: the hub's address as a QR code, and where to
 * get the app.
 *
 * Shown on the onboarding page — where someone setting up a hub actually is —
 * and in Settings, which is where they will look for it later.
 */
export function MobileAppPanel() {
  // Defaults to the address this page came from, which is right whenever the
  // browser reached the hub the way a phone would, and wrong on a laptop
  // looking at localhost — so it stays editable.
  const [shareUrl, setShareUrl] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  const isLoopback = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(
    (() => {
      try {
        return new URL(shareUrl).hostname;
      } catch {
        return "";
      }
    })(),
  );

  useEffect(() => {
    let cancelled = false;
    if (!shareUrl.trim()) {
      setQrSvg(null);
      return;
    }
    QRCode.toString(shareUrl.trim(), {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      // Hex only — the theme's colours are `rgb(var(--color-…))`, which the
      // encoder rejects. Black on white also reads most reliably through a
      // phone camera, so the code sits on its own white tile rather than
      // borrowing the page's palette.
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch((error) => {
        console.error("[offdesk] could not encode the hub address", error);
        if (!cancelled) setQrSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  return (
    <div>
      <div
        style={{ fontSize: 11, color: colors.foregroundMuted, marginBottom: 12 }}
      >
        The Android app is a window onto this hub. Install it, then scan this
        code on first launch instead of typing the address. Scanning with the
        phone's own camera opens the hub in its browser, which works too.
      </div>

      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 168,
            height: 168,
            padding: 12,
            borderRadius: 8,
            background: "#ffffff",
            border: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          dangerouslySetInnerHTML={qrSvg ? { __html: qrSvg } : undefined}
        >
          {qrSvg ? undefined : (
            <span style={{ fontSize: 11, color: "#77776f" }}>no address</span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{ fontSize: 13, color: colors.foreground, marginBottom: 4 }}
          >
            Address the phone should open
          </div>
          <div
            style={{
              fontSize: 11,
              color: colors.foregroundMuted,
              marginBottom: 8,
            }}
          >
            Whatever your phone can reach — a LAN address, a tunnel hostname, a
            tailnet name.
          </div>
          <input
            type="text"
            value={shareUrl}
            onChange={(event) => setShareUrl(event.target.value)}
            placeholder="http://192.168.1.10:4317"
            style={{
              width: "100%",
              background: colors.background,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.foreground,
              padding: "8px 10px",
              fontSize: 13,
            }}
          />

          {isLoopback && (
            <div
              style={{
                fontSize: 11,
                color: colors.foreground,
                opacity: 0.8,
                marginTop: 8,
              }}
            >
              This page is open on a loopback address, which no phone can reach.
              Put the hub's LAN address or public hostname here instead.
            </div>
          )}

          <a
            href="https://github.com/zalify/offdesk/releases/latest"
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              background: colors.accent,
              borderRadius: 6,
              color: colors.background,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              marginTop: 16,
            }}
          >
            Download the APK
          </a>
          <div
            style={{
              fontSize: 11,
              color: colors.foregroundMuted,
              marginTop: 8,
            }}
          >
            Take <code>arm64-v8a</code> on a modern phone, or{" "}
            <code>universal</code> if you are unsure. Sideloading needs "install
            from unknown sources". There is no iOS build yet — on iPhone, open
            this hub in Safari.
          </div>
        </div>
      </div>
    </div>
  );
}
