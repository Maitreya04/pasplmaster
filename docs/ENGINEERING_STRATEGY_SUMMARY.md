# PASPL Master Engineering Strategy Summary

This document captures the current long-range engineering direction for PASPL Master: architecture, data flow, performance, auth, and Busy integration.

## 1. Three-Layer Architecture

```text
BUSY (Local Server)     -> System of Record
SUPABASE                -> Operational Layer
PASPL MASTER (Vercel)   -> System of Action
```

Core rules:

- Supabase must not contradict Busy on financial truth
- Busy should not read from Supabase directly
- Orders flow one way: App -> Supabase -> Busy
- Stock flows one way: Busy -> Supabase -> App
- If systems conflict, Busy wins

## 2. Supabase Plan

Production baseline:

- Supabase Free is fine for development
- Supabase Pro is the correct production starting point

Scale assumptions:

- orders after 2 years at 250/day: about 182K rows
- order_items after 2 years at 8 lines/order average: about 1.46M rows
- items: about 20K rows

Schema strategy:

- partition `order_items` by month
- add partial indexes for active-order workflows
- archive old operational data out of hot-path tables

## 3. Why Vite Fits This Product

Vite is the right fit for the current product shape:

- internal tool, not public SEO surface
- browser-first workflow
- Supabase already provides backend services
- Busy integration must live on the local network, not on Vercel

## 4. Performance Priorities

Main concerns:

- full-catalog item loading into the browser
- broad realtime invalidation
- dashboard queries scanning too much history
- cold-start and first-load UX on warehouse devices

Recommended direction:

- tiered item loading
- targeted realtime updates
- precomputed dashboard summaries
- stronger client caching

Suggested stale times:

- SKU catalog: 6 hours
- stock levels: 5 minutes
- today’s orders: 30 seconds
- customers: 24 hours

## 5. Production Auth Direction

Current MVP:

- shared access code
- role selection in the app

Production target:

- Supabase Auth
- one account per staff member
- role stored in profile table
- RLS enforced in the database

Security model:

- anon key is public and safe in frontend code
- user JWT controls access
- service role key stays server-side only

## 6. Busy Integration Direction

Busy will act as the business system of record. PASPL Master should integrate through a local server-side worker, not through direct browser access.

Target write path:

```text
App -> Supabase -> erp_order_outbox -> local worker -> Busy
```

Target read path:

```text
Busy -> local worker -> Supabase -> App
```

Key operational requirement:

- idempotent order sync, or app-side duplicate protection if Busy does not support it

## 7. Node.js Worker Strategy

Build the contract first, then the Busy client.

What can be designed before Busy API docs arrive:

- outbox schema
- sync statuses
- retry policy
- logging structure
- config schema
- Busy client interface
- local worker folder layout
- admin sync visibility

What should wait for real API docs:

- concrete Busy API client implementation
- stock sync job details
- order push implementation details

## 8. User Model

Long term:

- one Supabase project
- one API URL
- one anon key
- one authenticated account per staff member

The role selector should eventually disappear and be replaced by authenticated routing based on the signed-in user profile.

## 9. Suggested Roadmap

Near term:

- keep the MVP working
- prepare ERP sync schema now
- harden the operational data model

Next:

- move to real auth and RLS
- improve catalog loading and dashboard performance
- add worker scaffolding
- start Busy read sync first

Later:

- enable order outbox writes to Busy
- run manual and automated flows in parallel
- add reconciliation, caching, and archival jobs

## 10. Guiding Principles

- Schema discipline beats premature infra upgrades
- Define contracts before writing integrations
- Failure handling is part of the product, not a side concern
- Busy owns truth; Supabase owns speed
- Keep service-role access off the frontend permanently
