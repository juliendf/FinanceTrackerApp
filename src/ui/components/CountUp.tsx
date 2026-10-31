/**
 * Integer count-up used by the dashboard tiles.
 *
 * The source's script targets `.stat-number span`, which its own template never
 * renders, so the animation never ran there; the brief asks for it. It runs
 * only when the `enable_animations` setting is on and the OS has not asked for
 * reduced motion, and it settles on the exact value.
 */

import { useEffect, useState } from "react";
import { useSettings } from "../../lib/useSettings";

const STEPS = 50;
const STEP_MS = 20;

export function CountUp({ value }: { value: number }) {
  const { settings } = useSettings();
  const animate =
    settings.enable_animations !== false &&
    !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [shown, setShown] = useState(animate ? 0 : value);

  useEffect(() => {
    if (!animate || value <= 0) {
      setShown(value);
      return;
    }
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      if (step >= STEPS) {
        setShown(value);
        clearInterval(timer);
      } else {
        setShown(Math.floor((value * step) / STEPS));
      }
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [value, animate]);

  return <>{shown}</>;
}
