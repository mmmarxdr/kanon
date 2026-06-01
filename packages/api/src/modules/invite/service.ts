import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { MemberRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { EmailProvider } from "../../services/email/types.js";
import type { CreateInviteBody, OnboardingInviteBody, ProjectAssignment } from "./schema.js";

/**
 * Validate project assignments for a given workspace:
 * - All projectIds must belong to the workspace (else 422 INVALID_PROJECT)
 * - If any assignment role is 'owner' and inviterRole !== 'owner' → 403 ROLE_CAP_EXCEEDED
 *
 * Must be called BEFORE any workspaceInvite.create call.
 */
async function validateProjectAssignments(
  assignments: ProjectAssignment[],
  workspaceId: string,
  inviterRole: MemberRole,
): Promise<void> {
  if (assignments.length === 0) return;

  // Check owner-cap first (cheaper — no DB call needed if we can short-circuit)
  const hasOwnerAssignment = assignments.some((a) => a.role === "owner");
  if (hasOwnerAssignment && inviterRole !== "owner") {
    throw new AppError(
      403,
      "ROLE_CAP_EXCEEDED",
      "Only workspace owners may assign the owner role to projects",
    );
  }

  // Validate all projectIds belong to the workspace
  const ids = assignments.map((a) => a.projectId);
  const liveProjects = await prisma.project.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true },
  });
  const liveSet = new Set(liveProjects.map((p) => p.id));
  const mismatch = ids.find((id) => !liveSet.has(id));
  if (mismatch) {
    throw new AppError(
      422,
      "INVALID_PROJECT",
      `Project ${mismatch} does not belong to this workspace`,
    );
  }
}

/**
 * Generate a cryptographically secure invite token.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Extract the domain from an email address (lowercase).
 */
function extractDomain(email: string): string {
  const parts = email.split("@");
  return (parts[1] ?? "").toLowerCase();
}

/**
 * Check if a user's email domain is allowed by the workspace's allowedDomains list.
 * If allowedDomains is empty, all domains are allowed.
 */
function isDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = extractDomain(email);
  return allowedDomains.some((d) => d.toLowerCase() === domain);
}

/**
 * Shape an invite record into the InviteResponse format.
 */
function toInviteResponse(invite: {
  id: string;
  token: string;
  role: string;
  maxUses: number;
  useCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  label: string | null;
  email: string | null;
  createdAt: Date;
  createdBy: { email: string; displayName: string | null };
}) {
  return {
    id: invite.id,
    token: invite.token,
    role: invite.role,
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    expiresAt: invite.expiresAt.toISOString(),
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    label: invite.label,
    email: invite.email,
    inviteUrl: `/invite/${invite.token}`,
    createdBy: {
      email: invite.createdBy.email,
      displayName: invite.createdBy.displayName,
    },
    createdAt: invite.createdAt.toISOString(),
  };
}

/**
 * Build the HTML email for a workspace invite.
 */
function buildInviteEmail(opts: {
  workspaceName: string;
  role: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const expiresDate = opts.expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const roleLabel = opts.role.charAt(0).toUpperCase() + opts.role.slice(1);

  const subject = `You've been invited to join ${opts.workspaceName} on Kanon`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #111; margin-bottom: 16px;">You're invited!</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.5;">
        <strong>${opts.inviterName}</strong> has invited you to join
        <strong>${opts.workspaceName}</strong> as a <strong>${roleLabel}</strong>.
      </p>
      <div style="margin: 32px 0; text-align: center;">
        <a href="${opts.inviteUrl}"
           style="display: inline-block; background-color: #111; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
          Accept Invite
        </a>
      </div>
      <p style="color: #666; font-size: 13px;">
        This invite expires on ${expiresDate}.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
    </div>
  `.trim();

  const text = [
    `You've been invited to join ${opts.workspaceName} on Kanon!`,
    "",
    `${opts.inviterName} has invited you to join as a ${roleLabel}.`,
    "",
    `Accept the invite: ${opts.inviteUrl}`,
    "",
    `This invite expires on ${expiresDate}.`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Create a new workspace invite link.
 * If an email is provided and an emailProvider is available, sends an invite email.
 *
 * @param inviterRole - The workspace role of the user creating the invite.
 *   Required to enforce owner-cap on project assignments.
 */
export async function createInvite(
  workspaceId: string,
  createdById: string,
  body: CreateInviteBody,
  inviterRole: MemberRole,
  emailProvider?: EmailProvider,
) {
  // Validate project assignments before creating the invite (fail fast, no partial state)
  if (body.projectAssignments && body.projectAssignments.length > 0) {
    await validateProjectAssignments(body.projectAssignments, workspaceId, inviterRole);
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000);

  const invite = await prisma.workspaceInvite.create({
    data: {
      token,
      role: body.role,
      maxUses: body.maxUses,
      expiresAt,
      label: body.label ?? null,
      email: body.email ?? null,
      workspaceId,
      createdById,
      projectAssignments:
        body.projectAssignments && body.projectAssignments.length > 0
          ? body.projectAssignments
          : undefined,
    },
    include: {
      createdBy: {
        select: { email: true, displayName: true },
      },
      workspace: {
        select: { name: true },
      },
    },
  });

  // Send invite email if an email address was provided
  if (body.email && emailProvider) {
    const inviteUrl = `${env.APP_URL}/invite/${token}`;
    const inviterName = invite.createdBy.displayName ?? invite.createdBy.email;
    const emailContent = buildInviteEmail({
      workspaceName: invite.workspace.name,
      role: invite.role,
      inviterName,
      inviteUrl,
      expiresAt,
    });

    // Fire-and-forget — don't let email failure break invite creation
    emailProvider.send({
      to: body.email,
      ...emailContent,
    }).catch((err) => {
      console.error(`Failed to send invite email to ${body.email}:`, err);
    });
  }

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "invite.created",
      workspaceId,
      actorId: createdById,
      payload: { inviteId: invite.id, role: invite.role, token: invite.token },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return toInviteResponse(invite);
}

/**
 * List all invites for a workspace (active + revoked).
 */
export async function listInvites(workspaceId: string) {
  const invites = await prisma.workspaceInvite.findMany({
    where: { workspaceId },
    include: {
      createdBy: {
        select: { email: true, displayName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return { invites: invites.map(toInviteResponse) };
}

/**
 * Revoke an invite by setting revokedAt.
 */
export async function revokeInvite(inviteId: string, workspaceId: string, actorId: string) {
  const invite = await prisma.workspaceInvite.findFirst({
    where: { id: inviteId, workspaceId },
  });

  if (!invite) {
    throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found");
  }

  if (invite.revokedAt) {
    throw new AppError(422, "ALREADY_REVOKED", "Invite is already revoked");
  }

  const updated = await prisma.workspaceInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
    include: {
      createdBy: {
        select: { email: true, displayName: true },
      },
    },
  });

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "invite.revoked",
      workspaceId,
      actorId,
      payload: { inviteId: updated.id, token: updated.token },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return toInviteResponse(updated);
}

/**
 * Get public metadata for an invite link (no auth required).
 */
export async function getInviteMetadata(token: string) {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    include: {
      workspace: {
        select: { name: true, slug: true },
      },
    },
  });

  if (!invite) {
    throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found");
  }

  const now = new Date();
  const isExpired = invite.expiresAt < now;
  const isExhausted = invite.maxUses > 0 && invite.useCount >= invite.maxUses;
  const isRevoked = invite.revokedAt !== null;
  const isValid = !isExpired && !isExhausted && !isRevoked;

  return {
    workspaceName: invite.workspace.name,
    workspaceSlug: invite.workspace.slug,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    isExpired,
    isExhausted,
    isRevoked,
    isValid,
    email: invite.email ?? null,
  };
}

/**
 * Create a single-use onboarding invite for an existing workspace member.
 *
 * CRITICAL (option 1): The target user MUST already exist AND be a member of
 * the workspace. This function does NOT create users. Returns a signed JWT
 * (scope=onboard) embedded in a kanon:// URL.
 *
 * @param inviterRole - The workspace role of the user creating the invite.
 *   Required to enforce owner-cap on project assignments.
 */
export async function createOnboardingInvite(
  workspaceId: string,
  createdById: string,
  body: OnboardingInviteBody,
  inviterRole: MemberRole,
) {
  // 1. Resolve user — must exist
  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  // 2. Assert workspace membership
  const member = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
    select: { id: true },
  });
  if (!member) {
    throw new AppError(403, "NOT_A_MEMBER", "User is not a member of this workspace");
  }

  // 2b. Validate project assignments before creating the invite (fail fast)
  if (body.projectAssignments && body.projectAssignments.length > 0) {
    await validateProjectAssignments(body.projectAssignments, workspaceId, inviterRole);
  }

  const ttlHours = body.ttlHours ?? env.ONBOARDING_TOKEN_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  // 3. Persist the invite row — opaque token required by existing schema
  const opaqueToken = generateToken();
  const invite = await prisma.workspaceInvite.create({
    data: {
      token: opaqueToken,
      role: body.role ?? "member",
      maxUses: 1,
      expiresAt,
      label: "Onboarding link",
      email: user.email,
      kind: "ONBOARDING",
      workspaceId,
      createdById,
      projectAssignments:
        body.projectAssignments && body.projectAssignments.length > 0
          ? body.projectAssignments
          : undefined,
    },
    include: {
      createdBy: { select: { email: true, displayName: true } },
    },
  });

  // 4. Sign onboarding JWT: scope=onboard, sub=inviteId, exp=ttlHours
  const jwtToken = jwt.sign(
    { sub: invite.id, scope: "onboard" },
    env.JWT_SECRET,
    { expiresIn: `${ttlHours}h` },
  );

  // 5. Build kanon:// URL using BASE_URL host
  const host = new URL(env.BASE_URL).host;
  const url = `kanon://${host}/onboard?token=${jwtToken}`;

  return {
    inviteId: invite.id,
    url,
    token: jwtToken,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

/**
 * Accept an invite — validates, increments useCount, creates member.
 * Uses an interactive transaction for atomicity.
 */
export async function acceptInvite(token: string, userId: string, userEmail: string) {
  return prisma.$transaction(async (tx) => {
    // Use FOR UPDATE to prevent race conditions on concurrent accepts
    const rows = await tx.$queryRaw<Array<{
      id: string;
      token: string;
      role: string;
      max_uses: number;
      use_count: number;
      expires_at: Date;
      revoked_at: Date | null;
      workspace_id: string;
      kind: string | null;
    }>>`
      SELECT id, token, role, max_uses, use_count, expires_at, revoked_at, workspace_id, kind
      FROM workspace_invites
      WHERE token = ${token}
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) {
      throw new AppError(404, "INVITE_NOT_FOUND", "Invite not found");
    }

    // Guard: onboarding invites are CLI-only — must not be accepted via the web flow
    if (row.kind === "ONBOARDING") {
      throw new AppError(400, "INVALID_INVITE_KIND", "This invite is for CLI onboarding only.");
    }

    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: row.workspace_id },
      select: { id: true, name: true, allowedDomains: true },
    });

    const invite = {
      id: row.id,
      token: row.token,
      role: row.role,
      maxUses: row.max_uses,
      useCount: row.use_count,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      workspaceId: row.workspace_id,
      workspace,
    };

    // Validate invite is still usable
    const now = new Date();
    if (invite.revokedAt) {
      throw new AppError(410, "INVITE_REVOKED", "This invite has been revoked");
    }
    if (invite.expiresAt < now) {
      throw new AppError(410, "INVITE_EXPIRED", "This invite has expired");
    }
    if (invite.maxUses > 0 && invite.useCount >= invite.maxUses) {
      throw new AppError(410, "INVITE_EXHAUSTED", "This invite has reached its usage limit");
    }

    // Validate domain allowlist
    if (!isDomainAllowed(userEmail, invite.workspace.allowedDomains)) {
      throw new AppError(
        403,
        "DOMAIN_NOT_ALLOWED",
        "Your email domain is not allowed for this workspace",
      );
    }

    // Check if already a member
    const existing = await tx.member.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: invite.workspaceId,
        },
      },
    });
    if (existing) {
      throw new AppError(409, "ALREADY_MEMBER", "You are already a member of this workspace");
    }

    // Increment use count
    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { useCount: { increment: 1 } },
    });

    // Derive username from email
    const local = userEmail.split("@")[0] ?? "user";
    let username = local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";

    // Ensure username is unique within workspace
    const existingUsername = await tx.member.findUnique({
      where: {
        workspaceId_username: {
          workspaceId: invite.workspaceId,
          username,
        },
      },
    });
    if (existingUsername) {
      username = `${username}-${Date.now().toString(36)}`;
    }

    // Create member
    const member = await tx.member.create({
      data: {
        username,
        role: invite.role as MemberRole,
        userId,
        workspaceId: invite.workspaceId,
      },
      include: {
        user: {
          select: { email: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Emit domain event (fire-and-forget, outside tx is fine)
    try {
      eventBus.emit({
        type: "invite.accepted",
        workspaceId: invite.workspaceId,
        actorId: userId,
        payload: {
          inviteId: invite.id,
          memberId: member.id,
          username: member.username,
          role: member.role,
        },
      });
    } catch {
      // Never let event emission break the mutation
    }

    return member;
  });
}
