# Security Incident & Compromise Response Plan

This document outlines the standard operating procedure for 6esk staff during a suspected or confirmed security compromise, ensuring compliance with POPIA Section 22 and industry best practices.

## 1. Incident Classification
Incidents are classified into severity levels:
- **SEV-1 (Critical):** Confirmed data breach, unauthorized access to the production database, widespread service outage due to attack.
- **SEV-2 (High):** Suspected breach, unauthorized access to a single tenant's data, or compromise of a secondary system.
- **SEV-3 (Moderate):** Security misconfiguration detected internally before exploitation, localized anomalies.

## 2. Roles & Responsibilities
- **Incident Commander (IC):** Leads the response, coordinates communication, makes technical decisions.
- **Information Officer (IO):** Handles legal/regulatory reporting and communication with the Information Regulator.
- **Communications Lead:** Drafts customer notifications.
- **Lead Investigator:** Forensics, log analysis, and containment execution.

## 3. Response Phases

### Phase 1: Identification & Triage
- Monitor alerts from standard telemetry, WAF, or customer reports.
- IC establishes an incident war room (e.g., dedicated Slack channel/Google Meet).
- Assess the scope: Which tenants are affected? What data types?

### Phase 2: Containment
- **Immediate isolation:** Revoke compromised credentials, isolate affected services/containers, block malicious IPs.
- **Fail-Closed:** If the breach vector is unknown but active, the affected service (or entire platform) must be taken offline to prevent further data loss.
- Disable compromised AI integrations or webhook endpoints.

### Phase 3: Eradication & Recovery
- Patch the vulnerability or misconfiguration.
- Rotate all potentially exposed secrets (database passwords, provider tokens, JWT secrets).
- Restore services from trusted, immutable backups if tampering is suspected.
- Validate system integrity before reconnecting to the internet.

### Phase 4: Notification (POPIA Section 22)
If there are reasonable grounds to believe personal information was accessed or acquired by an unauthorized person:
- **Notify the Information Regulator:** "As soon as reasonably possible."
- **Notify the Responsible Party (B2B Customer):** So they can assess their obligation to notify their data subjects.
- **Notification Contents:** Description of possible consequences, measures taken, and recommendations for the data subject to mitigate risks.

### Phase 5: Post-Incident Review (PIR)
- Conduct a blameless post-mortem within 5 business days.
- Document root cause, timeline, and lessons learned.
- Create Jira tickets for architectural improvements to prevent recurrence.
