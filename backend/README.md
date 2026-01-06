# Food Costing Backend

## Environment Variables

Create a `.env` file in the `backend/` directory with the following variables:

```bash
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Resend (Email Service)
RESEND_API_KEY=your_resend_api_key
RESEND_WEBHOOK_SECRET=your_resend_webhook_secret  # Optional: for webhook signature validation

# Frontend URL
FRONTEND_URL=http://localhost:3000  # or your production URL

# System Admin
SYSTEM_ADMIN_EMAIL=yukiy@ajisho-usa.com  # Email address of the system administrator

# Server
PORT=4000  # Optional: defaults to 4000
```

## System Admin

The system administrator has special privileges:
- Access to the Admin Panel (`/admin`)
- Ability to approve/reject access requests
- Manage the allowlist

To set a user as system admin, set their email address in the `SYSTEM_ADMIN_EMAIL` environment variable.

## Access Control

This application uses an **invite-only / allowlist** access control pattern:

1. **Request Access**: New users can request access via `/request-access`
2. **Approval**: System admin approves requests in the Admin Panel
3. **Login**: Approved users (or invited users) can sign in with Google
4. **Auth Hook**: A Supabase Auth Hook (`before.signup`) checks the `allowlist` and `invitations` tables before allowing user registration

### Database Setup

Run the following migration to set up the access control system:

```bash
# Run the migration in Supabase SQL Editor
migration_create_allowlist_and_auth_hook.sql
```

After running the migration, you need to manually enable the Auth Hook in Supabase Dashboard:

1. Go to **Supabase Dashboard** > **Authentication** > **Hooks**
2. Enable **before.signup** hook
3. Select function: `public.check_before_signup()`
4. Save

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Lint
npm run lint
```

## API Endpoints

### Access Requests (Allowlist)
- `POST /access-requests` - Submit access request (public)
- `GET /access-requests?status=pending` - List requests (System Admin only)
- `PUT /access-requests/:id/approve` - Approve request (System Admin only)
- `PUT /access-requests/:id/reject` - Reject request (System Admin only)
- `DELETE /access-requests/:id` - Delete request (System Admin only)

### Invitations
- `POST /invite` - Create invitation (authenticated, tenant admin)
- `GET /invite` - List invitations (authenticated, tenant admin)
- `GET /invite/verify/:token` - Verify invitation token (public)
- `POST /invite/accept` - Accept invitation (authenticated)
- `DELETE /invite/:id` - Cancel invitation (authenticated, tenant admin)

### Webhooks
- `POST /webhooks/resend` - Resend webhook endpoint (public, signature validated)

### Tenants
- `POST /tenants` - Create tenant (authenticated, no profile required)
- `GET /tenants` - List user's tenants (authenticated)
- `GET /tenants/:id` - Get tenant details (authenticated)
- `GET /tenants/:id/members` - List tenant members (authenticated)
- `PUT /tenants/:id` - Update tenant (authenticated, tenant member)
- `PUT /tenants/:id/members/:userId/role` - Update member role (authenticated, tenant member)
- `DELETE /tenants/:id/members/:userId` - Remove member (authenticated, tenant member)

## Authorization

This application uses **Cedar** for policy-based authorization (RBAC/ABAC):

- **allowlist**: Controls who can access the application (entry gate)
- **Cedar policies**: Controls what users can do within the application (tenant-scoped permissions)

See `backend/src/authz/policies.cedar` for policy definitions.

