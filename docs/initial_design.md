> ⚠️ **Superseded by [`design.md`](./design.md)** — kept for history. New work should reference `design.md`.

```md
# Housing Price Intelligence System — Product & Architecture Plan

## 1. Product Vision

A **real estate market intelligence system** that collects fragmented housing price signals (broker messages, web listings, agent inputs) and transforms them into:

- Structured property intelligence
- Time-series price distributions (not single values)
- Geo-based heatmaps of housing value
- Market perception “price clouds” over time

The system is built around:
> **Entity-based wiki + structured database + spatiotemporal analytics layer**

---

# 2. Core Product Principles

## 2.1 Entity-first design
Everything revolves around:
- Property / Building / Project entities
- Location entities (districts, streets, zones)

Each entity is a “living page” that aggregates:
- structured data
- raw broker signals
- price history
- external references

---

## 2.2 Multi-source truth model
There is no single price.

Each property has:
- multiple price observations
- from multiple sources
- over time

System stores:
> **price distributions, not price values**

---

## 2.3 Spatial + temporal intelligence
Two axes:
- Space → map (where)
- Time → scatter/distribution (when)

---

# 3. High-Level Architecture

## 3.1 System Layers

### (1) Input Layer
Sources:
- broker messages (manual / chat import)
- web scraping (real estate sites, forums)
- agent-based collection (future)
- user-submitted data

Output:
- raw unstructured text + metadata

---

### (2) Processing Layer
Functions:
- entity recognition (property matching)
- structured extraction (price, size, location)
- normalization (currency, m², geo coordinates)
- deduplication (same listing across sources)

Output:
- structured listing + price observations

---

### (3) Entity Layer (Wiki System)
Each entity contains:
- property/project profile
- aggregated listings
- broker notes
- historical context
- AI-generated summaries

---

### (4) Database Layer (Postgres)
Stores:
- structured listings
- price observations (time-series)
- geo data
- source provenance

---

### (5) Analytics Layer
Computes:
- price per m² distribution
- median price per area
- trend detection
- volatility (market noise)
- outlier detection

---

### (6) Visualization Layer
- map (spatial view)
- scatter plots (temporal view)
- heatmaps
- distribution charts

---

# 4. Data Model (Conceptual)

## Property Entity
- id
- name
- location (lat/lng + text)
- year_built
- renovation_year
- type (apartment/house/project)
- wiki_notes

---

## Listing / Observation
- id
- property_id
- price
- area_m2
- price_per_m2
- source_type (broker/web/agent/user)
- source_ref
- timestamp
- raw_text
- confidence_score (optional)

---

## Location Entity
- id
- name (district/area)
- geometry (polygon)
- aggregated stats

---

# 5. Visualization System

## 5.1 Key Design Choice
❌ Avoid line charts as primary view  
✅ Use scatter + distribution models

Reason:
Housing prices are **non-continuous + noisy + multi-source**

---

## 5.2 Visual Models

### A. Price Scatter (Primary)
- X-axis: time
- Y-axis: price or price/m²
- each point = one observation

Enhancements:
- color = source type
- size = property size
- opacity = confidence

---

### B. Distribution Bands
Per time window:
- median line (optional)
- 25–75% band
- outliers shown separately

---

### C. Heatmap (Spatial)
- price density by location
- price/m² intensity
- undervaluation/overvaluation map

---

### D. Volatility Cloud
- dense clustering shows market activity
- sparse regions show low liquidity

---


# 6. Core Insight

Housing data is not a single truth system.
