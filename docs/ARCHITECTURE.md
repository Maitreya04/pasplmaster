# PASPL Master — Architecture Document

> **This is the master reference for the entire app. Every Cursor session should reference this file.**
> Usage: "Build X per ARCHITECTURE.md section Y"

---

## 1. Project Overview

**PASPL Master** is a warehouse management app for Pathak Auto Sales Pvt. Ltd. (PASPL), an auto parts distributor in Indore, MP. It handles the order lifecycle from sales → billing → picking → dispatch.

**Three roles, one pipeline:**
- **Sales** — Salespeople (on mobile, visiting customers) create orders
- **Billing** — Office staff (on desktop) review, approve, edit orders
- **Picking** — Warehouse staff (on mobile, in warehouse) pick and verify items

**Scale:** ~12,500 SKUs, ~3,200 customers, ~200-250 orders/day, ₹20 lakh daily sales

---

## 2. Tech Stack

```
Framework:    Vite 7 + React 19 + TypeScript
Styling:      Tailwind CSS 4 (via @tailwindcss/vite plugin)
Routing:      react-router-dom v7
Database:     Supabase (PostgreSQL + Realtime + Storage)
Data Fetch:   @tanstack/react-query v5
OCR:          tesseract.js (browser-only, lazy-loaded)
Excel Parse:  xlsx (SheetJS)
Auth:         Simple — shared access code (NO Supabase Auth)
Hosting:      Vercel
```

**CRITICAL RULES FOR CURSOR:**
- This is a Vite SPA. NO server components, NO SSR, NO "use client" directives, NO getServerSideProps
- Everything runs in the browser. Supabase client handles all backend communication
- NO Supabase Auth. We use a shared access code stored in app_config table
- Use Tailwind utility classes for ALL styling. No CSS modules, no styled-components
- Use TanStack Query for ALL data fetching. No raw useEffect + fetch patterns
- Keep every component under 200 lines. Split into sub-components if needed

---

## 3. Design System

### 3.1 Role Themes

| Role | Background | Primary | Accent | Use |
|------|-----------|---------|--------|-----|
| Sales | `bg-gray-950` | `indigo-600` | `indigo-400` | Dark theme — mobile, outdoors |
| Billing | `bg-gray-50` | `blue-600` | `blue-400` | Light theme — desktop, office |
| Picking | `bg-gray-950` | `amber-500` | `amber-400` | Dark theme — mobile, warehouse |
| Admin | `bg-gray-50` | `gray-700` | `gray-500` | Neutral — desktop |
| Login | `bg-gray-950` | `emerald-500` | `emerald-400` | Dark — universal |

### 3.2 Typography Scale

```
Heading XL:   text-2xl font-bold    (page titles)
Heading L:    text-xl font-semibold  (section titles)
Heading M:    text-lg font-semibold  (card titles)
Body:         text-base              (default)
Body Small:   text-sm                (secondary info)
Caption:      text-xs text-gray-400  (timestamps, hints)
Number Big:   text-3xl font-bold tabular-nums  (prices, quantities, counts)
```

### 3.3 Spacing & Layout

```
Page padding:     p-4 (mobile), px-6 py-4 (desktop)
Card padding:     p-4
Card gap:         space-y-3
Section gap:      space-y-6
Border radius:    rounded-xl (cards), rounded-lg (buttons), rounded-full (badges)
```

### 3.4 Tap Targets (CRITICAL for warehouse use)

```
Minimum tap:      min-h-[48px] min-w-[48px]
Primary buttons:  h-14 (56px) — big, easy to tap with gloves
Secondary buttons: h-12 (48px)
List items:       min-h-[56px] with py-3
Gap between taps: gap-2 minimum (8px) — prevent mis-taps
```

### 3.5 Component Library

Every page uses these shared components. Build them FIRST in `src/components/shared/`.

#### BigButton
```tsx
// Primary, secondary, danger, ghost variants
// Always h-14 for primary actions, h-12 for secondary
// Active state: scale-95 transform for press feedback
// Loading state: spinner + disabled
// Full width by default on mobile

<BigButton variant="primary" loading={false} onClick={fn}>
  Submit Order
</BigButton>
```

#### Card
```tsx
// Rounded-xl, shadow-sm
// Dark mode: bg-gray-900 border-gray-800
// Light mode: bg-white border-gray-200
// Pressable variant adds hover:bg-gray-800/hover:bg-gray-50 + cursor-pointer

<Card pressable onClick={fn}>
  <CardHeader>Order #PA-240301-0042</CardHeader>
  <CardBody>...</CardBody>
</Card>
```

#### BottomSheet
```tsx
// Slides up from bottom, dark overlay backdrop
// Drag handle at top (rounded gray bar)
// Max height 85vh, scrollable content
// Close on backdrop tap or swipe down

<BottomSheet isOpen={open} onClose={close} title="Add Item">
  ...content...
</BottomSheet>
```

#### SearchInput
```tsx
// Full width, h-14, large text
// Search icon left, clear button right (when has text)
// Auto-focus on mount
// Debounced onChange (150ms)

<SearchInput
  placeholder="Search parts..."
  value={q}
  onChange={setQ}
  loading={searching}
/>
```

#### StatusBadge
```tsx
// Pill-shaped badges with role-appropriate colors
// submitted: bg-blue-500/20 text-blue-400
// approved: bg-emerald-500/20 text-emerald-400
// picking: bg-amber-500/20 text-amber-400
// completed: bg-green-500/20 text-green-400
// flagged: bg-red-500/20 text-red-400
// urgent: bg-red-600 text-white animate-pulse

<StatusBadge status="submitted" />
<StatusBadge status="urgent" />
```

#### NumberStepper
```tsx
// - button | number display | + button
// Quick preset buttons below: [1] [2] [5] [10] [25] [50]
// Min value 1, no max
// Number display is tappable → opens direct input

<NumberStepper value={qty} onChange={setQty} presets={[1,2,5,10,25,50]} />
```

#### PageHeader
```tsx
// Sticky top, h-14
// Back button (left), title (center), optional action (right)
// Blurred background on scroll

<PageHeader title="New Order" onBack={goBack} action={<button>Clear</button>} />
```

#### BottomNav
```tsx
// Fixed bottom, h-16, safe-area-inset-bottom padding
// 3-4 items with icon + label
// Active item highlighted with role primary color
// Only shown on mobile (hidden on desktop for billing)

<BottomNav items={[
  { icon: Home, label: 'Home', path: '/sales' },
  { icon: Search, label: 'New Order', path: '/sales/new' },
  { icon: List, label: 'My Orders', path: '/sales/orders' },
]} />
```

#### SkeletonLoader
```tsx
// Animated pulse placeholder for loading states
// Variants: text (line), card (rectangle), list (multiple lines)

<Skeleton variant="card" count={3} />  // 3 skeleton cards
<Skeleton variant="text" lines={4} />  // 4 text lines
```

#### EmptyState
```tsx
// Centered icon + message + optional action button
// Used when lists are empty

<EmptyState
  icon={Package}
  title="No orders yet"
  description="Orders will appear here when salespeople submit them"
  action={{ label: "Refresh", onClick: refetch }}
/>
```

#### Toast
```tsx
// Slide-in notification from top
// Success (green), error (red), info (blue) variants
// Auto-dismiss after 3 seconds
// Use a global toast context

toast.success("Order submitted!")
toast.error("Failed to save")
```

### 3.6 Animations & Transitions

```
Page transitions:    None for v1 (keep simple)
Button press:        active:scale-95 transition-transform duration-100
Card press:          active:scale-[0.98] transition-transform duration-100
Bottom sheet:        translate-y animation, 200ms ease-out
Toast:               slide-in from top, 200ms
Loading:             animate-pulse for skeletons, animate-spin for spinners
Urgent badge:        animate-pulse
```

### 3.7 Icons

Use Lucide React icons throughout. Install: already available via CDN or `npm install lucide-react`

```bash
npm install lucide-react
```

Key icons:
```
Search, ShoppingCart, Package, Truck, User, Camera, Check, X, AlertTriangle,
ChevronLeft, ChevronRight, Plus, Minus, Upload, Clock, MapPin, Phone,
ScanLine, Flag, CircleCheck, CircleX, Loader2, MoreVertical, Filter
```

---

## 4. Database Schema

### 4.1 Tables

#### `app_config`
```sql
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Seed: INSERT INTO app_config (key, value) VALUES ('access_code', '1234');
```

#### `items`
```sql
CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,              -- "ASK BRAKE PAD NA BAJAJ PULSAR"
  alias TEXT,                              -- "ASK BP PULSAR" (may be null)
  alias1 TEXT,                             -- "ASKBPPULSAR" (compact, may be null)
  parent_group TEXT,                        -- "ASK BP" (brand group)
  main_group TEXT,                          -- "ASK" (brand)
  item_category TEXT,                       -- "2 Wh" or "4 Wh" or "3 Wh"
  gst_percent NUMERIC(5,2) DEFAULT 18,
  hsn_code TEXT,
  sales_price NUMERIC(10,2) DEFAULT 0,
  mrp NUMERIC(10,2) DEFAULT 0,
  stock_qty NUMERIC(10,2) DEFAULT 0,       -- from stock export
  rack_no TEXT,                             -- bin location, e.g. "A-12-3"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Search indexes
CREATE INDEX idx_items_name ON items USING gin(to_tsvector('english', name));
CREATE INDEX idx_items_alias ON items(alias);
CREATE INDEX idx_items_alias1 ON items(alias1);
CREATE INDEX idx_items_main_group ON items(main_group);
CREATE INDEX idx_items_active ON items(is_active) WHERE is_active = true;
```

#### `customers`
```sql
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,               -- "Balaji Auto Parts"
  address TEXT,
  mobile TEXT,
  parent_group TEXT,                        -- "Indore 2 Wheeler" (from Busy)
  city TEXT,                                -- Extracted: "Indore"
  salesman TEXT,                            -- "Satish"
  gstin TEXT,
  dealer_type TEXT,                         -- "Retailer" / "Distributor"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customers_city ON customers(city);
CREATE INDEX idx_customers_salesman ON customers(salesman);
CREATE INDEX idx_customers_active ON customers(is_active) WHERE is_active = true;
```

#### `transports`
```sql
CREATE TABLE transports (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true
);

-- Seed data:
INSERT INTO transports (name) VALUES
  ('Om Sai Ram Transport'), ('Shree Maruti Courier'), ('VRL Logistics'),
  ('Gati Limited'), ('Safe Express'), ('Customer Pickup'),
  ('Company Vehicle'), ('DTDC Courier'), ('Professional Courier');
```

#### `orders`
```sql
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,       -- "PA-260301-0042" (auto-generated)
  customer_id BIGINT REFERENCES customers(id),
  customer_name TEXT NOT NULL,              -- Denormalized for quick display
  customer_city TEXT,                       -- Denormalized
  transport_id BIGINT REFERENCES transports(id),
  transport_name TEXT,                      -- Denormalized
  salesperson_name TEXT NOT NULL,           -- From role selection dropdown
  reviewer_name TEXT,                       -- Who approved
  picker_name TEXT,                         -- Who picked
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted|approved|picking|completed|dispatched
  priority TEXT NOT NULL DEFAULT 'normal',  -- normal|urgent
  notes TEXT,                               -- Salesperson notes for billing
  item_count INTEGER DEFAULT 0,            -- Denormalized count
  total_value NUMERIC(12,2) DEFAULT 0,     -- Denormalized total
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_salesperson ON orders(salesperson_name);
```

#### `order_items`
```sql
CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES items(id),
  item_name TEXT NOT NULL,                  -- Denormalized
  item_alias TEXT,                          -- Denormalized
  rack_no TEXT,                             -- Snapshot at order time
  qty_requested INTEGER NOT NULL,
  qty_approved INTEGER,                     -- Set by billing (may differ)
  price_quoted NUMERIC(10,2),              -- Salesperson's price (may include special rate)
  price_system NUMERIC(10,2),             -- System price at order time
  state TEXT NOT NULL DEFAULT 'pending',   -- pending|picked|flagged
  flag_reason TEXT,                         -- If flagged: "Out of Stock", "Wrong Part", etc.
  flag_notes TEXT,                          -- Optional picker notes
  flag_box_price NUMERIC(10,2),            -- Box price when flagged as "Price Mismatch"
  scan_result JSONB,                       -- OCR verification data: {scannedText, confidence, isMatch, matchedAgainst}
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_state ON order_items(state);
```

#### `upload_log`
```sql
CREATE TABLE upload_log (
  id BIGSERIAL PRIMARY KEY,
  file_type TEXT NOT NULL,                 -- "items_stock" | "items_price" | "customers"
  file_name TEXT,
  uploaded_by TEXT,                         -- Just a name
  row_count INTEGER,
  new_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  changes_summary JSONB,                   -- {priceChanges: [...], newItems: [...]}
  status TEXT DEFAULT 'completed',         -- completed|failed
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 Auto-Generate Order Numbers

```sql
-- Function to generate order numbers: PA-YYMMDD-XXXX
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  today_prefix TEXT;
  seq INTEGER;
BEGIN
  today_prefix := 'PA-' || to_char(now(), 'YYMMDD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM '-(\d+)$') AS INTEGER)
  ), 0) + 1 INTO seq
  FROM orders
  WHERE order_number LIKE today_prefix || '-%';
  NEW.order_number := today_prefix || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION generate_order_number();
```

### 4.3 TypeScript Types

```typescript
// src/types/index.ts

export interface Item {
  id: number;
  name: string;
  alias: string | null;
  alias1: string | null;
  parent_group: string | null;
  main_group: string | null;
  item_category: string | null;  // "2 Wh" | "4 Wh" | "3 Wh"
  gst_percent: number;
  hsn_code: string | null;
  sales_price: number;
  mrp: number;
  stock_qty: number;
  rack_no: string | null;
  is_active: boolean;
}

export interface Customer {
  id: number;
  name: string;
  address: string | null;
  mobile: string | null;
  parent_group: string | null;
  city: string | null;
  salesman: string | null;
  gstin: string | null;
  dealer_type: string | null;
  is_active: boolean;
}

export interface Transport {
  id: number;
  name: string;
  is_active: boolean;
}

export type OrderStatus = 'submitted' | 'approved' | 'picking' | 'completed' | 'dispatched';
export type OrderPriority = 'normal' | 'urgent';
export type OrderItemState = 'pending' | 'picked' | 'flagged';

export interface Order {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  transport_id: number | null;
  transport_name: string | null;
  salesperson_name: string;
  reviewer_name: string | null;
  picker_name: string | null;
  status: OrderStatus;
  priority: OrderPriority;
  notes: string | null;
  item_count: number;
  total_value: number;
  created_at: string;
  approved_at: string | null;
  picked_at: string | null;
  completed_at: string | null;
  dispatched_at: string | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_id: number;
  item_name: string;
  item_alias: string | null;
  rack_no: string | null;
  qty_requested: number;
  qty_approved: number | null;
  price_quoted: number | null;
  price_system: number | null;
  state: OrderItemState;
  flag_reason: string | null;
  flag_notes: string | null;
  scan_result: ScanResult | null;
}

export interface ScanResult {
  scannedText: string;
  confidence: number;
  isMatch: boolean;
  matchedAgainst: string;
  timestamp: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

// Cart types (client-side only, not in DB)
export interface CartItem {
  item: Item;
  qty: number;
  specialRate: number | null;  // null = use system price
}

// Auth context
export interface AuthState {
  isAuthenticated: boolean;
  role: 'sales' | 'billing' | 'picking' | 'admin' | null;
  userName: string | null;
}
```

---

## 5. Data Fetching Strategy

### 5.1 TanStack Query Setup

```typescript
// src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,     // 5 min before refetch
      gcTime: 30 * 60 * 1000,        // 30 min cache retention
      retry: 2,
      refetchOnWindowFocus: false,    // Don't refetch on tab switch
    },
  },
});
```

### 5.2 Data Categories

| Data | Strategy | staleTime | Why |
|------|----------|-----------|-----|
| Items (12,500) | Load all → cache | 30 min | Static, changes weekly via upload |
| Customers (3,200) | Load all → cache | 30 min | Static, changes weekly via upload |
| Transports (~10) | Load all → cache | 60 min | Almost never changes |
| Orders list | Query + realtime subscription | 0 (always fresh) | Changes constantly |
| Order detail | Query by ID + realtime | 0 | Needs live updates |
| App config | Query on login | 60 min | Rarely changes |

### 5.3 Query Hooks Pattern

```typescript
// src/hooks/useItems.ts
export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: () => supabase.from('items').select('*').eq('is_active', true).then(r => r.data),
    staleTime: 30 * 60 * 1000,  // 30 minutes
  });
}

// src/hooks/useOrders.ts
export function useOrders(status?: OrderStatus) {
  return useQuery({
    queryKey: ['orders', status],
    queryFn: () => {
      let q = supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      return q.then(r => r.data);
    },
    staleTime: 0,  // Always refetch
  });
}

// src/hooks/useOrderDetail.ts
export function useOrderDetail(orderId: number) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
      const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
      return { ...order, items } as OrderWithItems;
    },
  });
}
```

### 5.4 Realtime Subscriptions

```typescript
// Subscribe to order changes (billing dashboard, picker queue)
supabase
  .channel('orders-changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'orders',
  }, (payload) => {
    // Invalidate React Query cache → auto-refetch
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  })
  .subscribe();
```

### 5.5 Optimistic Updates

```typescript
// Example: Picker marks item as picked
const pickItem = useMutation({
  mutationFn: (itemId: number) =>
    supabase.from('order_items').update({ state: 'picked' }).eq('id', itemId),
  onMutate: async (itemId) => {
    // Cancel outgoing refetch
    await queryClient.cancelQueries({ queryKey: ['order', orderId] });
    // Snapshot previous value
    const previous = queryClient.getQueryData(['order', orderId]);
    // Optimistically update
    queryClient.setQueryData(['order', orderId], (old: OrderWithItems) => ({
      ...old,
      items: old.items.map(i => i.id === itemId ? { ...i, state: 'picked' } : i),
    }));
    return { previous };
  },
  onError: (_err, _itemId, context) => {
    // Rollback on error
    queryClient.setQueryData(['order', orderId], context?.previous);
    toast.error('Failed to update — please try again');
  },
});
```

---

## 6. State Machine

### 6.1 Order States

```
SUBMITTED ──→ APPROVED ──→ PICKING ──→ COMPLETED ──→ DISPATCHED
   │              │            │            │
   │  (billing    │ (picker    │ (picker    │ (billing
   │   approves)  │  claims)   │  finishes) │  dispatches)
   │              │            │            │
   ▼              ▼            ▼            ▼
 Sales          Billing      Picking      Billing
 creates        reviews      executes     confirms
```

**Valid transitions:**
| From | To | Who | Action |
|------|----|-----|--------|
| (new) | submitted | Sales | Submit order |
| submitted | approved | Billing | Approve after review |
| approved | picking | Picker | Claim order ("Start Picking") |
| picking | completed | Picker | All items verified/flagged |
| completed | dispatched | Billing | Busy invoice created, goods sent |

### 6.2 Order Item States

```
pending ──→ picked     (verified OK — OCR match or manual confirm)
pending ──→ flagged    (problem — OCR mismatch or manual flag)
```

**Flag reasons:** Wrong Part, Out of Stock, Damaged, Can't Find, Quantity Mismatch, Other

---

## 7. Auth Model

### 7.1 Access Code Gate
- App opens → full-screen "Enter Access Code" page
- 4-digit number pad (like phone lock screen)
- Code is checked against `app_config` table (key = 'access_code')
- On success → role selection page
- Store `isAuthenticated: true` in localStorage

### 7.2 Role Selection
- Three big cards: Sales (indigo/dark), Billing (blue/light), Picking (amber/dark)
- Sales: after selecting, show dropdown of salespeople names (from distinct `salesman` values in customers table). Names: Satish, Hemant, Mankar, Raju Ji, Rehan Multani, Hardeep Singh, Deepak, Vinod, Sachin Rao, Anand Awasthi, Gourav Yadav, Mahendra Rajput, Manish Sharma, Shri Ram Sharma, Asad Khan, Direct
- Picking: after selecting, show name input (picker types their name)
- Billing: goes straight to dashboard (reviewer name entered at approve time)
- Store `role` and `userName` in localStorage
- "Switch Role" button in header to change

### 7.3 No RLS
Without Supabase Auth, there are no JWT tokens, so RLS won't work. Use anon key with RLS disabled. Security comes from:
- Access code gate (keeps random people out)
- Internal-use-only app on trusted devices
- Add proper auth + RLS in v2

---

## 8. Search / Matching Engine

### 8.1 Five-Layer Cascade

All searches run against the cached items array (in-memory, no DB hit).

```typescript
function searchItems(query: string, items: Item[]): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const item of items) {
    let score = 0;
    let matchType = '';

    const name = item.name.toLowerCase();
    const alias = (item.alias || '').toLowerCase();
    const alias1 = (item.alias1 || '').toLowerCase();

    // Layer 1: Exact alias match (score 100)
    if (alias === q || alias1 === q) {
      score = 100; matchType = 'exact';
    }
    // Layer 2: Normalized match — strip dots/dashes/spaces (score 95)
    else if (normalize(alias) === normalize(q) || normalize(alias1) === normalize(q)) {
      score = 95; matchType = 'normalized';
    }
    // Layer 3: Prefix match on alias/alias1/name (score 85)
    else if (alias.startsWith(q) || alias1.startsWith(q) || name.startsWith(q)) {
      score = 85; matchType = 'prefix';
    }
    // Layer 4: All query keywords found in name (score 60)
    else if (allKeywordsMatch(q, name)) {
      score = 60; matchType = 'keywords';
    }
    // Layer 5: Partial keyword match — 60%+ words (score 40)
    else if (partialKeywordsMatch(q, name) >= 0.6) {
      score = 40; matchType = 'partial';
    }

    if (score > 0) {
      results.push({ item, score, matchType });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 15);
}

function normalize(s: string): string {
  return s.replace(/[\s.\-\/\\]/g, '').toLowerCase();
}
```

### 8.2 Quick Filter Chips
Pre-built search shortcuts for common brands:
```
ASK, TIDC, BRG, GASKET, RELAY, PULSAR, ACTIVA, SHINE, LUCAS, RANE, FAG, GAE
```

---

## 9. OCR Verification

### 9.1 Flow
```
Picker taps "Scan to Verify" on pick list item
  → Camera opens (rear-facing)
  → Picker positions part label in target rectangle
  → Taps "Capture" button
  → Frame is cropped to target area
  → Preprocessing: grayscale → contrast boost → threshold
  → Tesseract.js extracts text
  → Extracted text is compared to expected item (name, alias, alias1) using matching engine
  → Result shown: ✅ MATCH (green) or ❌ MISMATCH (red)
  → Picker confirms or flags
```

### 9.2 Technical Implementation
```typescript
// src/lib/ocr/ocrEngine.ts
import Tesseract from 'tesseract.js';

let worker: Tesseract.Worker | null = null;

// Lazy init — only load when picker first opens scan
async function getWorker() {
  if (!worker) {
    worker = await Tesseract.createWorker('eng');
  }
  return worker;
}

async function scanImage(imageData: string): Promise<string> {
  const w = await getWorker();
  const { data: { text } } = await w.recognize(imageData);
  return text.trim();
}
```

```typescript
// src/lib/ocr/ocrMatcher.ts
function matchScanToItem(scannedText: string, expectedItem: Item): ScanResult {
  const scanned = scannedText.toLowerCase().replace(/[\s.\-]/g, '');
  const candidates = [
    expectedItem.name,
    expectedItem.alias,
    expectedItem.alias1,
  ].filter(Boolean).map(s => s!.toLowerCase().replace(/[\s.\-]/g, ''));

  let bestMatch = '';
  let bestScore = 0;

  for (const candidate of candidates) {
    // Check if scanned text contains the candidate or vice versa
    if (scanned.includes(candidate) || candidate.includes(scanned)) {
      bestMatch = candidate;
      bestScore = 1.0;
      break;
    }
    // Partial overlap score
    const overlap = calculateOverlap(scanned, candidate);
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatch = candidate;
    }
  }

  return {
    scannedText,
    confidence: bestScore,
    isMatch: bestScore >= 0.7,  // 70% threshold for match
    matchedAgainst: bestMatch,
    timestamp: new Date().toISOString(),
  };
}
```

### 9.3 Camera Setup
```typescript
// Use rear camera at decent resolution
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  }
});
```

### 9.4 Preprocessing for Poor Warehouse Lighting
```typescript
function preprocessImage(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Convert to grayscale and boost contrast
  for (let i = 0; i < data.length; i += 4) {
    let gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    // Increase contrast
    gray = ((gray - 128) * 1.5) + 128;
    gray = Math.max(0, Math.min(255, gray));
    // Apply threshold
    gray = gray > 128 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
  return imageData;
}
```

### 9.5 Fallback
Every item on the pick list has TWO verify options:
1. **📸 Scan to Verify** — opens camera, runs OCR (primary)
2. **✋ Manual Verify** — simple Yes/No screen (fallback)

---

## 10. File Structure

```
pasplmaster/
├── docs/
│   └── ARCHITECTURE.md              ← THIS FILE
├── supabase/
│   └── migrations/
│       └── 001_create_tables.sql    ← Full schema
├── src/
│   ├── main.tsx                     ← Entry: QueryClientProvider + Router
│   ├── App.tsx                      ← Route definitions
│   ├── types/
│   │   └── index.ts                 ← All TypeScript interfaces
│   ├── lib/
│   │   ├── supabase/
│   │   │   └── client.ts            ← Supabase client (URL + anon key from env)
│   │   ├── search/
│   │   │   └── itemSearch.ts        ← 5-layer matching engine
│   │   ├── ocr/
│   │   │   ├── ocrEngine.ts         ← Tesseract.js wrapper
│   │   │   └── ocrMatcher.ts        ← Compare scan to expected item
│   │   ├── import/
│   │   │   ├── fileDetector.ts      ← Auto-detect Excel file type
│   │   │   ├── itemImporter.ts      ← Parse + upsert items
│   │   │   └── customerImporter.ts  ← Parse + upsert customers
│   │   └── parser/
│   │       └── whatsappParser.ts    ← WhatsApp order text parser
│   ├── hooks/
│   │   ├── useItems.ts              ← TanStack Query: cached items
│   │   ├── useCustomers.ts          ← TanStack Query: cached customers
│   │   ├── useTransports.ts         ← TanStack Query: cached transports
│   │   ├── useOrders.ts             ← TanStack Query: orders + realtime
│   │   ├── useOrderDetail.ts        ← Single order with items
│   │   ├── useAuth.ts               ← Auth context hook
│   │   └── useToast.ts              ← Toast notification hook
│   ├── context/
│   │   ├── AuthContext.tsx           ← Access code + role + name
│   │   └── ToastContext.tsx          ← Global toast state
│   ├── components/
│   │   └── shared/
│   │       ├── BigButton.tsx
│   │       ├── Card.tsx
│   │       ├── BottomSheet.tsx
│   │       ├── SearchInput.tsx
│   │       ├── StatusBadge.tsx
│   │       ├── NumberStepper.tsx
│   │       ├── PageHeader.tsx
│   │       ├── BottomNav.tsx
│   │       ├── Skeleton.tsx
│   │       ├── EmptyState.tsx
│   │       └── Toast.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx             ← Access code number pad
│   │   ├── RoleSelectPage.tsx        ← Role + name picker
│   │   ├── sales/
│   │   │   ├── SalesLayout.tsx       ← Dark theme + bottom nav
│   │   │   ├── SalesHome.tsx         ← Quick actions + today summary
│   │   │   ├── NewOrderPage.tsx      ← Search + add items
│   │   │   ├── CartPage.tsx          ← Cart + customer + submit
│   │   │   ├── PastePage.tsx         ← WhatsApp parser
│   │   │   └── MyOrdersPage.tsx      ← Order history
│   │   ├── billing/
│   │   │   ├── BillingLayout.tsx     ← Light theme + sidebar (desktop)
│   │   │   ├── DashboardPage.tsx     ← Status tiles + order queue
│   │   │   ├── ReviewPage.tsx        ← Order detail + approve/edit
│   │   │   └── HistoryPage.tsx       ← Search + filter all orders
│   │   ├── picking/
│   │   │   ├── PickingLayout.tsx     ← Amber theme + bottom nav
│   │   │   ├── QueuePage.tsx         ← Available + my active picks
│   │   │   ├── PickPage.tsx          ← Pick list + progress
│   │   │   ├── ScanPage.tsx          ← Camera OCR verification
│   │   │   └── VerifyPage.tsx        ← Manual verify fallback
│   │   └── admin/
│   │       ├── AdminPage.tsx         ← Dashboard + config
│   │       └── UploadPage.tsx        ← Excel import
│   └── utils/
│       ├── formatters.ts             ← Currency, date, time formatters
│       └── constants.ts              ← Flag reasons, salesperson list, etc.
├── public/
│   └── manifest.json
├── .env                              ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 11. Page-by-Page Specs

### 11.1 LoginPage
- Full screen, dark bg (gray-950)
- App logo/name at top: "PASPL Master" with emerald accent
- 4-digit code input rendered as 4 circles (filled when digit entered)
- Number pad below (1-9, 0, backspace) — big keys, 64px each
- On correct code → navigate to /select-role
- On wrong code → shake animation + "Incorrect code" message
- Store isAuthenticated in localStorage

### 11.2 RoleSelectPage
- Three large cards, each 1/3 of the screen height
- **Sales** — indigo gradient, 🛒 icon, "Create Orders"
- **Billing** — blue gradient, 📋 icon, "Review & Approve"
- **Picking** — amber gradient, 📦 icon, "Pick & Verify"
- Tap card → if Sales or Picking, show name picker (bottom sheet with scrollable list)
- Tap card → if Billing, go directly to /billing
- Small "Admin" link at bottom for data uploads

### 11.3 Sales — NewOrderPage
- **Header:** "New Order" with cart icon + count badge
- **Search bar:** Auto-focused, full width, h-14, placeholder "Search parts..."
- **Quick filter chips:** Scrollable horizontal row below search
- **Results:** Scrollable list. Each result card shows:
  - Item name (bold)
  - Alias codes (gray, smaller)
  - Price: ₹XXX (green)
  - Main group badge
  - "+" button (if not in cart) or qty stepper (if in cart)
- **Floating cart bar:** Fixed bottom, shows: "🛒 X items · ₹XX,XXX" + "View Cart →"
- **Empty state:** When no search query, show "Search for parts by name or code"

### 11.4 Sales — CartPage
- **Header:** "Your Order" with item count
- **Item list:** Each item shows name, qty (editable stepper), price, line total, remove (X) button
- **Customer section:** "Select Customer" — searchable dropdown showing name + city
- **Transport section:** "Select Transport" — dropdown from transports table
- **Priority:** Toggle between Normal and URGENT (red, pulsing)
- **Notes:** Textarea, placeholder "Special instructions for billing..."
- **Summary:** Item count, subtotal
- **Submit button:** "Submit Order" — disabled until customer selected
- **After submit:** Success screen with order number, "Create Another" and "My Orders" buttons

### 11.5 Billing — DashboardPage
- **Header:** "Billing Dashboard" with date
- **Status tiles:** 4 cards in a row showing counts for: Submitted (blue), Approved (green), Picking (amber), Completed (emerald). Tappable to filter.
- **Order list:** Tabbed: "Needs Review" | "In Progress" | "Completed"
- Each order card: order number, customer + city, salesperson, item count, total, time ago, priority badge
- Tap → navigate to ReviewPage
- **Realtime:** New orders appear instantly with subtle highlight animation
- **Desktop layout:** Sidebar nav + wider content area

### 11.6 Billing — ReviewPage
- **Header:** Order number + status badge + time
- **Customer info bar:** Name, city, salesperson, transport, notes
- **Item table:** Columns: Item Name, Code, Qty (editable), Quoted Price, System Price (yellow if different), Total
- Remove button (X) per item
- **Running total** at bottom, updates live
- **Actions:** "✅ Approve & Send to Picking" (green), "← Back" (gray)
- Approve sets status='approved', qty_approved for each item, reviewer_name

### 11.7 Picking — QueuePage
- **Header:** "Pick Queue" + picker name
- **My active pick:** Prominent card at top if picker has a claimed order, with "Continue Picking →" button
- **Available orders:** List of approved orders. Each shows: order number, customer, item count, priority badge, "Start Picking" button
- Sort: urgent first, then oldest first
- **Realtime:** New approved orders appear live

### 11.8 Picking — PickPage
- **Header:** Order number + progress "4/8 items"
- **Progress bar:** Visual, shows green (picked) / red (flagged) / gray (remaining)
- **Item list:** Sorted by rack_no (walking order). Each item card:
  - **RACK LOCATION** — biggest text, most prominent (this is where to walk)
  - Item name + alias below
  - Qty to pick
  - Status indicator: ⬜ / ✅ / 🚩
  - Two buttons: "📸 Scan" and "✋ Manual"
- **Complete button:** Appears when all items verified/flagged

### 11.9 Picking — ScanPage
- **Full screen camera** view
- **Target rectangle** overlay in center (where to aim)
- **Expected item info** bar at top (item name, alias)
- **Capture button** — big, centered below camera
- **Loading state** while OCR processes
- **Result screen:**
  - Expected: "ASK BRAKE PAD PULSAR" (white)
  - Scanned: "ASK BRAKE PAD PULSAR" (green if match, red if not)
  - Big status: "✅ MATCH" or "❌ MISMATCH"
  - Buttons: "Confirm & Next" | "Try Again" | (if mismatch) "Flag Problem"

---

## 12. Excel Import Specs

### 12.1 File Auto-Detection
Check specific cell values to identify file type:
- **Stock file:** Row 8 contains "Item Details" header
- **Price file:** Row 5 has "Name" + "Sales Price" columns
- **Customer file:** Row 1 has "Name" + "Parent Group" columns

### 12.2 Column Mappings

**Price file (List_of_Items.xlsx):**
| Column | Index | Maps to |
|--------|-------|---------|
| Name | 0 | items.name |
| Alias | 1 | items.alias |
| Parent Group | 2 | items.parent_group |
| GST % | 3 | items.gst_percent |
| HSN | 4 | items.hsn_code |
| Sales Price | 5 | items.sales_price |
| MRP | 6 | items.mrp |
| Alias 1 | 7 | items.alias1 |
| Item Cat | 8 | items.item_category |
| Item Main Grp | 9 | items.main_group |

**Stock file (All_Item_Stock.xlsx):**
| Column | Maps to |
|--------|---------|
| Item Details | items.name |
| Closing Qty | items.stock_qty |
| Rack No | items.rack_no (COALESCE — never overwrite with null) |

**Customer file (List_of_Accounts.xlsx):**
| Column | Maps to |
|--------|---------|
| Name | customers.name |
| Address | customers.address |
| Parent Group | customers.parent_group + extract city |
| Mobile | customers.mobile |
| Salesman | customers.salesman (filter =VLOOKUP) |
| GSTIN | customers.gstin |

### 12.3 Import Rules
- UPSERT by name (unique key)
- Stock import: NEVER overwrite rack_no with null → use COALESCE
- Filter rows where values start with "=VLOOKUP" (broken Busy formulas)
- Extract city from parent_group: "Indore 2 Wheeler" → "Indore" (take first word, or first two words if second word isn't a vehicle type)
- Skip header rows (vary by file type)
- Track changes for upload_log: count new, updated, price changes

---

## 13. Environment Variables

```env
# .env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Access in code:
```typescript
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

---

## 14. Revised Build Order (17 Sessions)

```
Session 1:  Design system components (all shared components)
Session 2:  Supabase client + types + TanStack Query hooks + realtime setup
Session 3:  Auth gate + role selection + app routing shell
Session 4:  Excel upload UI + file detection
Session 5:  Item importer + customer importer logic
Session 6:  Search engine (matching engine v3)
Session 7:  Sales — search page + add to cart
Session 8:  Sales — cart + customer selection + submit
Session 9:  Sales — WhatsApp parser + my orders
Session 10: Billing — dashboard with realtime
Session 11: Billing — order review + approve
Session 12: Billing — history + dispatch
Session 13: Picking — queue + claim
Session 14: Picking — pick list page
Session 15: Picking — OCR scan page + engine
Session 16: Picking — manual verify + flag + complete
Session 17: PWA setup + final polish + testing
```
