# Auto Etsy SEO UI Guidelines

These guidelines keep the control panel consistent with the brand personality described in `backend/CORE_SUMMARY.md`: a locally run, experiment-focused tool that feels like a modern SaaS dashboard but retains the warmth and craft of an Etsy stationery studio.

## Guiding Principles
- **Confident but friendly**: Use crisp layouts and micro-interactions that feel modern while allowing color, typography, and copy to express a hand-crafted tone.
- **Legible experimentation**: Every state change (syncing, testing, evaluating) should be easy to scan; reserve bold treatments for truly important metrics or warnings.
- **Left-hand navigation**: All primary workflows (Sync, Listings, Experiments, Reports, Insights, Logs) live inside a persistent left rail so users can hop between jobs without scrolling.
- **Light theme with character**: Favor bright neutrals, generous whitespace, and subtle textures/shadows so the app reads as airy rather than stark.

## Color System
| Role | Color | Usage |
| --- | --- | --- |
| Primary Accent | `#0573bb` | Buttons, active nav item, focus outlines, links. Set hover to `#0a8bdf`, disabled to `#89c6e9`. |
| Surface Background | `#f4f7fb` | Page background. Consider a faint diagonal noise texture (1–2% opacity) to avoid a sterile feel. |
| Panel/Base | `#ffffff` | Cards, forms, tables, log area. Apply subtle shadow `0 6px 18px rgba(5, 115, 187, 0.08)`. |
| Borders/Dividers | `#d7e1ed` | Form inputs, table borders, rail separators. |
| Text Primary | `#1f2a37` | Body copy, labels. |
| Text Secondary | `#4c5d73` | Descriptions, helper text. |
| Success | `#1b9e5f` | Positive evaluations, “kept” states. |
| Warning | `#f2a141` | Pending actions, low confidence. |
| Error | `#c23a3a` | Failed requests, validation errors. |

Keep contrast ratio ≥4.5:1 for body text. When combining accent color with white, supplement with bold Georgia typography so emphasis feels intentional rather than purely chromatic.

## Typography
- **Headings / Emphasis**: `font-family: "Georgia", "Times New Roman", serif; font-weight: 700`. Apply to panel titles, section headers, and bold metrics (e.g., delta percentages). Use tight letter-spacing (-0.2px) for large headings to keep them sharp.
- **Body / UI Labels**: Clean sans-serif stack such as `"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-weight: 400–600`. This maintains readability in dense forms.
- **Hierarchy**:
  - H1 (page title in main content): 28px/36px, Georgia, accent-colored underline.
  - H2 (panel titles): 20px/28px, Georgia, text color `#1f2a37`.
  - Body copy: 15–16px/24px sans-serif.
  - Small labels/help text: 13px/18px sans-serif, text secondary color.
- **Bold usage**: Reserve Georgia bold for callouts such as “Testing”, “Kept”, “Reverted” badges or KPIs in the log.

## Layout & Spacing
- **Grid**: 12-column fluid grid with 24px gutters. Minimum content width 320px.
- **Left Navigation Rail**:
  - Fixed width 240px on desktop, collapsible to icons at ≤960px.
  - Background `#ffffff`, subtle right border `#d7e1ed`.
  - Include logo (see below), system status, and nav items grouped with 16px padding.
- **Main Content**:
  - Top bar with current shop ID + base URL indicator.
  - Stack sections vertically with 32px spacing; each panel uses 24px internal padding.
  - Responsive breakpoints: at ≤720px, panels become full-width stacked, nav rail converts to slide-out drawer toggled via hamburger button.
- **Spacing scale**: 8px base unit (8, 16, 24, 32, 48). Ensure forms align to this rhythm for visual coherence.

## Component Guidance
- **Navigation Links**: Row height 44px, left-aligned icon + label. Active link uses `#0573bb` background at 10% opacity and bold Georgia text.
- **Primary Buttons**: Accent background, white text, 12px radius. Hover state lifts via translateY(-1px). Secondary buttons use outline style (1px accent border, transparent background) with sans-serif medium weight.
- **Forms**:
  - Inputs have 2px border `#d7e1ed`, 8px radius, 12px vertical padding.
  - Focus ring: `0 0 0 3px rgba(5, 115, 187, 0.25)`.
  - Group related controls in Georgia-labeled fieldsets to reduce scanning friction.
- **Cards & Tables**:
  - Use Georgia headings for card titles, body text in sans-serif.
  - Alternate table rows with subtle fill `#f9fbfe` to improve readability.
  - Experiment states displayed as colored badges (success, warning, error palette).
- **Log Panel**:
  - Monospaced style optional for JSON, but maintain sans-serif for labels.
  - Each log entry card uses accent-colored top border to show recency.
- **Notifications & Toasts**: Slide up from bottom right; iconography should be thin outline style to keep the interface light.

## Interactions & Tone
- Micro-animations last 150–200ms with `cubic-bezier(0.4, 0, 0.2, 1)` easing.
- Tooltips explain Etsy-specific terms; copy should be conversational but succinct (“Need to sync listing snapshots first? Hit Sync above.”).
- Error states use Georgia bold headings plus error color to ensure they stand out without overwhelming the UI.

## Logo Usage
- File: `src/assets/logo.svg`. Place at the top of the left navigation rail with 24px padding.
- Minimum display width 140px; maintain clear space equal to the height of the letter “A” in the mark.
- Logo should sit on white or very light surfaces; if overlaying on accent color, add 8px rounded white pill container.

## Accessibility & Implementation Notes
- Ensure keyboard navigation covers the nav rail, all form controls, and log actions.
- Provide status text (aria-live “polite”) for async operations like sync or report generation.
- When using Georgia for bold callouts, include semantic markup (`<strong>`, `<h*>`) so screen readers carry the emphasis beyond visual styling.
- Import fonts locally or via reliable CDNs; define CSS variables for colors and spacing to keep tweaks centralized.

By following this document, the frontend will read as a cohesive, modern dashboard that still hints at the artistry of the Etsy shop it serves.
