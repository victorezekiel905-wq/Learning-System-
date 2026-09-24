"use client";
import { useEffect } from "react";

/**
 * WCAG 2.1.1: content that scrolls sideways (wide tables on phones, the screen
 * strip) must be reachable by keyboard. Any such region that actually overflows
 * gets tabindex="0" and a name, so keyboard users can focus it and scroll with arrows.
 */
export function KeyboardScroll() {
  useEffect(() => {
    let timer: number | undefined;
    const mark = () => {
      document.querySelectorAll<HTMLElement>(".table, .overflow-x-auto, [data-scroll-region]").forEach((el) => {
        const scrolls = el.scrollWidth > el.clientWidth + 1;
        if (scrolls && !el.hasAttribute("tabindex")) {
          el.tabIndex = 0;
          el.dataset.kbdScroll = "1";
          // Never override an element's own role (e.g. a tab list that scrolls on phones).
          if (!el.hasAttribute("role") && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && el.tagName !== "TABLE") {
            el.setAttribute("role", "region");
            el.setAttribute("aria-label", "Scrollable content");
            el.dataset.kbdRole = "1";
          }
        } else if (!scrolls && el.dataset.kbdScroll) {
          el.removeAttribute("tabindex");
          delete el.dataset.kbdScroll;
          if (el.dataset.kbdRole) { el.removeAttribute("role"); el.removeAttribute("aria-label"); delete el.dataset.kbdRole; }
        }
      });
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(mark, 150); };
    mark();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => { mo.disconnect(); window.removeEventListener("resize", schedule); window.clearTimeout(timer); };
  }, []);
  return null;
}
