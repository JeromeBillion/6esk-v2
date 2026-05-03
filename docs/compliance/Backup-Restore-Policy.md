# Data Backup & Restore Policy

This policy dictates how 6esk ensures data durability and provides proof of recovery capabilities, fulfilling our commitments under POPIA security safeguard provisions.

## 1. Backup Strategy

### PostgreSQL Database
- **Continuous Archiving:** Write-Ahead Logs (WAL) are continuously archived to a secure, separate cloud storage bucket (e.g., AWS S3 or Cloudflare R2).
- **Daily Snapshots:** Full database snapshots are taken automatically every 24 hours.
- **Retention:** Snapshots and WAL files are retained for 30 days.
- **Encryption:** All backups are encrypted at rest using AES-256.

### Object Storage (Attachments, Recordings)
- **Versioning:** Enabled on all primary storage buckets. Deletions or overwrites create a hidden version instead of permanently destroying the file immediately (subject to the 30-day lifecycle rule).
- **Replication:** Cross-region replication is enabled for critical buckets.

## 2. Restore Drills & Proof
A backup is only as good as its restore process. To ensure "backup/restore proof" for our compliance posture:
1. **Quarterly Drills:** The engineering team conducts a full database restore to an isolated staging environment once per quarter.
2. **Success Criteria:** The application must successfully boot against the restored data, and a suite of read-only integration tests must pass.
3. **Audit Log:** The results of the drill, time to recovery (RTO), and any encountered issues are logged in our internal compliance tracker.

## 3. Disaster Recovery (DR)
- **Recovery Point Objective (RPO):** Maximum 5 minutes of data loss (achieved via WAL streaming).
- **Recovery Time Objective (RTO):** Maximum 4 hours to restore service in the event of a total primary-region failure.

## 4. Tenant-Specific Restores
6esk's multi-tenant architecture uses a shared schema (`tenant_id` isolated). 
- We **do not** currently support rolling back a *single tenant's* data to a previous point in time without affecting others. 
- If a tenant accidentally deletes their own data, they must rely on the platform's soft-delete / recycle-bin mechanisms (where available). Infrastructure backups are exclusively for system-wide disaster recovery.
