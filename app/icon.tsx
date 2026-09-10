import { ImageResponse } from "next/og";

// Favicon gerado via next/og (nenhuma dependência nova, PNG real em build-time).
// Fundo near-black + símbolo em signal — testado visualmente na malha de
// 16px: simplificado pra 2 formas, sem detalhe fino. Ver docs/PITCHAT_BRAND.md §4.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
          <path d="M9 6H20A4 4 0 0 1 24 10V13A4 4 0 0 1 20 17H9V6Z" fill="#F2B441" />
          <rect x="9" y="6" width="5" height="21" rx="2.5" fill="#F2B441" />
          <path d="M9 22L3.2 27.8L9 26V22Z" fill="#F2B441" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
