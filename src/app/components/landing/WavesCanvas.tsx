"use client";

import { useEffect, useRef, type CSSProperties } from "react";

class GradientVector {
  constructor(
    public x: number,
    public y: number
  ) {}

  dot(x: number, y: number) {
    return this.x * x + this.y * y;
  }
}

class Noise2D {
  private gradients = [
    new GradientVector(1, 1),
    new GradientVector(-1, 1),
    new GradientVector(1, -1),
    new GradientVector(-1, -1),
    new GradientVector(1, 0),
    new GradientVector(-1, 0),
    new GradientVector(0, 1),
    new GradientVector(0, -1)
  ];
  private permutation = new Array<number>(512);
  private gradientPermutation = new Array<GradientVector>(512);

  constructor(seed = Math.random()) {
    const base = [
      151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69,
      142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
      203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
      74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230,
      220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76,
      132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186,
      3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59,
      227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70,
      221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178,
      185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81,
      51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115,
      121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195,
      78, 66, 215, 61, 156, 180
    ];

    let normalizedSeed = seed;
    if (normalizedSeed > 0 && normalizedSeed < 1) {
      normalizedSeed *= 65536;
    }
    let value = Math.floor(normalizedSeed);
    if (value < 256) {
      value |= value << 8;
    }

    for (let index = 0; index < 256; index += 1) {
      const derived = index & 1 ? base[index] ^ (value & 255) : base[index] ^ ((value >> 8) & 255);
      this.permutation[index] = this.permutation[index + 256] = derived;
      this.gradientPermutation[index] = this.gradientPermutation[index + 256] =
        this.gradients[derived % this.gradients.length];
    }
  }

  private fade(value: number) {
    return value * value * value * (value * (value * 6 - 15) + 10);
  }

  private mix(start: number, end: number, amount: number) {
    return (1 - amount) * start + amount * end;
  }

  perlin2(x: number, y: number) {
    let cellX = Math.floor(x);
    let cellY = Math.floor(y);
    const localX = x - cellX;
    const localY = y - cellY;

    cellX &= 255;
    cellY &= 255;

    const topLeft = this.gradientPermutation[cellX + this.permutation[cellY]].dot(localX, localY);
    const topRight = this.gradientPermutation[cellX + 1 + this.permutation[cellY]].dot(localX - 1, localY);
    const bottomLeft = this.gradientPermutation[cellX + this.permutation[cellY + 1]].dot(localX, localY - 1);
    const bottomRight = this.gradientPermutation[cellX + 1 + this.permutation[cellY + 1]].dot(
      localX - 1,
      localY - 1
    );

    const blendX = this.fade(localX);
    const blendY = this.fade(localY);

    return this.mix(this.mix(topLeft, topRight, blendX), this.mix(bottomLeft, bottomRight, blendX), blendY);
  }
}

type WavePoint = {
  x: number;
  y: number;
  waveX: number;
  waveY: number;
  cursorX: number;
  cursorY: number;
  velocityX: number;
  velocityY: number;
};

type WavesCanvasProps = {
  lineColor?: string;
  backgroundColor?: string;
  waveSpeedX?: number;
  waveSpeedY?: number;
  waveAmplitudeX?: number;
  waveAmplitudeY?: number;
  tension?: number;
  friction?: number;
  maxCursorMove?: number;
  xGap?: number;
  yGap?: number;
  className?: string;
  style?: CSSProperties;
};

export default function WavesCanvas({
  lineColor = "rgba(255,255,255,0.4)",
  backgroundColor = "transparent",
  waveSpeedX = 0.0105,
  waveSpeedY = 0.008,
  waveAmplitudeX = 32,
  waveAmplitudeY = 14,
  tension = 0.01,
  friction = 0.9,
  maxCursorMove = 120,
  xGap = 14,
  yGap = 42,
  className,
  style
}: WavesCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const noiseRef = useRef(new Noise2D(Math.random()));
  const pointsRef = useRef<WavePoint[][]>([]);
  const mouseRef = useRef({
    x: -9999,
    y: -9999,
    smoothX: -9999,
    smoothY: -9999,
    lastX: -9999,
    lastY: -9999,
    velocity: 0,
    angle: 0,
    initialized: false
  });
  const boundsRef = useRef({ width: 0, height: 0, left: 0, top: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const measure = () => {
      const bounds = container.getBoundingClientRect();
      boundsRef.current = {
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        top: bounds.top
      };
      canvas.width = bounds.width * window.devicePixelRatio;
      canvas.height = bounds.height * window.devicePixelRatio;
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
      context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    const rebuild = () => {
      const lines: WavePoint[][] = [];
      const { width, height } = boundsRef.current;
      const totalColumns = Math.ceil((width + 180) / xGap);
      const totalRows = Math.ceil((height + 60) / yGap);
      const startX = (width - xGap * totalColumns) / 2;
      const startY = (height - yGap * totalRows) / 2;

      for (let column = 0; column <= totalColumns; column += 1) {
        const points: WavePoint[] = [];
        for (let row = 0; row <= totalRows; row += 1) {
          points.push({
            x: startX + xGap * column,
            y: startY + yGap * row,
            waveX: 0,
            waveY: 0,
            cursorX: 0,
            cursorY: 0,
            velocityX: 0,
            velocityY: 0
          });
        }
        lines.push(points);
      }
      pointsRef.current = lines;
    };

    const updateMouse = (clientX: number, clientY: number) => {
      const bounds = boundsRef.current;
      const mouse = mouseRef.current;
      mouse.x = clientX - bounds.left;
      mouse.y = clientY - bounds.top;
      if (!mouse.initialized) {
        mouse.initialized = true;
        mouse.smoothX = mouse.x;
        mouse.smoothY = mouse.y;
        mouse.lastX = mouse.x;
        mouse.lastY = mouse.y;
      }
    };

    const movePoints = (time: number) => {
      const mouse = mouseRef.current;

      pointsRef.current.forEach((line) => {
        line.forEach((point) => {
          const field = noiseRef.current.perlin2(
            (point.x + time * waveSpeedX) * 0.0019,
            (point.y + time * waveSpeedY) * 0.00135
          );
          point.waveX = Math.cos(field * Math.PI * 2) * waveAmplitudeX;
          point.waveY = Math.sin(field * Math.PI * 2) * waveAmplitudeY;

          const distanceX = point.x - mouse.smoothX;
          const distanceY = point.y - mouse.smoothY;
          const distance = Math.hypot(distanceX, distanceY);
          const influenceRadius = Math.max(180, mouse.velocity * 1.6);

          if (distance < influenceRadius) {
            const strength = 1 - distance / influenceRadius;
            const force = Math.cos(distance * 0.005) * strength * mouse.velocity * 0.0012;
            point.velocityX += Math.cos(mouse.angle) * force * influenceRadius;
            point.velocityY += Math.sin(mouse.angle) * force * influenceRadius;
          }

          point.velocityX += (0 - point.cursorX) * tension;
          point.velocityY += (0 - point.cursorY) * tension;
          point.velocityX *= friction;
          point.velocityY *= friction;
          point.cursorX = Math.max(-maxCursorMove, Math.min(maxCursorMove, point.cursorX + point.velocityX));
          point.cursorY = Math.max(-maxCursorMove, Math.min(maxCursorMove, point.cursorY + point.velocityY));
        });
      });
    };

    const draw = () => {
      const { width, height } = boundsRef.current;
      context.clearRect(0, 0, width, height);
      context.beginPath();
      context.strokeStyle = lineColor;
      context.lineWidth = 1;

      pointsRef.current.forEach((line) => {
        line.forEach((point, index) => {
          const currentX = point.x + point.waveX + point.cursorX;
          const currentY = point.y + point.waveY + point.cursorY;

          if (index === 0) {
            context.moveTo(currentX, currentY);
            return;
          }
          context.lineTo(currentX, currentY);
        });
      });

      context.stroke();
    };

    const frame = (time: number) => {
      const mouse = mouseRef.current;
      if (mouse.initialized) {
        mouse.smoothX += (mouse.x - mouse.smoothX) * 0.08;
        mouse.smoothY += (mouse.y - mouse.smoothY) * 0.08;
        const deltaX = mouse.x - mouse.lastX;
        const deltaY = mouse.y - mouse.lastY;
        mouse.velocity += (Math.hypot(deltaX, deltaY) - mouse.velocity) * 0.2;
        mouse.velocity = Math.min(120, mouse.velocity);
        mouse.angle = Math.atan2(deltaY, deltaX);
        mouse.lastX = mouse.x;
        mouse.lastY = mouse.y;
      }

      movePoints(time);
      draw();
      animationRef.current = window.requestAnimationFrame(frame);
    };

    const handleResize = () => {
      measure();
      rebuild();
    };

    const handlePointerMove = (event: MouseEvent) => {
      updateMouse(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) {
        updateMouse(touch.clientX, touch.clientY);
      }
    };

    measure();
    rebuild();
    animationRef.current = window.requestAnimationFrame(frame);

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    friction,
    lineColor,
    maxCursorMove,
    tension,
    waveAmplitudeX,
    waveAmplitudeY,
    waveSpeedX,
    waveSpeedY,
    xGap,
    yGap
  ]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor,
        ...style
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
