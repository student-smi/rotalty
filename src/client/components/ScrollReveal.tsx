import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type RevealDirection = "up" | "down" | "left" | "right" | "fade" | "scale";

export interface ScrollRevealProps {
  children: ReactNode;
  direction?: RevealDirection;
  delay?: number; // ms
  duration?: number; // ms
  distance?: number; // px
  className?: string;
  as?: keyof HTMLElementTagNameMap;
  once?: boolean;
}

export function ScrollReveal({
  children,
  direction = "up",
  delay = 0,
  duration = 700,
  distance = 32,
  className = "",
  as: Component = "div",
  once = true,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // If reduced motion is preferred, immediately show
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(el);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -40px 0px",
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [once]);

  let transformInit = "none";
  if (direction === "up") transformInit = `translate3d(0, ${distance}px, 0)`;
  else if (direction === "down") transformInit = `translate3d(0, -${distance}px, 0)`;
  else if (direction === "left") transformInit = `translate3d(${distance}px, 0, 0)`;
  else if (direction === "right") transformInit = `translate3d(-${distance}px, 0, 0)`;
  else if (direction === "scale") transformInit = "scale(0.94)";

  const style: CSSProperties = {
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? "none" : transformInit,
    transition: `opacity ${duration}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
    transitionDelay: `${delay}ms`,
    willChange: isVisible ? "auto" : "opacity, transform",
  };

  const Tag = Component as any;

  return (
    <Tag ref={ref} style={style} className={className}>
      {children}
    </Tag>
  );
}

/** Sticky / top scroll progress indicator */
export function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const total = document.documentElement.scrollHeight - window.innerHeight;
          if (total > 0) {
            setProgress(Math.min(100, Math.max(0, (window.scrollY / total) * 100)));
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-transparent overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-brand-600 via-indigo-500 to-purple-500 transition-all duration-100 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
