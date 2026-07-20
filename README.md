# Online Resume | Guan Kaixiang

An online resume and portfolio site for an AI Product Manager, showcasing project experience, reusable skills, and interactive demos.

## Overview

This repository contains my personal online resume website. It is designed for HR, interviewers, and collaborators to quickly understand:

- My AI product project experience
- My reusable product skills and methodologies
- My Vibe Coding and AI application demos

## Main Pages

- `index.html`
  Main resume homepage

- `skill_library.html`
  Skill library page with downloadable and viewable skill packages

- `vibe_coding_apps.html`
  Vibe Coding application hub

- `vibe_llm_paradigms.html`
  LLM paradigm showcase page

## Local Preview

If you only want to preview static pages, you can open the HTML files directly in a browser.

If you want to use the AI chat assistant on the resume homepage, you need to start the local Node server:

```bash
node server.js
```

Then visit:

```text
http://127.0.0.1:8788/index.html
```

## AI Chat Assistant

The AI chat assistant on `index.html` depends on a local backend endpoint:

- `POST /api/chat`

This endpoint is provided by `server.js`. It will try Coze first, and if Coze fails it can fall back to a locally configured OpenAI-compatible model.

Important:

- Do not upload `.env` to GitHub
- Do not expose your PAT / API secrets in a public repository

## GitHub Pages Deployment

This project can be deployed to GitHub Pages as a static site for online preview.

Suitable for GitHub Pages:

- `index.html` static resume content
- `skill_library.html`
- `vibe_coding_apps.html`
- `vibe_llm_paradigms.html`
- static assets such as `图片/`, `skill/`, `downloads/`

Not supported directly by GitHub Pages:

- `server.js`
- local `/api/chat` backend
- `.env` secrets

That means:

- The website pages can be published online
- The AI chat assistant will not work on GitHub Pages unless you deploy the backend separately

## Recommended Public Upload Scope

Recommended files/folders to upload:

- `index.html`
- `skill_library.html`
- `vibe_coding_apps.html`
- `vibe_llm_paradigms.html`
- `图片/`
- `skill/`
- `downloads/`
- `README.md`

Recommended files not to upload:

- `.env`
- `server.js`

## Author

Guan Kaixiang  
AI Product Manager
