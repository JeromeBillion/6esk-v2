"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type ShowcaseItem = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  preview: ReactNode;
};

type CardStackShowcaseProps = {
  items: ShowcaseItem[];
  className?: string;
};

const SLOT_STYLES = [
  { x: 0, y: 0, scale: 1, opacity: 1, rotate: -1.4, zIndex: 5 },
  { x: 28, y: 26, scale: 0.96, opacity: 0.88, rotate: 1.8, zIndex: 4 },
  { x: 54, y: 50, scale: 0.92, opacity: 0.72, rotate: -1.1, zIndex: 3 },
  { x: 76, y: 74, scale: 0.88, opacity: 0.56, rotate: 2.1, zIndex: 2 }
] as const;

export default function CardStackShowcase({ items, className }: CardStackShowcaseProps) {
  const [order, setOrder] = useState(() => items.map((_, index) => index));
  const [paused, setPaused] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setOrder(items.map((_, index) => index));
  }, [items]);

  useEffect(() => {
    if (paused || items.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setOrder((previous) => {
        if (previous.length < 2) {
          return previous;
        }
        const [first, ...rest] = previous;
        return [...rest, first];
      });
    }, 4600);

    return () => window.clearInterval(timer);
  }, [items.length, paused]);

  const visibleOrder = useMemo(() => order.slice(0, Math.min(order.length, SLOT_STYLES.length)), [order]);

  return (
    <div
      className={className}
      style={{ position: "relative", minHeight: 620, perspective: 1600 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setTilt({ x: 0, y: 0 });
      }}
    >
      {items.map((item, index) => {
        const slotIndex = visibleOrder.indexOf(index);
        if (slotIndex === -1) {
          return null;
        }

        const slot = SLOT_STYLES[slotIndex];
        const isFront = slotIndex === 0;
        const rotateX = isFront ? tilt.x : 0;
        const rotateY = isFront ? tilt.y : 0;

        return (
          <article
            key={item.id}
            onMouseMove={(event) => {
              if (!isFront) {
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const offsetX = (event.clientX - rect.left) / rect.width - 0.5;
              const offsetY = (event.clientY - rect.top) / rect.height - 0.5;
              setTilt({ x: offsetY * -8, y: offsetX * 10 });
            }}
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate3d(${slot.x}px, ${slot.y}px, 0) scale(${slot.scale}) rotate(${slot.rotate}deg) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
              transformOrigin: "center center",
              transition: "transform 900ms cubic-bezier(0.16, 1, 0.3, 1), opacity 720ms ease, box-shadow 720ms ease",
              opacity: slot.opacity,
              zIndex: slot.zIndex,
              borderRadius: 32,
              border: "1px solid rgba(16, 18, 22, 0.12)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(246,243,237,0.98) 100%)",
              boxShadow: isFront
                ? "0 40px 120px rgba(13, 16, 24, 0.16)"
                : "0 22px 60px rgba(13, 16, 24, 0.11)",
              overflow: "hidden",
              willChange: "transform, opacity"
            }}
          >
            <div
              style={{
                display: "grid",
                height: "100%",
                gridTemplateRows: "auto 1fr",
                background:
                  "radial-gradient(circle at top right, rgba(94,134,255,0.12), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.8), rgba(255,255,255,0.66))"
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  borderBottom: "1px solid rgba(16, 18, 22, 0.1)",
                  padding: "1rem 1.2rem"
                }}
              >
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.68rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "rgba(24, 27, 35, 0.52)"
                    }}
                  >
                    {item.eyebrow}
                  </p>
                  <h3 style={{ margin: "0.45rem 0 0", fontSize: "1.15rem", color: "#111318", lineHeight: 1.2 }}>
                    {item.title}
                  </h3>
                </div>
                <div style={{ color: "rgba(24, 27, 35, 0.54)", fontSize: "0.84rem", maxWidth: 220, textAlign: "right" }}>
                  {item.summary}
                </div>
              </header>
              <div style={{ padding: "1.2rem", display: "grid" }}>{item.preview}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
