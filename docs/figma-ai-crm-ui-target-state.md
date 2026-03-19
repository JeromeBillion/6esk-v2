# Figma AI CRM UI Target State

## Purpose

This document is the target-state product and UX requirement for the `6esk` CRM UI overhaul.

Treat this as the source of truth for the new frontend direction, even where the current codebase behaves differently.

This is not a summary of current implementation. It is the desired end state.

## Visual Direction

The design direction is:

- modern minimal
- inspired by Linear and Notion
- clean typography
- subtle borders and shadows
- smooth interactions
- dense but breathable layouts

The UI should feel calm, efficient, and high-signal.

## Conversation Threads

### 1. Message Types

Email, WhatsApp, and voice should not be forced into one messy mixed thread.

The intended model is:

- the active conversation surface can stay focused on the ticket's primary channel
- cross-channel interactions should appear in the customer's interaction history
- the user should feel that all interactions belong to one customer story, even if the active thread is channel-specific

### 2. Voice Interactions

Voice should show both live call context and post-call artifacts.

During or immediately around the call, show:

- call status
- duration
- initiation or direction context

After the call, show:

- recording player
- transcript
- final outcome

Voice should feel like a first-class interaction type, not just a transcript dump.

### 3. WhatsApp Messages

Each WhatsApp message should show delivery state in a clean, compact way.

Supported statuses should include:

- sent
- delivered
- read
- failed

Template messages should not have a completely separate visual style.

Use only a small, clean indicator to show that a message used a template.

### 4. Message Events

System events should not clutter the main message thread.

Do not render things like:

- status changed
- assigned to someone
- tags added

inline as message bubbles.

Instead:

- provide a history modal
- open it from a clock icon
- place that clock icon on the left side of the email/chat header

That modal should be the place for:

- ticket activity
- customer interaction history
- important system events

## Merge Workflow

### 1. What Can Be Merged

Both are required:

- ticket merge
- customer merge

### 2. Search UI

The merge experience should use a focused merge workspace, preferably modal-based.

Search should support practical operational identifiers such as:

- agent email when relevant data is available
- customer email
- phone numbers
- ticket numbers
- email headings or subjects

The goal is fast duplicate resolution from whatever clue the agent has at hand.

### 3. Preflight Display

Preflight should be explicit, clear, and operationally safe.

It should show:

- what source record is being merged into what target record
- what data will move
- what data will stay
- what conflicts or blockers exist
- what channel context is involved
- that the action is irreversible

For ticket merges, the impact summary should show counts such as:

- messages
- replies
- drafts
- events
- tags

For customer merges, the impact summary should show counts such as:

- tickets that will be re-linked
- active tickets
- identities that will move
- identity conflicts

### 4. Review Queue and Feedback

Merge outcomes should feel immediate and obvious.

The intended behavior is:

- users should see success immediately after a successful merge action
- show a success modal for about `1.5s`
- on error, show an explanation modal
- the error modal must stay open until the user explicitly closes it

The merge review and operational resolution flow should stay close to the support workflow rather than feeling buried.

## AI Draft Workflow

### 1. Where AI Drafts Appear

AI drafts should appear directly in the reply experience.

The intended model is:

- drafts surface in the reply box area
- no separate draft panel is required in the primary experience
- simplicity is preferred over extra review surfaces

### 2. Draft Queue Scope

Draft review should be per-ticket.

The primary workflow is:

- open ticket
- see suggested draft inline
- edit if needed
- send or dismiss

The design should optimize for the active ticket, not for a separate global draft-review destination.

## Product Principles Behind These Answers

The redesign should emphasize:

- clarity over feature sprawl
- one obvious place for each action
- minimal visual noise
- immediate operational feedback
- customer context without cluttering the active conversation

## Notes For The Implementation Agent

When the frontend implementation is updated later, the code should be made to align to this target state.

If the current implementation differs, this document wins for the redesign direction.

