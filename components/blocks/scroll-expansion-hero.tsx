"use client";

import React, { useMemo, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

type ScrollExpandMediaProps = {
  mediaType?: "video" | "image";
  mediaSrc: string;
  bgImageSrc?: string;
  posterSrc?: string;
  title: string;
  date?: string;
  scrollToExpand?: string;
  textBlend?: boolean;
  children?: React.ReactNode;
};

export function ScrollExpandMedia({
  mediaType = "video",
  mediaSrc,
  bgImageSrc,
  posterSrc,
  title,
  date,
  scrollToExpand,
  textBlend = true,
  children,
}: ScrollExpandMediaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });

  const scale = useTransform(scrollYProgress, [0, 0.5], [0.84, 1]);
  const radius = useTransform(scrollYProgress, [0, 0.5], [24, 0]);
  const brightness = useTransform(scrollYProgress, [0, 0.5], [0.72, 1]);

  const blendMode = useMemo<React.CSSProperties>(() => {
    return textBlend ? { mixBlendMode: "screen" } : {};
  }, [textBlend]);

  return (
    <section
      ref={containerRef}
      style={{
        background: "#000",
        color: "#fff",
        minHeight: "220vh",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <motion.div
          style={{
            position: "absolute",
            inset: 0,
            margin: 24,
            borderRadius: radius,
            overflow: "hidden",
            background: "#000",
            scale,
            filter: brightness,
            boxShadow: "0 16px 50px rgba(0,0,0,0.45)",
            transformOrigin: "center center",
          }}
        >
          {bgImageSrc ? (
            <img
              src={bgImageSrc}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.2,
                pointerEvents: "none",
              }}
            />
          ) : null}

          {mediaType === "video" && !videoFailed ? (
            <video
              autoPlay
              muted
              loop
              playsInline
              poster={posterSrc}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              onError={() => setVideoFailed(true)}
            >
              <source src={mediaSrc} type="video/mp4" />
            </video>
          ) : (
            <img
              src={posterSrc || "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1920"}
              alt="Dubai skyline"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}

          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.68) 65%, rgba(0,0,0,0.92) 100%)",
            }}
          />

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              textAlign: "center",
              padding: "0 24px 36px",
              pointerEvents: "none",
            }}
          >
            {date ? (
              <div
                style={{
                  fontSize: 14,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: 10,
                  color: "#fff",
                  opacity: 0.9,
                  ...blendMode,
                }}
              >
                {date}
              </div>
            ) : null}
            <h1
              style={{
                fontFamily: "Playfair Display, serif",
                fontSize: "clamp(36px, 6vw, 86px)",
                fontWeight: 900,
                lineHeight: 1.08,
                color: "#fff",
                marginBottom: 14,
                ...blendMode,
              }}
            >
              {title}
            </h1>
            {scrollToExpand ? (
              <p
                style={{
                  fontFamily: "Source Serif 4, serif",
                  fontSize: 16,
                  color: "rgba(255,255,255,0.8)",
                  ...blendMode,
                }}
              >
                {scrollToExpand}
              </p>
            ) : null}
          </div>
        </motion.div>
      </div>

      <div style={{ position: "relative", zIndex: 2, marginTop: "92vh", padding: "80px 0 120px" }}>{children}</div>
    </section>
  );
}
