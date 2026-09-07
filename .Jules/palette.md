## 2026-09-07 - [Readability Contrast]
**Learning:** Subtle custom themes often fail minimum contrast for muted text (e.g., `--ink-3` against `--paper` was 3.1:1), and fixing this requires tweaking the hex codes slightly to meet the WCAG 4.5:1 threshold. Also, disabled opacities around .35-.45 are sometimes visually too light and hard to read, standardizing on .5 improves readability.
**Action:** Always check muted text colors and disabled element opacities against background colors to ensure they meet minimum contrast ratios of at least 4.5:1 in custom design systems.
