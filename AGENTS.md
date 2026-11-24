# AGENTS.md

## Tech Stack & Architecture Rules

- **Pure Static Frontend Only:** Build strictly with **HTML, CSS, and vanilla JavaScript**.
- **No Backend or Database:** Do NOT introduce Python, Node.js servers, PHP, databases, ORMs, or server-side APIs.
- **No Heavy Build Tooling:** Keep the app zero-build and static-host ready (e.g., GitHub Pages). Avoid adding Webpack, Vite, Next.js, or package managers unless explicitly requested.
- **Client-Side State Only:** All clinical calculations, normative value lookups, and diagnostic classifications must run synchronously in the browser via vanilla JS. Use `localStorage` only if persistence is explicitly requested.

## Domain & Clinical Logic Guardrails

- **Two Independent Modes:** Maintain clear separation between the **21-Point (Leo Manas)** view and the **BV & Accommodation (Mitchell Scheiman)** (`#scheiman`) view.
- **Sign Conventions:** Preserve standard optometric sign notation throughout calculations and UI labels:
  - Horizontal phorias: **Exophoria (`+`)**, **Orthophoria (`0`)**, **Esophoria (`−`)**.
  - Vertical phorias: **Right Hyper (`+`)**, **Ortho (`0`)**, **Left Hyper (`−`)**.
- **Real-Time Reactivity:** Every input change must immediately recalculate dependent solvers (e.g., Gradient AC/A, Sheard's Criterion, Hofstetter norms), status badges (`WNL`, `HIGH`, `LOW`, `RECEDED`), and diagnostic classification rules without requiring a page reload or submit button.
- **Preserve Reference Tables:** Never delete or alter the clinical reference matrices (Morgan's Normative Values Reference Table and Scheiman & Wick Clinical Diagnostic Summary Reference) unless explicitly instructed.

## Editing & Code Quality Guidelines

- **Minimal Diffs:** Make targeted edits to existing HTML/CSS/JS files rather than rewriting entire files from scratch.
- **Clean Event Bindings:** Whenever removing or renaming a form input or solver card, remove its corresponding JS event listeners, DOM queries, and sample-case preset assignments so there are zero runtime console errors.
- **Test Presets & Reset:** Any structural change to form inputs must keep sample case loaders and the `Reset` button working cleanly.
