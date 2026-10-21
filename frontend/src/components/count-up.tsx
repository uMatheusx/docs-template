import { animate, useInView } from "motion/react";
import { useEffect, useRef } from "react";

/** Número que anima de 0 até `value` quando entra na tela. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    const node = ref.current;
    if (!node || !inView) return;
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => (node.textContent = Math.round(v).toLocaleString("pt-BR")),
    });
    return () => controls.stop();
  }, [value, inView]);

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}
