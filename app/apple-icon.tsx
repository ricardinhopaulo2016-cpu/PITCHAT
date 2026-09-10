import { ImageResponse } from "next/og";

// Apple touch icon (180x180) — mesma lógica do app/icon.tsx, tamanho maior
// pra home screen do iOS. Ver docs/PITCHAT_BRAND.md §4.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0E0F0D",
        }}
      >
        <svg width="112" height="112" viewBox="0 0 32 32" fill="none">
          <path d="M9 6H20A4 4 0 0 1 24 10V13A4 4 0 0 1 20 17H9V6Z" fill="#F2B441" />
          <rect x="9" y="6" width="5" height="21" rx="2.5" fill="#F2B441" />
          <path d="M9 22L3.2 27.8L9 26V22Z" fill="#F2B441" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
