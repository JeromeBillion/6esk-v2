"use client";

import { useEffect, useRef, useState } from "react";

type BlurRevealTextProps = {
  text: string;
  className?: string;
  animateBy?: "words" | "letters";
  delayMs?: number;
  direction?: "top" | "bottom";
  wrap?: boolean;
};

export default function BlurRevealText({
  text,
  className,
  animateBy = "words",
  delayMs = 120,
  direction = "top",
  wrap = true
}: BlurRevealTextProps) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const segments = animateBy === "letters" ? text.split("") : text.split(" ");

  return (
    <p
      ref={ref}
      className={className}
      style={{
        display: "flex",
        flexWrap: wrap ? "wrap" : "nowrap",
        whiteSpace: wrap ? undefined : "nowrap",
        gap: animateBy === "words" ? "0.22em" : "0.02em"
      }}
    >
      {segments.map((segment, index) => (
        <span
          key={`${segment}-${index}`}
          style={{
            display: "inline-block",
            opacity: visible ? 1 : 0,
            filter: visible ? "blur(0px)" : "blur(12px)",
            transform: visible
              ? "translate3d(0,0,0)"
              : `translate3d(0,${direction === "top" ? "-42px" : "42px"},0)`,
            transitionProperty: "opacity, transform, filter",
            transitionDuration: "860ms",
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: `${index * delayMs}ms`,
            willChange: "opacity, transform, filter"
          }}
        >
          {segment}
          {animateBy === "words" && index < segments.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </p>
  );
}
