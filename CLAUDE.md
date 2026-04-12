# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIRWAVES is a premium hemp products e-commerce store. It's a serverless full-stack app deployed on Netlify with a Neon PostgreSQL database. Current version: **v4.7**.

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build step). Each page is a self-contained HTML file with inline `<style>` and `<script>` tags.
- **Backend**: Netlify Functions (serverless), written as ESM modules (`.mjs`).
- **Database**: Neon PostgreSQL via `@netlify/neon`. All queries use tagged template literals (`sql\`...\``).
- **Auth**: Custom token-based auth (HMAC-signed base64url payloads, not standard JWT). Token logic lives in `netlify/functions/auth.mjs`.

## Architecture

### Frontend (`public/`)

All pages are single-file HTML documents with embedded CSS and JS. No bundler, no framework.

- `index.html` - Main storefront (product browsing, cart, checkout, featured carousel)
- `admin.html` - Admin dashboard (products, orders, customers, finance, settings)
- `product.html` - Single product detail page (INSA-style with terpene bars, effects, flavors, lineage)
- `profile.html` - User profile/account page
- `reset-password.html` - Password reset flow

### Backend (`netlify/functions/`)

Each function is a single `.mjs` file exporting a default async handler `(req, context) => Response`. Routing within a function is done via query params (`?action=`, `?id=`) and HTTP methods, not path-based routing.

Key functions:
- `auth.mjs` - Registration, login, password reset, token verification. Exports `verifyToken()` used by other functions.
- `db-init.mjs` - Creates all database tables and seeds initial data (30 products, reviews, variants). Hit `/api/db-init` after deploy.
- `products.mjs` - Product CRUD. Returns variant summary (min_price, variant_count) on list, full variants on detail.
- `orders.mjs` - Order CRUD with order_log audit trail. Logs create, status change, edit, view, delete events.
- `cart.mjs` - Cart management. Supports `variant_id` for size/weight selection.
- `customers.mjs` - User/customer management, dashboard stats endpoint.
- `finance.mjs` - Financial reporting/analytics, cash management.
- `reviews.mjs`, `support.mjs` - Customer reviews and support tickets.
- `profile.mjs`, `settings.mjs` - User profile and app settings.

### API Convention

All functions are accessed at `/.netlify/functions/<name>` (Netlify rewrites `/api/<name>` automatically). Each function sets its own CORS headers manually.

### Database Schema

Defined in `db-init.mjs`. Core tables:
- `users` - Customers and admins with roles
- `products` - 30 seeded products with rich fields (brand, terpenes, effects, flavor_notes, lineage, use_cases)
- `product_variants` - Size/weight options per product with individual pricing and stock
- `cart_items` - Cart with optional variant_id
- `orders` - Uses VARCHAR UUID IDs (not integer). **Important**: all onclick handlers must quote order IDs.
- `order_items` - Line items with variant_label
- `order_log` - Audit trail for all order events (order_id is VARCHAR to match orders.id)
- `reviews`, `support_tickets`, `settings`, `cash_transactions`, `password_reset_tokens`

### Product Variants System

Products have size/weight variants stored in `product_variants` table:
- **Flower**: 1g, Eighth (3.5g), Quarter (7g), Half Oz (14g), Ounce (28g)
- **Cartridges**: 0.5g, 1g, 2g XL
- **Pre-Rolls**: Single, 3-Pack, 5-Pack, 10-Pack
- **Edibles**: 5ct, 10ct, 20ct, 40ct
- **Tinctures**: 15ml, 30ml, 60ml
- **Concentrates**: 0.5g, 1g, 3.5g
- **Topicals**: 1oz, 2oz, 4oz
- **Accessories**: No variants (single price)

### Admin Dashboard

All items across all sections (Dashboard, Products, Orders, Customers, Finance, Settings) are clickable and open a detail modal. The detail modal system uses `detailSaveHandler` / `detailEditHandler` stored as global variables — **never stringify closures into onclick attributes** (UUID IDs and other closure vars are lost).

- Settings uses panel-based editable modals (not inline forms)
- Orders detail modal is fully editable with Save/Close buttons and shows order log
- Product detail modal shows variant table

### Tor Hidden Service (`tor-setup/`)

Configuration files for running AIRWAVES as a `.onion` site:
- `nginx-airwaves-onion.conf` - Nginx config serving static files + proxying API to Netlify
- `torrc-hidden-service.conf` - Tor hidden service config
- `setup.sh` - One-shot setup script (`sudo bash setup.sh`)

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

### Repos

- **Origin**: https://github.com/ethanking80/airwaves
- **V5 snapshot**: https://github.com/ethanking80/airwaves-v5

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
- **Order IDs are UUIDs**: The `orders` table uses `VARCHAR(100)` with `gen_random_uuid()`. All JS onclick handlers must quote order IDs with single quotes.
- **Product categories**: Flower, Cartridges, Pre-Rolls, Edibles, Tinctures, Concentrates, Topicals, Accessories.
