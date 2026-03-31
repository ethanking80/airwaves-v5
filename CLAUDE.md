# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIRWAVES is a premium hemp products e-commerce store. It's a serverless full-stack app deployed on Netlify with a Neon PostgreSQL database.

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build step). Each page is a self-contained HTML file with inline `<style>` and `<script>` tags.
- **Backend**: Netlify Functions (serverless), written as ESM modules (`.mjs`).
- **Database**: Neon PostgreSQL via `@netlify/neon`. All queries use tagged template literals (`sql\`...\``).
- **Auth**: Custom token-based auth (HMAC-signed base64url payloads, not standard JWT). Token logic lives in `netlify/functions/auth.mjs`.

## Architecture

### Frontend (`public/`)

All pages are single-file HTML documents with embedded CSS and JS. No bundler, no framework.

- `index.html` - Main storefront (product browsing, cart, checkout)
- `admin.html` - Admin dashboard (products, orders, customers, finance, settings)
- `product.html` - Single product detail page
- `profile.html` - User profile/account page
- `reset-password.html` - Password reset flow

### Backend (`netlify/functions/`)

Each function is a single `.mjs` file exporting a default async handler `(req, context) => Response`. Routing within a function is done via query params (`?action=`, `?id=`) and HTTP methods, not path-based routing.

Key functions:
- `auth.mjs` - Registration, login, password reset, token verification. Exports `verifyToken()` used by other functions.
- `db-init.mjs` - Creates all database tables and seeds initial data. Hit `/api/db-init` after deploy.
- `products.mjs`, `orders.mjs`, `cart.mjs`, `customers.mjs` - CRUD for core entities
- `finance.mjs` - Financial reporting/analytics
- `reviews.mjs`, `support.mjs` - Customer reviews and support tickets
- `profile.mjs`, `settings.mjs` - User profile and app settings

### API Convention

All functions are accessed at `/.netlify/functions/<name>` (Netlify rewrites `/api/<name>` automatically). Each function sets its own CORS headers manually.

### Database Schema

Defined in `db-init.mjs`. Core tables: `users`, `products`, `cart_items`, `orders`, `order_items`, plus tables for reviews, support tickets, settings, etc.

## Development

### Local Development

```bash
npm install
netlify dev
```

Requires Netlify CLI (`npm install -g netlify-cli`) and a linked Netlify site (`netlify link`). The site must have a Neon database addon configured (provides `DATABASE_URL` env var).

### Deploy

```bash
netlify deploy --build --prod
```

After deploying, initialize the database by visiting `/api/db-init`.

### Environment Variables

- `DATABASE_URL` - Neon PostgreSQL connection string (provided automatically by Netlify Neon addon)
- `JWT_SECRET` - Token signing secret (falls back to a hardcoded default)
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` - Resend email service for password reset emails
- `ANTHROPIC_API_KEY` - Claude API key for AI support chatbot (`support.mjs`)

## Key Patterns

- **Session tracking**: Guest users are tracked by a `session_id` (stored in localStorage). Authenticated users use `user_<id>` as their session key.
- **Role-based access**: User roles include `customer`, `staff`, `manager`, `admin`, `site_admin`. Role checks happen in function handlers.
- **Payments**: Supports cash, Bitcoin (BTC), and Monero (XMR). No payment gateway integration — crypto uses generated wallet addresses and QR codes.
- **No build step**: Changes to `public/` files are immediately reflected. Changes to `netlify/functions/` are picked up by `netlify dev` automatically.
- **Monolithic HTML files**: The frontend files are large single-file apps. `admin.html` and `index.html` contain all markup, styles, and logic inline.
