1. Purpose & Vision
Problem Statement

Customer support teams need a simple, affordable helpdesk with actionable analytics, without the complexity and cost of enterprise tools like Zendesk.

Vision

6Desk is a lightweight customer support platform that enables teams to:

Manage customer tickets efficiently (with tags, for query categorization, eg. payments tag(covering withdrawal and deposit queries), markets tag (resolution, early exit, fees, queries) general tag (common questions) etc

Gain essential, decision-ready analytics (eg. intent, sentiment, priority) without heavy configuration

The MVP prioritizes clarity, speed, and measurable insights over feature breadth.

2. Goals & Non-Goals
MVP Goals

Enable basic ticket lifecycle management

Provide core analytics comparable to Zendesk Essentials

Support small teams (1–50 agents)

Ship quickly with low technical complexity

Non-Goals (Explicitly Out of Scope for MVP)

AI-powered auto replies or bots

Omnichannel support (WhatsApp, Twitter, Instagram, Facebook, TikTok(if possible))

Advanced SLA automation

Custom reporting builder

3. Target Users & Personas
Primary Persona: Support Manager

Needs visibility into volume, response times, and agent workload

Makes staffing and process decisions

Secondary Persona: Support Agent

Needs a clean UI to handle tickets quickly

Wants personal performance feedback

Tertiary Persona: Founder / Ops

Needs high-level trends

Wants to know if support quality is improving or declining

4. Core Features (MVP Scope)
4.1 Ticketing System (Foundational)
Ticket Creation

Channels:

Email (required)

Web form (required)

Fields:

Ticket ID

Subject

Description

Requester email

Status

Priority

Created at / Updated at

Ticket Statuses

New

Open

Pending

Solved

Closed (auto after X days)

Assignment

Manual assignment

Round-robin (optional MVP+)


5. Analytics & Reporting (Core Differentiator)

Goal: Deliver Zendesk-like insights using simple, reliable calculations

5.1 Dashboard Overview (Home Analytics)
Metrics (Global)
Metric	Description
Total Tickets	Count in selected date range
Open Tickets	Currently unsolved
Tickets Created Today	Daily inflow
Tickets Solved Today	Daily output
Avg First Response Time	Time to first agent reply
Avg Resolution Time	Time from creation to solved

📅 Date Range Selector:

Today

Last 7 days

Last 30 days

Custom range

5.2 Ticket Volume Analytics
Charts

Tickets Created Over Time (daily)

Tickets Solved Over Time

Breakdown Filters

By status

By priority

By agent

5.4 SLA-Lite Analytics (Feasible MVP)

No complex SLA engine — analytics only

SLA Targets (Configurable)

First response target (e.g., 2 hours)

Resolution target (e.g., 24 hours)

Metrics

% Tickets Meeting First Response SLA

% Tickets Meeting Resolution SLA

SLA Breach Count

5.5 Customer Satisfaction (Optional MVP / MVP+)
CSAT (Simple)

One-click rating after ticket solved:

👍 Satisfied

👎 Unsatisfied

Metrics

CSAT score (% satisfied)

Ratings over time

6. Data Model (High-Level)
Core Tables

Users

Tickets

Ticket_Events (status changes, assignments)

Replies

SLA_Configs

CSAT_Ratings

Analytics derived from event timestamps, not complex pipelines.

7. Analytics Calculations (Explicit Definitions)
First Response Time
First agent reply timestamp – Ticket creation timestamp

Resolution Time
Ticket solved timestamp – Ticket creation timestamp

SLA Compliance
If metric <= SLA target → Compliant
Else → Breached

8. UX Principles

Analytics-first layout

Minimal clicks to insights (≤2 clicks)

No charts without a decision purpose

Clear metric definitions (tooltips)

9. Technical Considerations (MVP-Friendly)
Architecture

Monolithic backend (initially)

REST API

Relational DB (Postgres)

Analytics Layer

Pre-aggregated daily stats

Simple SQL-based reporting

No real-time streaming required

10. Security & Compliance (Baseline)

Role-based access control

Data encryption at rest

Audit log (ticket status & assignment changes)

11. Success Metrics (MVP)
Product Metrics

Time to first ticket resolution

Dashboard usage rate

Business Metrics

Teams onboarded

Tickets processed


12. MVP Release Checklist

✅ Ticket CRUD
✅ Email ingestion
✅ Core analytics dashboard
✅ Performance reports
✅ SLA-lite analytics

13. Future Roadmap (Post-MVP)

Custom reports

Multi-channel inbox

AI insights (trend detection)