"use client";

import Image from "next/image";
import brandMark from "@/app/assets/new-logo.jpeg";

type BrandMarkProps = {
  size?: number;
  priority?: boolean;
};

export default function BrandMark({ size = 44, priority = false }: BrandMarkProps) {
  return (
    <span
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        overflow: "hidden",
        borderRadius: "999px",
        flexShrink: 0
      }}
    >
      <Image
        src={brandMark}
        alt="6esk"
        width={brandMark.width}
        height={brandMark.height}
        priority={priority}
        style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
      />
    </span>
  );
}
