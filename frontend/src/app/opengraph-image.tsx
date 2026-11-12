import { ImageResponse } from "next/og";
import { siteContent } from "@/content";

export const alt = siteContent.socialImage.alt;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "66px 76px",
          backgroundColor: "#F3F6F8",
          color: "#172B3A",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 29,
            fontWeight: 700,
            letterSpacing: "-1px",
          }}
        >
          {siteContent.brand}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            maxWidth: 940,
          }}
        >
          <div
            style={{
              display: "flex",
              color: "#006B64",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "2px",
            }}
          >
            {siteContent.socialImage.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 66,
              lineHeight: 1.08,
              fontWeight: 600,
              letterSpacing: "-3px",
            }}
          >
            {siteContent.hero.title}
          </div>
          <div
            style={{
              display: "flex",
              width: 84,
              height: 5,
              backgroundColor: "#006B64",
              borderRadius: 3,
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid #DCE5EA",
            paddingTop: 22,
            color: "#526575",
            fontSize: 18,
          }}
        >
          <span>{siteContent.socialImage.footerLeft}</span>
          <span>{siteContent.socialImage.footerRight}</span>
        </div>
      </div>
    ),
    size,
  );
}
