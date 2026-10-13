# Wireframes

Low-fidelity wireframes drawn before building. Every screen shares the same navbar:

```
+------------------------------------------------------------------------------+
| StaySpot  Browse  Book a stay  Wallet audit  Analytics  Search map  Reviews   |
|                                          (o) Acting as: Asha #12  [Switch]    |
+------------------------------------------------------------------------------+
```

## 1. Browse

```
Browse
[ Guests ] [ Properties ] [ Bookings ]          <- tabs
+----------------------------------------------------------------------+
| Search [__________]  (filters change per tab)  [Search] [Clear]      |
|----------------------------------------------------------------------|
| Id | Name          | Email          | Phone      |        Wallet     |
| 1  | ...           | ...            | ...        |     ₹9,047.42     |  <- click row
| .. (20 rows per page)                                                 |
|                    1,234 records · page 1 of 62  [«] [‹] [›] [»]      |
+----------------------------------------------------------------------+
                                       +---------------------------+
                                       | Detail panel (slides in)  |
                                       | name, fields, counts      |
                                       | [Act as this guest]       |
                                       | latest bookings table     |
                                       +---------------------------+
```

## 2. Book a stay (Workflow 1)

```
+--------------------------------------------+  +-----------------------+
| New booking                                |  | Wallet                |
| Property id [__]  Check-in [__]  Out [__]  |  | ASHA #12              |
| "Sea View · 2 nights × ₹800 = ₹1,600"      |  | ₹9,047.42             |
| [Book now]                                 |  | Top up [1000] [Add]   |
|--------------------------------------------|  +-----------------------+
| ✔ Booking #50004 confirmed / ✖ reason      |
| [Balance before ₹X]  [Balance after ₹Y]    |
| New wallet_audit_logs row (highlighted)    |
+--------------------------------------------+
+----------------------------------------------------------------------+
| My bookings                                         Show [All ▾]     |
| ✖ "Blocked: already checked in to #123" (partial unique index)       |
| Id | Property | Stay | Total | Status | [Check in] / [Complete]      |
+----------------------------------------------------------------------+
```

## 3. Wallet audit

```
Guest id [12]  From [__]  To [__]  [Show] [All dates]
[Opening ₹] [Total credits ₹] [Total debits ₹] [Closing ₹]
+----------------------------------------------------------------------+
| Id | When | CREDIT/DEBIT | Amount | Balance before | Running balance  |
+----------------------------------------------------------------------+
```

## 4. Analytics (Workflow 2 + materialized view)

```
+----------------------------------------------------------------------+
| Completed stays (materialized view)   Last refreshed 3:55 pm [Refresh]|
| [Gross revenue] [Completed stays] [Nights booked] [Revenue/night]    |
+----------------------------------------------------------------------+
| 7-day moving average · #98 Sea View      Top [▾]  or id [__] [Show]  |
|  ▮ daily revenue   — 7-day average                                   |
|  |    ▮      ▮▮ ___/‾‾\___     ▮                                      |
|  +-----------------------------------------------> date               |
+----------------------------------------------------------------------+
| Ranking by 7-day moving average                       Date [__]      |
| Rank | Property | Revenue that day | 7-day avg   (DENSE_RANK)        |
+----------------------------------------------------------------------+
```

## 5. Search map (Workflow 3)

```
City [Bengaluru ▾]  Last [2 hours ▾]  [Simulate 20 searches]  [x] auto-refresh 5 s
+-------------------------------------------+  +------------------------+
|            map (OpenStreetMap)            |  | 12 hotspots · 340      |
|        (  ●   dashed 5 km circle    )     |  | 0.42 km · 38 searches  |
|     ●        📍 origin      ●             |  | 1.10 km · 25 searches  |
|  click anywhere = new origin              |  | ... sorted by distance |
+-------------------------------------------+  +------------------------+
```

## 6. Reviews + catalog (Workflow 4)

```
Property id [__] [Show] [All properties]
[Average 4.1/5] [Total reviews 12,000] [Scope: all]
+---------------------------+  +---------------------------+
| Rating distribution (bars)|  | Top tags (horizontal bars)|
+---------------------------+  +---------------------------+
+---------------------------+  +---------------------------+
| Amenities · property #98  |  | Latest reviews ★★★★☆      |
| ✓ wifi  ✕ pool  ✓ kitchen |  | comment + tag chips       |
| House rules • • •         |  | [pager]                   |
| ♿ accessibility chips     |  |                           |
+---------------------------+  +---------------------------+
```
