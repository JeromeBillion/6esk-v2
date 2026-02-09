"use client";

import Image from "next/image";
import brandMark from "@/app/assets/6esklogo1.png";

type BrandMarkProps = {
  size?: number;
  priority?: boolean;
};

export default function BrandMark({ size = 44, priority = false }: BrandMarkProps) {
  return (
    <Image
      src={brandMark}
      alt="6esk"
      width={brandMark.width}
      height={brandMark.height}
      priority={priority}
      style={{ width: size, height: "auto", display: "block" }}
    />
  );
}
