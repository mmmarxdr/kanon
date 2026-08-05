# Spec: instance-user-directory

## Requirements

### R1 Gate
Admin user routes MUST require instance admin. Non-admins get 403.

### R2 List
`GET /api/admin/users` MUST support `q`, `limit`, `offset`, optional `verified`, and return `total`.

### R3 Detail
`GET /api/admin/users/:userId` MUST return user fields and memberships with role, projectAccess, and project assignments.

### R4 Verify
`POST .../verify-email` MUST set `emailVerifiedAt` when null; MUST be idempotent if already set.

### R5 Membership edits
Instance admin MUST be able to add/remove workspace membership and patch role/projectAccess subject to existing owner-cap rules.

### R6 Assigned projects
When projectAccess is assigned, `PUT .../projects` MUST replace ProjectMember rows for that user in the membership's workspace.

### R7 Bulk
Bulk verify_email and remove_from_workspace MUST return per-user ok/error without failing the whole batch on a single miss.

## Scenarios

### S1 Non-admin
- Given a normal member token
- When GET /api/admin/users
- Then 403

### S2 Search
- Given users a@x.com and b@y.com
- When GET ?q=a@x
- Then only a@x.com is listed

### S3 Verify
- Given unverified user
- When POST verify-email
- Then emailVerifiedAt is set

### S4 Bulk remove
- Given two members of WS
- When bulk remove_from_workspace
- Then both lose membership (or per-id error if already gone)
