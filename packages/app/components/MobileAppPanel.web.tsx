import { useEffect, useState } from "react";
import * as QRCode from "qrcode";

import { getAuthProviders, mintSessionToken } from "@/lib/api";
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

  // On a hub with no OAuth, a phone that opens the bare address lands on a
  // login screen with nothing to press. So the code carries the session of
  // whoever is looking at it — this panel is only ever shown to someone
  // signed in — and scanning it is signing in. With OAuth configured the
  // phone can sign in on its own, and the code stays a plain address.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAuthProviders()
      .then((providers) => (providers.link ? mintSessionToken() : null))
      .then((result) => {
        if (!cancelled && result) setSessionToken(result.token);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const encoded = sessionToken
    ? `${shareUrl.trim().replace(/\/+$/, "")}/?token=${sessionToken}`
    : shareUrl.trim();

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
    QRCode.toString(encoded, {
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
  }, [shareUrl, encoded]);

  return (
    <div>
      <div
        style={{ fontSize: 11, color: colors.foregroundMuted, marginBottom: 12 }}
      >
        Scan this code with your phone's camera and the hub opens in its
        browser, signed in. In the Android app, tap "Scan the code instead" on
        its first screen and point it here — same result, with native
        notifications.
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

          {sessionToken && (
            <div
              style={{
                fontSize: 11,
                color: colors.foreground,
                opacity: 0.8,
                marginTop: 8,
              }}
            >
              This hub has no GitHub or Google sign-in, so the code also carries
              your session: scanning it signs the phone in as you. Treat it like
              a password.
            </div>
          )}

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
            href="https://offdesk.dev/apk/release"
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
