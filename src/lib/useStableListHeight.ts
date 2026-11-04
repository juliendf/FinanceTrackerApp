/**
 * Keep a paginated list the same height on every page.
 *
 * Row heights depend on their content — an asset that has a product name renders
 * a second line (`.cell-sub` is `display: block`) — so each page of a list is a
 * different height. A shorter page shrinks the block, which drags the pager up
 * and leaves a preserved scroll offset pointing at different rows, which is why
 * paging looked like it jumped around.
 *
 * Remembering the tallest page seen and using it as a floor keeps the block, and
 * everything below it, still. Nothing is reserved on a single-page list, and the
 * floor is dropped as soon as the result set or the page size changes so a new
 * filter never inherits the previous one's height.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export function useStableListHeight(
  containerRef: RefObject<HTMLElement | null>,
  resetKey: string,
): number | undefined {
  const tallest = useRef(0);
  const [floor, setFloor] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    tallest.current = 0;
    setFloor(undefined);
  }, [resetKey]);

  // No dependency array on purpose: the measurement has to happen after any
  // render that could have changed the rows. It is one rect read, and the
  // setState is guarded so it cannot loop.
  useLayoutEffect(() => {
    const table = containerRef.current?.querySelector("table");
    if (!table) return;
    const height = Math.ceil(table.getBoundingClientRect().height);
    if (height > tallest.current) {
      tallest.current = height;
      // Plus the container's 1px top and bottom border.
      setFloor(height + 2);
    }
  });

  return floor;
}
